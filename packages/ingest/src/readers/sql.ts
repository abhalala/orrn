/**
 * SQL dump reader (plan C2, risk D6). Push-based: text chunks in, tables out, so a 100 MB dump never sits in memory as
 * one string. It reads
 *   - `INSERT INTO t [(cols)] VALUES (...), (...);` in MySQL and Postgres styles (multi-row, quoted strings with
 *     `''` and backslash escapes, NULL, schema-qualified and quoted names),
 *   - Postgres `COPY t [(cols)] FROM stdin;` blocks (tab separated, `\N` for NULL, backslash escapes, `\.` ends),
 *   - `CREATE TABLE` for column names when the INSERT or COPY has none.
 * Everything else (SET, SELECT setval, ALTER, comments, psql `\restrict` lines) is skipped. SQL is never executed.
 * NULL becomes an empty cell. Rows past `maxRows` are counted and dropped, and the table is flagged `truncated`.
 */
import type { ReadBlock } from "./types";

export type SqlDialect = "auto" | "mysql" | "postgres";

export type SqlTable = {
  name: string;
  schema: string | null;
  columns: string[];
  rows: string[][];
  /** Rows seen, including any dropped past the cap. */
  rowCount: number;
  truncated: boolean;
  /** Rows whose cell count differed from the column count. */
  arityMismatch: number;
  source: "insert" | "copy";
};

export type SqlUnparsed = { line: number; reason: string };

export type SqlResult = {
  tables: SqlTable[];
  /** Statements or lines the reader could not read. Capped at 100. */
  unparsed: SqlUnparsed[];
  unparsedCount: number;
  truncated: boolean;
};

export type SqlReaderOptions = {
  dialect?: SqlDialect;
  /** Rows kept over all tables. Default 200,000 (plan A9). */
  maxRows?: number;
  /** Column names from a schema-only dump, pushed as text before the data. Not needed: `push` it like any chunk. */
};

/** `quoted`: the name was in quotes, so its case counts. An unquoted name folds to lower case, as Postgres does. */
type Ident = { name: string; schema: string | null; quoted?: boolean };

/** Table key: schema and name. A dump may hold public.log and audit.log, or "Orders" and orders. */
function identKey(id: Ident): string {
  return `${(id.schema ?? "").toLowerCase()}\u0000${id.quoted ? id.name : id.name.toLowerCase()}`;
}

/**
 * The key a statement's table name refers to in `map`. The exact schema and name first. A name with no schema, or
 * with a schema where only a schema-less entry exists, takes the one entry with that name, when there is one.
 */
function findKey(map: ReadonlyMap<string, unknown>, id: Ident): string | null {
  const exact = identKey(id);
  if (map.has(exact)) return exact;
  const name = exact.slice(exact.indexOf("\u0000") + 1);
  const hits = [...map.keys()].filter((k) => {
    const [schema, n] = k.split("\u0000") as [string, string];
    return n === name && (id.schema === null || schema === "");
  });
  return hits.length === 1 ? hits[0]! : null;
}

type SkipState = {
  quote: "'" | '"' | "`" | null;
  esc: boolean;
  lineComment: boolean;
  blockComment: boolean;
  dollar: string | null;
  /** The letter before an opening quote was E: backslash escapes apply to this string. */
  eString: boolean;
};

const MAX_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE = 1024 * 1024;
const CONSTRAINT_WORDS = /^(constraint|primary|unique|foreign|key|index|check|fulltext|spatial|exclude|like|period)\b/i;
const DOLLAR_OPEN = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

function freshSkip(): SkipState {
  return { quote: null, esc: false, lineComment: false, blockComment: false, dollar: null, eString: false };
}

class Incomplete extends Error {}

export class SqlReader {
  private buf = "";
  private pos = 0;
  private line = 1;
  private mode: "top" | "values" | "copy" | "skip" = "top";
  private dialect: SqlDialect;
  private dialectResolved = false;
  private sawFirst = false;

