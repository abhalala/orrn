import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test support: the sentences the server's die room, orders and approval routers can raise, read out of
 * their source. Used by the refusal completeness tests of apps/native and apps/web (and packages/i18n):
 * a new sentence with no entry in `SERVER_REFUSALS` fails them until it is mapped. Never imported by app code.
 */
const SRC = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "server", "src", rel), "utf8");

export const PLACEHOLDER = "7";

// ---------------------------------------------------------------------------
// Reading the server's sentences out of its source
// ---------------------------------------------------------------------------

/** Past a `${ ... }` expression that starts after the `{`; returns the index of the closing `}`. */
function skipInterpolation(src: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") i = skipQuoted(src, i);
    else if (c === "`") i = skipTemplate(src, i).end;
    else {
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
  }
  throw new Error("unterminated interpolation");
}

function skipQuoted(src: string, at: number): number {
  const q = src[at]!;
  let i = at + 1;
  while (src[i] !== q) i += src[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** A template literal starting at the backtick: its text with every `${}` as the placeholder, and where it ends. */
function skipTemplate(src: string, at: number): { text: string; end: number } {
  let i = at + 1;
  let text = "";
  while (src[i] !== "`") {
    if (src[i] === "\\") {
      text += src[i + 1];
      i += 2;
    } else if (src[i] === "$" && src[i + 1] === "{") {
      i = skipInterpolation(src, i + 2) + 1;
      text += PLACEHOLDER;
    } else text += src[i++];
  }
  return { text, end: i + 1 };
}

/** Every string literal of the expression that starts at `from`, up to its end (a depth-0 comma or closer). */
function literalsOfExpression(src: string, from: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const end = skipQuoted(src, i);
      out.push(JSON.parse(c === '"' ? src.slice(i, end) : `"${src.slice(i + 1, end - 1).replace(/"/g, '\\"')}"`));
      i = end;
    } else if (c === "`") {
      const t = skipTemplate(src, i);
      out.push(t.text);
      i = t.end;
    } else if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
    } else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
      i++;
    } else if (c === "," && depth === 0) break;
    else i++;
  }
  return out;
}

/** `message: <expr>` in a file: every sentence the expression can produce. */
function messageSentences(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bmessage:\s*/g)) {
    const from = m.index! + m[0].length;
    // `message: copyBusyMessage(instance, "sent to nitriding")` is a call: its sentence is composed (see composedSentences).
    if (/^[A-Za-z_]\w*\(/.test(src.slice(from, from + 40))) continue;
    out.push(...literalsOfExpression(src, from));
  }
  return out;
}

/** The string literals of the statement that starts at `startMarker`, up to its first `;` outside a literal. */
function blockLiterals(src: string, startMarker: string): string[] {
  const at = src.indexOf(startMarker);
  expect({ marker: startMarker, found: at > -1 }).toEqual({ marker: startMarker, found: true });
  const out: string[] = [];
  let i = at;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      const e = skipQuoted(src, i);
      out.push(JSON.parse(src.slice(i, e)));
      i = e;
    } else if (c === "`") {
      const t = skipTemplate(src, i);
      out.push(t.text);
      i = t.end;
    } else if (c === ";") break;
    else i++;
  }
  return out;
}

/** The sentences the routers compose from a subject and a phrase held in a table or ternary. */
function composedSentences(): string[] {
  const issue = SRC("routers/dieIssue.ts");
  const maker = SRC("routers/dieMaker.ts");
  const inst = SRC("routers/dieInstance.ts");
  const flow = SRC("routers/orderFlow.ts");
  const phrases = [
    ...blockLiterals(issue, "const STATUS_WORDS"),
    ...blockLiterals(maker, "const where: Record<string, string>"),
  ].filter((p) => /^is /.test(p) && p !== "is 7");
  const busy = blockLiterals(inst, "const where: Record<string, string> = {\n    in_use").filter((p) => /^is /.test(p) && p !== "is 7").map((p) => `${p}; it cannot be sent to nitriding`);
  const whyPhrases = blockLiterals(flow, "const why =").filter((p) => /^is /.test(p)).map((p) => `${PLACEHOLDER} ${p}`);
  const holdWhy = blockLiterals(flow, "const why: Record").filter((p) => p.includes(PLACEHOLDER) && !p.startsWith("Line"));
  // dieIssue.ts lineFullMessage(): "P1 already has A (PR-1) and B (PR-2). Take one back[, or record the die out of A,] before issuing C."
  const lineFull = [`${PLACEHOLDER} already has ${PLACEHOLDER} (${PLACEHOLDER}) and ${PLACEHOLDER}. Take one back before issuing ${PLACEHOLDER}.`, `${PLACEHOLDER} already has ${PLACEHOLDER} (${PLACEHOLDER}) and ${PLACEHOLDER}. Take one back, or record the die out of ${PLACEHOLDER}, before issuing ${PLACEHOLDER}.`];
  return [...lineFull, ...phrases.map((p) => `${PLACEHOLDER} ${p}`), ...busy.map((p) => `${PLACEHOLDER} ${p}`), ...whyPhrases, ...holdWhy];
}

export const FILES = [
  "routers/dieIssue.ts",
  "routers/dieInstance.ts",
  "routers/dieMaker.ts",
  "routers/orderFlow.ts",
  "routers/salesOrder.ts",
  "routers/approval.ts",
  "routers/die.ts",
  "routers/dieBand.ts",
  "routers/dieFile.ts",
  "routers/dieShare.ts",
  "lib/dieFiles.ts",
  "routers/pressPlan.ts",
  "lib/dieOwner.ts",
  "lib/dieRoom.ts",
  "lib/dieTrial.ts",
  "lib/orderLines.ts",
];

/** A sentence that is only placeholders and punctuation is a composite the blocks above spell out. */
const isSentence = (s: string) => /\s/.test(s.trim()) && s.replace(new RegExp(PLACEHOLDER, "g"), "").replace(/[\s.,;:()]/g, "") !== "";

export function serverSentences(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const f of FILES) {
    const src = SRC(f);
    for (const text of messageSentences(src)) if (isSentence(text)) out.push({ file: f, text });
    // requireActiveBand(db, company, section, band, "message")
    for (const m of src.matchAll(/requireActiveBand\(/g)) {
      const end = src.indexOf(");", m.index!);
      const last = blockLiterals(src.slice(m.index!, end + 2), "requireActiveBand(").filter(isSentence).pop();
      if (last) out.push({ file: f, text: last });
    }
  }
  for (const text of composedSentences()) out.push({ file: "composed", text });
  return out.flatMap((s) => realize(s.text).map((text) => ({ file: s.file, text })));
}

/** Where the server puts a status word the reader can only see as a placeholder, the words it can be. */
const REALIZE: [RegExp, string[]][] = [
  [/^This issue is already 7$/, ["This issue is already returned", "This issue is already cancelled"]],
  [/^7 is 7; it cannot be set to 7 from there$/, ["7 is in use; it cannot be set to available from there", "7 is at nitriding; it cannot be set to on trial from there"]],
  [/^7 is already 7$/, ["7 is already received", "7 is already cancelled"]],
  [/^7 7 not held for 7 line 7$/, ["7 is not held for 7 line 7", "7, 7 are not held for 7 line 7"]],
];
const realize = (text: string): string[] => REALIZE.find(([re]) => re.test(text))?.[1] ?? [text];

