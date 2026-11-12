import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { QUESTION_CODES, ROW_DECISIONS } from "@orrn/ingest";

import { answerFromValue } from "./answers";
import { decisionOptions, questionView } from "./model";
import { ingestErrorWords } from "./errors";
import { KNOWN_REFUSAL_CODES, refusalLine, refusalText, refusalTone, SILENT_REASONS } from "./refusals";

/**
 * The server's code lists and the words the web has for them. When the server adds a question, a row reason or a
 * refusal, this file fails until the web says it in English and Hindi (or lists it as not shown, with a reason).
 */

const SERVER_INGEST = join(import.meta.dir, "../../../../../../packages/server/src/lib/ingest");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "bot" ? [] : sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Every snake_case literal on a line that talks about a reason, a row check or a code. A literal may carry a field
 * after a colon (`po_on_live_order:poNumber`); only the code counts. Exported constants named like a reason count too.
 */
export function reasonLiterals(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(SERVER_INGEST)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const line of lines) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      const talks = /reasons?\b|checkReason|\bcode: "|\bREASON|^\s*(export )?const (PO_ON|MERGED_|CHECK_AGAINST|ORDER_[A-Z_]*(UNCLEAR|CHECK))/i.test(line);
      if (!talks) continue;
      for (const m of line.matchAll(/"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?::[A-Za-z]+)?"/g)) found.set(m[1]!, file.slice(SERVER_INGEST.length + 1));
    }
  }
  return found;
}

/**
 * Snake_case literals on those lines that are not a row reason: states, answer values, bot and vault codes, table and
 * column names, error codes. Listed so a new one is a decision, not a surprise.
 */
const NOT_ROW_REASONS = new Set([
  // states, decisions and answer values
  "ready_create", "ready_update", "use_match", "keep_live", "keep_file", "create_new", "owner_merges", "leave_out", "pricing_off",
  "rates_hidden", "magnitude_check", "create_legacy_die", "new_customers", "period_changed",
  // what the reader left out of a table, worded as ingest.read.* on the read panel and the file strip
  "skipped_repeat_header", "skipped_title", "after_last_row",
  // hold and read reasons, worded by `reasonLine`
  "merge_failed", "dependency_held", "module_off", "read_failed", "confirm_blocked", "kept_unread",
  // tables, aliases targets and bot internals
  "ingest_candidate", "customer_aliases", "vendor_aliases", "already_done", "attempts_exhausted", "block_calls", "day_calls",
  "day_cost", "end_turn", "input_too_large", "max_tokens", "no_key", "no_target", "not_a_table", "page_too_large",
  "sample_too_large", "summary_only", "too_many_columns", "unsupported_page", "unsupported_target", "vault_required",
]);

const SERVER_CODES_WITH_WORDS = new Set<string>([...KNOWN_REFUSAL_CODES, ...SILENT_REASONS]);

const get = (tree: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

describe("server codes have words", () => {
  test("every row reason the server writes has words in English and Hindi, or is listed as not a reason", () => {
    const unworded: string[] = [];
    for (const [code, file] of reasonLiterals()) {
      if (NOT_ROW_REASONS.has(code) || SERVER_CODES_WITH_WORDS.has(code)) continue;
      unworded.push(`${code} (${file})`);
    }
    expect(unworded).toEqual([]);
  });

  test("the scan finds the reasons the screens were built for", () => {
    const found = [...reasonLiterals().keys()];
    for (const code of ["po_on_two_orders", "po_on_live_order", "order_in_other_file", "po_on_closed_order", "merged_cell", "order_no_unclear", "section_archived"]) {
      expect(found).toContain(code);
    }
  });

  test("a listed code has a sentence in both dictionaries with the same variables", () => {
    const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]!))].sort().join(",");
    for (const code of KNOWN_REFUSAL_CODES) {
      const key = `ingest.refuse.${code}`;
      const english = get(en, key);
      const hindi = get(hi, key);
      expect({ key, en: typeof english, hi: typeof hindi }).toEqual({ key, en: "string", hi: "string" });
      expect({ key, vars: vars(hindi as string) }).toEqual({ key, vars: vars(english as string) });
    }
  });

  test("a reason with a field turns into a sentence, never into the code", () => {
    for (const code of KNOWN_REFUSAL_CODES) {
      const line = refusalLine(`${code}:poNumber`);
      expect(line === null || line.kind === "refusal").toBe(true);
    }
  });

  test("every question code has a sentence and every one is built into a view", () => {
    for (const code of QUESTION_CODES) {
      const view = questionView({ code, subject: "x", params: {}, answer: null, open: true });
      expect(typeof get(en, view.key)).toBe("string");
      expect(typeof get(hi, view.key)).toBe("string");
    }
  });

  test("every conflict reason offers only choices the server accepts", () => {
    const keep = (reason: string) => decisionOptions({ state: "conflict", options: [], mergeState: "open", reasons: [reason] }).map((o) => o.decision);
    expect(keep("po_on_two_orders:poNumber")).toEqual(["skip"]);
    expect(keep("po_on_live_order:poNumber")).toEqual(["keep_live", "skip"]);
    expect(keep("order_in_other_file:order")).toEqual(["keep_file", "skip"]);
    expect(keep("order_line_new")).toEqual(["keep_live", "skip"]);
    for (const decision of ROW_DECISIONS) expect(typeof decision).toBe("string");
  });

  test("an old order is written whole (rule 7.1): a waiting line can only be skipped, two values in a run keep the file's or skip", () => {
    const options = (state: "ambiguous" | "conflict", reason: string) => decisionOptions({ state, options: [{ id: "x", label: "X" }], mergeState: "open", reasons: [reason] }).map((o) => o.decision);
    expect(options("ambiguous", "order_waits:2")).toEqual(["skip"]);
    expect(options("conflict", "order_run_differs:customer")).toEqual(["keep_file", "skip"]);
  });

  test("the counts in order_waits and order_skipped_lines reach the sentence, and the skipped note is muted", () => {
    expect(refusalLine("order_waits:2")).toEqual({ kind: "refusal", key: "ingest.refuse.order_waits", fieldKey: null, count: 2 });
    const note = refusalLine("order_skipped_lines:1")!;
    expect(note).toMatchObject({ key: "ingest.refuse.order_skipped_lines", count: 1 });
    expect(refusalTone(note)).toBe("note");
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.count}`;
    expect(refusalText(t, note)).toBe("ingest.refuse.order_skipped_lines:1");
    expect(refusalTone(refusalLine("order_waits:2")!)).toBe("amber");
  });

  test("a refusal that says nothing can be imported has words of its own", () => {
    const error = Object.assign(new Error("Nothing in this sheet can be imported. Fix the rows or discard it."), { data: { code: "PRECONDITION_FAILED" } });
    expect(ingestErrorWords(error, "action")).toEqual({ key: "ingest.error.nothingToImport", retry: false });
    expect(typeof get(en, "ingest.error.nothingToImport")).toBe("string");
    expect(typeof get(hi, "ingest.error.nothingToImport")).toBe("string");
  });

  test("the bundles question (rule 7.5) is answered with Import them or Do not import", () => {
    const q = questionView({ code: "bundles_no_old_id", subject: "", params: { count: 4 }, answer: null, open: true });
    expect(q.control.kind).toBe("yesNo");
    expect(q.answers.map((a) => [a.value, a.words.key])).toEqual([[true, "ingest.q.importThem"], [false, "ingest.q.doNotImport"]]);
    expect(answerFromValue("bundles_no_old_id", true)).toEqual({ code: "bundles_no_old_id", answer: true });
  });
});