  private tables = new Map<string, SqlTable>();
  private order: string[] = [];
  private declared = new Map<string, { ident: Ident; columns: string[] }>();
  private unparsed: SqlUnparsed[] = [];
  private unparsedCount = 0;
  private kept = 0;
  private truncated = false;
  private readonly maxRows: number;

  private current: SqlTable | null = null;
  private copyDiscard = false;
  private skip = freshSkip();
  private capture: string | null = null;
  private finished = false;
  private rowsInStatement = 0;

  constructor(opts: SqlReaderOptions = {}) {
    this.dialect = opts.dialect ?? "auto";
    this.maxRows = opts.maxRows ?? 200_000;
    this.dialectResolved = this.dialect !== "auto";
  }

  /** Feed the next piece of the dump. */
  push(chunk: string): void {
    if (this.finished) throw new Error("SqlReader is finished");
    if (!this.sawFirst) {
      this.sawFirst = true;
      if (!this.dialectResolved) this.sniffDialect(chunk);
    }
    this.buf = this.pos > 0 ? this.buf.slice(this.pos) + chunk : this.buf + chunk;
    this.pos = 0;
    this.run(false);
    this.buf = this.buf.slice(this.pos);
    this.pos = 0;
  }

  /** No more text: close what is open and return the tables. */
  finish(): SqlResult {
    if (!this.finished) {
      this.run(true);
      this.finished = true;
      this.buf = "";
      this.pos = 0;
    }
    const tables = this.order.map((k) => this.tables.get(k)!);
    for (const t of tables) {
      if (t.columns.length === 0) {
        const width = t.rows.reduce((m, r) => Math.max(m, r.length), 0);
        t.columns = Array.from({ length: width }, (_, i) => `col${i + 1}`);
      }
    }
    return { tables, unparsed: this.unparsed, unparsedCount: this.unparsedCount, truncated: this.truncated };
  }

  // ---------------------------------------------------------------- plumbing

  private sniffDialect(text: string) {
    const head = text.slice(0, 8192);
    if (/PostgreSQL database dump|pg_dump|standard_conforming_strings|\bCOPY\b[^\n]*FROM stdin/i.test(head)) this.dialect = "postgres";
    else if (/mysqldump|MariaDB dump|ENGINE\s*=|\/\*!\d{5}/i.test(head)) this.dialect = "mysql";
    if (this.dialect !== "auto") this.dialectResolved = true;
  }

  private get backslash(): boolean {
    return this.dialect === "mysql";
  }

  /** Moves to `p`, counting the newlines passed over. Costs only the distance moved, so a long line stays linear. */
  private advanceTo(p: number) {
    const b = this.buf;
    for (let k = this.pos; k < p; k++) if (b.charCodeAt(k) === 10) this.line++;
    this.pos = p;
  }

  private flag(reason: string, line = this.line) {
    this.unparsedCount++;
    if (this.unparsed.length < 100) this.unparsed.push({ line, reason });
  }

  private run(final: boolean) {
    for (;;) {
      const before = this.pos;
      const more =
        this.mode === "copy"
          ? this.stepCopy(final)
          : this.mode === "values"
            ? this.stepValues(final)
            : this.mode === "skip"
              ? this.stepSkip(final)
              : this.stepTop(final);
      if (!more) return;
      if (this.pos === before && this.mode === "top") return;
    }
  }

  // ---------------------------------------------------------------- top level

  private stepTop(final: boolean): boolean {
    const b = this.buf;
    let p = this.pos;
    // whitespace
    while (p < b.length && /\s/.test(b[p]!)) p++;
    if (p >= b.length) {
      this.advanceTo(p);
      return false;
    }
    // One character may be the start of `--` or `/*`: wait for the next.
    if (!final && p + 2 > b.length) {
      this.advanceTo(p);
      return false;
    }
    const rest2 = b.slice(p, p + 2);
    if (rest2 === "--" || b[p] === "#" || b[p] === "\\") {
      const nl = b.indexOf("\n", p);
      if (nl === -1) {
        if (!final) {
          this.advanceTo(p);
          return false;
        }
        this.advanceTo(b.length);
        return false;
      }
      this.advanceTo(nl + 1);
      return true;
    }
    if (rest2 === "/*") {
      const end = b.indexOf("*/", p + 2);
      if (end === -1) {
        if (!final) {
          this.advanceTo(p);
          return false;
        }
        this.advanceTo(b.length);
        return false;
      }
      this.advanceTo(end + 2);
      return true;
    }
    if (b[p] === ";") {
      this.advanceTo(p + 1);
      return true;
    }

    // A statement. Wait for enough text to read the first words.
    const m = /^([A-Za-z]+)/.exec(b.slice(p, p + 40));
    if (!m) {
      this.flag("unreadable statement start");
      this.advanceTo(p);
      this.beginSkip(false);
      return true;
    }
    if (!final && p + 40 > b.length && /^[A-Za-z]+$/.test(b.slice(p, b.length))) {
      this.advanceTo(p);
      return false;
    }
    const kw = m[1]!.toUpperCase();
    this.advanceTo(p);
    try {
      if (kw === "INSERT" || kw === "REPLACE") return this.beginInsert(final);
      if (kw === "COPY") return this.beginCopy(final);
      if (kw === "CREATE") {
        this.beginSkip(true);
        return true;
      }
    } catch (e) {
      if (e instanceof Incomplete) {
        if (final || b.length - this.pos > MAX_HEADER_BYTES) {
          this.flag(`incomplete ${kw} statement`);
          this.beginSkip(false);
          return true;
        }
        return false;
      }
      throw e;
    }
    this.beginSkip(false);
    return true;
  }

  private beginSkip(capture: boolean) {
    this.mode = "skip";
    this.skip = freshSkip();
    this.capture = capture ? "" : null;
  }

  // ---------------------------------------------------------------- tokens

  private skipSpace(b: string, p: number): number {
    for (;;) {
      while (p < b.length && /\s/.test(b[p]!)) p++;
      if (b.startsWith("--", p)) {
        const nl = b.indexOf("\n", p);
        if (nl === -1) throw new Incomplete();
        p = nl + 1;
      } else if (b.startsWith("/*", p)) {
        const e = b.indexOf("*/", p + 2);
        if (e === -1) throw new Incomplete();
        p = e + 2;
      } else return p;
    }
  }

  /** A bare word or a quoted identifier. */
  private readIdent(b: string, p: number): { value: string; end: number; quoted?: boolean } | null {
    if (p >= b.length) throw new Incomplete();
    const c = b[p]!;
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let out = "";
      let i = p + 1;
      for (;;) {
        if (i >= b.length) throw new Incomplete();
        if (b[i] === close) {
          if (b[i + 1] === close && c !== "[") {
            out += close;
            i += 2;
            continue;
          }
          return { value: out, end: i + 1, quoted: true };
        }
        out += b[i];
        i++;
      }
    }
    const m = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(b.slice(p, p + 200));
    if (!m) return null;
    if (p + m[0].length >= b.length) throw new Incomplete();
    return { value: m[0], end: p + m[0].length };
  }

  private readQualifiedName(b: string, p: number): { ident: Ident; end: number } | null {
    const parts: string[] = [];
    let quoted = false;
    let i = p;
    for (;;) {
      const id = this.readIdent(b, i);
      if (!id) return null;
      parts.push(id.value);
      quoted = id.quoted === true;
      i = this.skipSpace(b, id.end);
      if (b[i] === ".") {
        i = this.skipSpace(b, i + 1);
        continue;
      }
      break;
    }
    const name = parts[parts.length - 1]!;
    const schema = parts.length > 1 ? parts[parts.length - 2]! : null;
    return { ident: { name, schema, quoted }, end: i };
  }

  private readColumnList(b: string, p: number): { cols: string[]; end: number } {
    // b[p] === "("
    const cols: string[] = [];
    let i = this.skipSpace(b, p + 1);
    for (;;) {
      const id = this.readIdent(b, i);
      if (!id) throw new Error("bad column list");
      cols.push(id.value);
      i = this.skipSpace(b, id.end);
      if (b[i] === ",") {
        i = this.skipSpace(b, i + 1);
        continue;
      }
      if (b[i] === ")") return { cols, end: i + 1 };
      if (i >= b.length) throw new Incomplete();
      throw new Error("bad column list");
    }
  }

  private word(b: string, p: number): { w: string; end: number } | null {
    if (p >= b.length) throw new Incomplete();
    const m = /^[A-Za-z_]+/.exec(b.slice(p, p + 40));
    if (!m) return null;
    if (p + m[0].length >= b.length) throw new Incomplete();
    return { w: m[0].toUpperCase(), end: p + m[0].length };
  }

  // ---------------------------------------------------------------- INSERT

  private beginInsert(final: boolean): boolean {
    const b = this.buf;
    try {
      let i = this.pos;
      const first = this.word(b, i)!;
      i = this.skipSpace(b, first.end);
      let w = this.word(b, i);
      while (w && ["IGNORE", "LOW_PRIORITY", "DELAYED", "HIGH_PRIORITY"].includes(w.w)) {
        i = this.skipSpace(b, w.end);
        w = this.word(b, i);
      }
      if (w && w.w === "INTO") i = this.skipSpace(b, w.end);
      const q = this.readQualifiedName(b, i);
      if (!q) throw new Error("no table name");
      i = q.end;
      let cols: string[] | null = null;
      if (b[i] === "(") {
        const l = this.readColumnList(b, i);
        cols = l.cols;
        i = this.skipSpace(b, l.end);
      }
      const v = this.word(b, i);
      if (!v || (v.w !== "VALUES" && v.w !== "VALUE")) {
        this.flag("INSERT without VALUES");
        this.beginSkip(false);
        return true;
      }
      if (!this.dialectResolved) {
        this.dialect = b.slice(this.pos, i).includes("`") ? "mysql" : "postgres";
        this.dialectResolved = true;
      }
      this.advanceTo(v.end);
      this.current = this.tableFor(q.ident, cols, "insert");
      this.rowsInStatement = 0;
      this.mode = "values";
      return true;
    } catch (e) {
      if (e instanceof Incomplete) throw e;
      this.flag(`bad INSERT header: ${(e as Error).message}`);
      this.beginSkip(false);
      void final;
      return true;
    }
  }

  private tableFor(ident: Ident, cols: string[] | null, source: "insert" | "copy"): SqlTable {
    let key = findKey(this.tables, ident);
    let t = key === null ? undefined : this.tables.get(key);
    if (!t) {
      key = identKey(ident);
      const dk = findKey(this.declared, ident);
      const declared = dk === null ? undefined : this.declared.get(dk);
      t = {
        name: ident.name,
        schema: ident.schema,
        columns: cols ?? declared?.columns ?? [],
        rows: [],
        rowCount: 0,
        truncated: false,
        arityMismatch: 0,
        source,
      };
      this.tables.set(key, t);
      this.order.push(key);
    } else if (cols && t.columns.length === 0) {
      t.columns = cols;
    }
    return t;
  }

  private addRow(t: SqlTable, cells: string[]) {
    t.rowCount++;
    if (t.columns.length > 0 && cells.length !== t.columns.length) {
      t.arityMismatch++;
      if (cells.length > t.columns.length) for (let i = t.columns.length; i < cells.length; i++) t.columns.push(`col${i + 1}`);
    }
    if (this.kept >= this.maxRows) {
      t.truncated = true;
      this.truncated = true;
      return;
    }
    this.kept++;
    t.rows.push(cells);
  }

  private stepValues(final: boolean): boolean {
    const b = this.buf;
    let p: number;
    try {
      p = this.skipSpace(b, this.pos);
      while (b[p] === ",") p = this.skipSpace(b, p + 1);
      if (p >= b.length) throw new Incomplete();
      if (b[p] === ";") {
        this.advanceTo(p + 1);
        this.mode = "top";
        this.current = null;
        return true;
      }
      if (b[p] !== "(") {
        // ON DUPLICATE KEY UPDATE, ON CONFLICT, RETURNING: nothing more to read.
        if (this.rowsInStatement === 0 && !/^(?:on|returning)\b/i.test(b.slice(p, p + 12))) this.flag("VALUES without a row");
        this.advanceTo(p);
        this.beginSkip(false);
        return true;
      }
      const t = this.parseTuple(b, p);
      this.advanceTo(t.end);
      this.addRow(this.current!, t.cells);
      this.rowsInStatement++;
      return true;
    } catch (e) {
      if (e instanceof Incomplete) {
        if (final) {
          this.flag("incomplete row at end of input");
          this.advanceTo(b.length);
          this.mode = "top";
        }
        return false;
      }
      this.flag(`bad row: ${(e as Error).message}`);
      // Resync: skip to the end of this statement.
      this.beginSkip(false);
      return true;
    }
  }

  private parseTuple(b: string, start: number): { cells: string[]; end: number } {
    const cells: string[] = [];
    let i = start + 1;
    for (;;) {
      i = this.skipSpace(b, i);
      if (i >= b.length) throw new Incomplete();
      const v = this.readValue(b, i);
      cells.push(v.value);
      i = this.skipSpace(b, v.end);
      if (i >= b.length) throw new Incomplete();
      if (b[i] === ",") {
        i++;
        continue;
      }
      if (b[i] === ")") return { cells, end: i + 1 };
      throw new Error("expected , or )");
    }
  }

  private readValue(b: string, p: number): { value: string; end: number } {
    const c = b[p]!;
    // String literals, with an optional E, N or _charset prefix directly before the quote.
    let q = p;
    let eString = false;
    const prefix = /^(?:[EeNn]|_[A-Za-z0-9]+|[Xx]|[Bb])(?=')/.exec(b.slice(p, p + 20));
    if (prefix) {
      eString = prefix[0].toLowerCase() === "e";
      q = p + prefix[0].length;
    }
    if (b[q] === "'") {
      const s = this.readString(b, q, this.backslash || eString);
      const isHexOrBit = prefix && /^[XxBb]$/.test(prefix[0]);
      const tail = this.skipTail(b, s.end);
      return { value: isHexOrBit ? `${prefix![0]}'${s.value}'` : s.value, end: tail };
    }
    if (c === "$") {
      const open = DOLLAR_OPEN.exec(b.slice(p, p + 64));
      if (open) {
        const close = b.indexOf(open[0], p + open[0].length);
        if (close === -1) throw new Incomplete();
        return { value: b.slice(p + open[0].length, close), end: this.skipTail(b, close + open[0].length) };
      }
    }
    // A raw token: number, NULL, TRUE, a function call. Stops at a top-level comma or closing bracket.
    let depth = 0;
    let i = p;
    for (;;) {
      if (i >= b.length) throw new Incomplete();
      const ch = b[i]!;
      if (ch === "'") {
        i = this.readString(b, i, this.backslash).end;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
      i++;
    }
    const raw = b.slice(p, i).trim();
    if (!raw.includes("(") && /\s/.test(raw)) throw new Error("bad value");
    if (/^null$/i.test(raw) || /^default$/i.test(raw)) return { value: "", end: i };
    return { value: raw, end: i };
  }

  /** After a string literal: a cast such as `::text` or a COLLATE clause. Skipped to the next `,` or `)`. */
  private skipTail(b: string, p: number): number {
    let i = p;
    let depth = 0;
    for (;;) {
      if (i >= b.length) throw new Incomplete();
      const ch = b[i]!;
      if (ch === "'") {
        // Two literals side by side (`'a' 'b'`) are not supported: stop and let the caller see an error.
        return i;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) return i;
        depth--;
      } else if (ch === "," && depth === 0) return i;
      else if (!/[\s:A-Za-z0-9_[\]"]/.test(ch) && depth === 0) return i;
      i++;
    }
  }

  private readString(b: string, start: number, escapes: boolean): { value: string; end: number } {
    let out = "";
    let i = start + 1;
    for (;;) {
      const j = this.nextSpecial(b, i, escapes);
      if (j === -1) throw new Incomplete();
      out += b.slice(i, j);
      const ch = b[j]!;
      if (ch === "'") {
        if (b[j + 1] === "'") {
          out += "'";
          i = j + 2;
          continue;
        }
        if (j + 1 >= b.length) throw new Incomplete();
        return { value: out, end: j + 1 };
      }
      // backslash
      if (j + 1 >= b.length) throw new Incomplete();
      const e = this.unescape(b, j, this.backslash);
      out += e.text;
      i = e.end;
    }
  }

  private nextSpecial(b: string, from: number, escapes: boolean): number {
    const q = b.indexOf("'", from);
    if (!escapes) return q;
    const s = b.indexOf("\\", from);
    if (q === -1) return s;
    if (s === -1) return q;
    return Math.min(q, s);
  }

  /** One backslash escape at b[j]. Needs enough text after it for `\xHH` and `\uXXXX`. */
  private unescape(b: string, j: number, mysql: boolean): { text: string; end: number } {
    const n = b[j + 1]!;
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0", Z: "\x1a", "'": "'", '"': '"', "\\": "\\" };
    if (!mysql && n === "x" && /^[0-9A-Fa-f]{1,2}/.test(b.slice(j + 2, j + 4))) {
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(b.slice(j + 2, j + 4))![0];
      if (j + 2 + hex.length >= b.length) throw new Incomplete();
      return { text: String.fromCharCode(parseInt(hex, 16)), end: j + 2 + hex.length };
    }
    if (!mysql && n === "u" && /^[0-9A-Fa-f]{4}/.test(b.slice(j + 2, j + 6))) {
      return { text: String.fromCharCode(parseInt(b.slice(j + 2, j + 6), 16)), end: j + 6 };
    }
    if (!mysql && /[0-7]/.test(n) && n !== "0") {
      const oct = /^[0-7]{1,3}/.exec(b.slice(j + 1, j + 4))![0];
      return { text: String.fromCharCode(parseInt(oct, 8)), end: j + 1 + oct.length };
    }
    if (n in simple) return { text: simple[n]!, end: j + 2 };
    // MySQL keeps the backslash for \% and \_ (they are LIKE escapes); anything else is the character itself.
    if (mysql && (n === "%" || n === "_")) return { text: `\\${n}`, end: j + 2 };
    return { text: n, end: j + 2 };
  }

  // ---------------------------------------------------------------- COPY

  private beginCopy(final: boolean): boolean {
    const b = this.buf;
    try {
      let i = this.skipSpace(b, this.word(b, this.pos)!.end);
      const q = this.readQualifiedName(b, i);
      if (!q) throw new Error("no table name");
      i = q.end;
      let cols: string[] | null = null;
      if (b[i] === "(") {
        const l = this.readColumnList(b, i);
        cols = l.cols;
        i = this.skipSpace(b, l.end);
      }
      const from = this.word(b, i);
      if (!from || (from.w !== "FROM" && from.w !== "TO")) throw new Error("expected FROM");
      i = this.skipSpace(b, from.end);
      const src = this.word(b, i);
      // Find the end of the statement: the first `;` outside quotes.
      let e = src ? src.end : i;
      let inQ = false;
      for (;; e++) {
        if (e >= b.length) throw new Incomplete();
        if (b[e] === "'") inQ = !inQ;
        else if (b[e] === ";" && !inQ) break;
      }
      const header = b.slice(i, e);
      const nl = b.indexOf("\n", e);
      if (nl === -1) throw new Incomplete();
      this.dialect = "postgres";
      this.dialectResolved = true;
      const fromStdin = from.w === "FROM" && src?.w === "STDIN";
      this.advanceTo(nl + 1);
      if (!fromStdin) {
        this.flag("COPY not from stdin: no data in the file");
        this.mode = "top";
        return true;
      }
      this.copyDiscard = /\b(csv|binary)\b/i.test(header);
      if (this.copyDiscard) this.flag("COPY in csv or binary format is not read");
      this.current = this.copyDiscard ? null : this.tableFor(q.ident, cols, "copy");
      this.mode = "copy";
      return true;
    } catch (e) {
      if (e instanceof Incomplete) throw e;
      this.flag(`bad COPY header: ${(e as Error).message}`);
      this.beginSkip(false);
      void final;
      return true;
    }
  }

  private stepCopy(final: boolean): boolean {
    const b = this.buf;
    for (;;) {
      if (this.pos >= b.length) return false;
      const nl = b.indexOf("\n", this.pos);
      if (nl === -1 && !final) return false;
      const end = nl === -1 ? b.length : nl;
      let line = b.slice(this.pos, end);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.advanceTo(nl === -1 ? b.length : nl + 1);
      if (line === "\\.") {
        this.mode = "top";
        this.current = null;
        return true;
      }
      if (this.copyDiscard || !this.current) continue;
      if (line === "" && this.current.columns.length !== 1) {
        this.flag("blank line inside COPY data", this.line - 1);
        continue;
      }
      this.addRow(this.current, parseCopyLine(line));
    }
  }

  // ---------------------------------------------------------------- skip

  private stepSkip(final: boolean): boolean {
    const b = this.buf;
    const s = this.skip;
    let i = this.pos;
    while (i < b.length) {
      const ch = b[i]!;
      if (s.lineComment) {
        if (ch === "\n") s.lineComment = false;
      } else if (s.blockComment) {
        if (ch === "*" && b[i + 1] === "/") {
          s.blockComment = false;
          i++;
        } else if (ch === "*" && i + 1 >= b.length && !final) break;
      } else if (s.dollar !== null) {
        if (ch === "$" && b.startsWith(s.dollar, i)) {
          i += s.dollar.length - 1;
          s.dollar = null;
        } else if (ch === "$" && !final && i + s.dollar.length > b.length) break;
      } else if (s.quote !== null) {
        if (s.esc) s.esc = false;
        else if (ch === "\\" && (this.backslash || (s.quote === "'" && s.eString))) s.esc = true;
        else if (ch === s.quote) {
          if (b[i + 1] === s.quote) i++;
          else if (i + 1 >= b.length && !final) break;
          else s.quote = null;
        }
      } else if (!final && (ch === "-" || ch === "/") && i + 1 >= b.length) {
        break;
      } else if (!final && ch === "$" && i + 64 > b.length) {
        break;
      } else if (ch === "-" && b[i + 1] === "-") {
        s.lineComment = true;
        i++;
      } else if (ch === "/" && b[i + 1] === "*") {
        s.blockComment = true;
        i++;
      } else if (ch === "'" || ch === '"' || ch === "`") {
        s.quote = ch;
        s.eString = ch === "'" && /[Ee]/.test(b[i - 1] ?? "") && !/[A-Za-z0-9_]/.test(b[i - 2] ?? " ");
      } else if (ch === "$") {
        const open = DOLLAR_OPEN.exec(b.slice(i, i + 64));
        if (open) {
          s.dollar = open[0];
          i += open[0].length - 1;
        }
      } else if (ch === ";") {
        this.captureText(b.slice(this.pos, i));
        this.advanceTo(i + 1);
        this.endSkip();
        return true;
      }
      i++;
    }
    this.captureText(b.slice(this.pos, i));
    this.advanceTo(i);
    if (final) this.endSkip();
    return false;
  }

  private captureText(text: string) {
    if (this.capture !== null && this.capture.length < MAX_CAPTURE) this.capture += text;
  }

  private endSkip() {
    if (this.capture !== null) this.parseCreate(this.capture);
    this.capture = null;
    this.mode = "top";
  }

  private parseCreate(textIn: string) {
    const text = textIn.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    const m = /^\s*CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(text);
    if (!m) return;
    let ident: { ident: Ident; end: number } | null = null;
    try {
      ident = this.readQualifiedName(text + " ", m[0].length);
    } catch {
      return;
    }
    if (!ident) return;
    const open = text.indexOf("(", ident.end);
    if (open === -1) return;
    // Body up to the matching close.
    let depth = 0;
    let end = -1;
    let quote: string | null = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return;
    const items: string[] = [];
    let cur = "";
    depth = 0;
    quote = null;
    for (const c of text.slice(open + 1, end)) {
      if (quote) {
        if (c === quote) quote = null;
        cur += c;
      } else if (c === "'" || c === '"' || c === "`") {
        quote = c;
        cur += c;
      } else if (c === "(") {
        depth++;
        cur += c;
      } else if (c === ")") {
        depth--;
        cur += c;
      } else if (c === "," && depth === 0) {
        items.push(cur);
        cur = "";
      } else cur += c;
    }
    if (cur.trim() !== "") items.push(cur);
    const columns: string[] = [];
    for (const it of items) {
      const t = it.trim();
      if (t === "" || CONSTRAINT_WORDS.test(t)) continue;
      try {
        const id = this.readIdent(t + " ", 0);
        if (id) columns.push(id.value);
      } catch {
        /* not a column definition */
      }
    }
    this.declared.set(identKey(ident.ident), { ident: ident.ident, columns });
    const tk = findKey(this.tables, ident.ident);
    const t = tk === null ? undefined : this.tables.get(tk);
    if (t && t.columns.length === 0) t.columns = columns;
  }
}

/** One text-format COPY line: tab separated, `\N` is NULL (an empty cell), backslash escapes are undone. */
export function parseCopyLine(line: string): string[] {
  return line.split("\t").map((f) => (f === "\\N" ? "" : f.includes("\\") ? unescapeCopy(f) : f));
}

function unescapeCopy(f: string): string {
  let out = "";
  for (let i = 0; i < f.length; i++) {
    const c = f[i]!;
    if (c !== "\\" || i + 1 >= f.length) {
      out += c;
      continue;
    }
    const n = f[++i]!;
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "\\": out += "\\"; break;
      case "x": {
        const h = /^[0-9A-Fa-f]{1,2}/.exec(f.slice(i + 1, i + 3));
        if (h) {
          out += String.fromCharCode(parseInt(h[0], 16));
          i += h[0].length;
        } else out += "x";
        break;
      }
      default:
        if (/[0-7]/.test(n)) {
          const o = /^[0-7]{1,3}/.exec(f.slice(i, i + 3))![0];
          out += String.fromCharCode(parseInt(o, 8));
          i += o.length - 1;
        } else out += n;
    }
  }
  return out;
}

/** Convenience for tests and small files: the whole dump as one string. The browser path uses `SqlReader.push`. */
export function parseSql(text: string, opts: SqlReaderOptions & { chunkSize?: number } = {}): SqlResult {
  const r = new SqlReader(opts);
  const size = opts.chunkSize ?? text.length;
  for (let i = 0; i < text.length || i === 0; i += Math.max(size, 1)) r.push(text.slice(i, i + size));
  return r.finish();
}

/** Tables as blocks: the table name is the sheet name, the columns are the header. Empty tables are left out. */
export function sqlTablesToBlocks(tables: readonly SqlTable[]): ReadBlock[] {
  const kept = tables.filter((t) => t.rows.length > 0);
  // Two tables with one bare name (public.log, audit.log) are told apart by their schema.
  const shared = (t: SqlTable) => kept.filter((x) => x.name.toLowerCase() === t.name.toLowerCase()).length > 1;
  return kept
    .map((t) => ({
      sheetName: t.schema && shared(t) ? `${t.schema}.${t.name}` : t.name,
      title: null,
      headerRow: 0,
      headerRows: 1 as const,
      headers: t.columns,
      rows: t.rows,
      firstDataSheetRow: 1,
    }));
}
