import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

import { blockerText } from "../features/orders/order-model";
import { RequestTimeoutError } from "../lib/request-timeout";
import { blockersOf, keyOf, mapSentence, SERVER_REFUSALS, serverRefusal, serverRefusalLines, type RefusalEntry } from "../lib/server-refusal";

const REPO = join(import.meta.dir, "..", "..", "..");
const SRC = (rel: string) => readFileSync(join(REPO, "packages/server/src", rel), "utf8");

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
}

// ---------------------------------------------------------------------------
// Reading the server's sentences out of its source
// ---------------------------------------------------------------------------

const PLACEHOLDER = "7";

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
  return [...phrases.map((p) => `${PLACEHOLDER} ${p}`), ...busy.map((p) => `${PLACEHOLDER} ${p}`), ...whyPhrases, ...holdWhy];
}

const FILES = [
  "routers/dieIssue.ts",
  "routers/dieInstance.ts",
  "routers/dieMaker.ts",
  "routers/orderFlow.ts",
  "routers/salesOrder.ts",
  "routers/pressPlan.ts",
  "lib/dieOwner.ts",
  "lib/dieRoom.ts",
  "lib/dieTrial.ts",
  "lib/orderLines.ts",
];

/** A sentence that is only placeholders and punctuation is a composite the blocks above spell out. */
const isSentence = (s: string) => /\s/.test(s.trim()) && s.replace(new RegExp(PLACEHOLDER, "g"), "").replace(/[\s.,;:()]/g, "") !== "";

function serverSentences(): { file: string; text: string }[] {
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

/** Sentences the phone is deliberately not given a key for, each with its reason. Nothing here may be reachable from a native screen. */
const ALLOWED_UNMAPPED: { text: RegExp; why: string }[] = [
  // (none today: every server sentence in these files has a key)
];

const matches = (s: string): RefusalEntry | undefined => SERVER_REFUSALS.find((e) => e.re.test(s));
const isBlockers = (s: string) => blockersOf(s) !== null;

// ---------------------------------------------------------------------------

describe("every die room and orders refusal has a sentence in the person's language (BACKLOG 29, 43)", () => {
  const sentences = serverSentences();

  test("the source reader finds the sentences (guards the reader itself)", () => {
    expect(sentences.length).toBeGreaterThan(150);
    const texts = sentences.map((s) => s.text);
    expect(texts).toContain("Pick the die copy");
    expect(texts).toContain("7 is already issued to a press");
    expect(texts).toContain("7 is held on dispatch 7");
    expect(texts).toContain("PO 7 is already on 7 for this customer");
    expect(texts).toContain("7 line 7: 7 kg asked, only 7 kg is left to plan");
    expect(texts).toContain("Fill these before confirming: 7");
  });

  test("no sentence is left without a key", () => {
    const unmapped = sentences.filter((s) => !isBlockers(s.text) && !matches(s.text) && !ALLOWED_UNMAPPED.some((a) => a.text.test(s.text)));
    expect(unmapped.map((s) => `${s.file}: ${s.text}`)).toEqual([]);
  });

  test("every allow-list row still matters and states a reason", () => {
    for (const a of ALLOWED_UNMAPPED) {
      expect(a.why.length).toBeGreaterThan(10);
      expect(sentences.some((s) => a.text.test(s.text))).toBe(true);
    }
  });

  test("no entry is dead: each one is the first match of at least one server sentence", () => {
    const hit = new Set<RefusalEntry>();
    for (const s of sentences) {
      const e = matches(s.text);
      if (e) hit.add(e);
    }
    expect(SERVER_REFUSALS.filter((e) => !hit.has(e)).map((e) => `${e.id}: ${e.re}`)).toEqual([]);
  });

  test("each entry's key exists in English, Hindi and Gujarati", () => {
    for (const e of SERVER_REFUSALS) {
      const k = keyOf(e);
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        if (name === "gu" && !k.startsWith("native.refusal.")) continue; // errors.* and orders.* are gu-by-fallback shared keys
        expect({ key: k, lang: name, text: typeof lookup(dict, k) }).toEqual({ key: k, lang: name, text: "string" });
      }
    }
  });

  test("every native.refusal key is used by an entry (or the generic line), and no entry is shadowed by an earlier one", () => {
    const used = new Set<string>(SERVER_REFUSALS.map(keyOf));
    used.add("native.refusal.unknown");
    used.add("native.refusal.stillNeeds");
    used.add("native.refusal.owned");
    used.add("native.refusal.ownedOther");
    const all = Object.keys((en as unknown as { native: { refusal: Record<string, string> } }).native.refusal).map((k) => `native.refusal.${k}`);
    expect(all.filter((k) => !used.has(k))).toEqual([]);
  });

  test("a mapped sentence uses the variables its text names, in all three languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]!).sort();
    const bundledVars: Record<string, string[]> = {};
    for (const s of sentences) {
      const e = matches(s.text);
      if (!e || !e.vars) continue;
      const m = e.re.exec(s.text)!;
      // The status words are the app's own; give the entry a real one where the server names a state.
      const t = createI18n("en").t;
      const v = e.vars(m, t);
      if (v === null) continue; // a status word the placeholder is not (checked below)
      bundledVars[keyOf(e)] = Object.keys(v).sort();
    }
    for (const [key, names] of Object.entries(bundledVars)) {
      for (const dict of [en, hi, gu]) {
        const text = lookup(dict, key);
        if (typeof text !== "string") continue;
        expect({ key, vars: placeholders(text) }).toEqual({ key, vars: names.filter((n) => placeholders(text).includes(n)).sort() });
        for (const n of placeholders(text)) expect({ key, n, given: names.includes(n) }).toEqual({ key, n, given: true });
      }
    }
  });
});

describe("what a person is told", () => {
  const trpc = (code: string, message: string, meta?: Record<string, unknown>) => ({ message, data: { code, httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400, ...(meta ? { meta } : {}) } });
  const LANGS = { en: createI18n("en").t, hi: createI18n("hi").t, gu: createI18n("gu").t } as const;

  test("a known refusal is said from the dictionary with its names", () => {
    expect(serverRefusal(trpc("CONFLICT", "12170-2 is already issued to P1"), LANGS.en)).toBe("12170-2 is already issued to P1.");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is out at nitriding"), LANGS.en)).toBe("12170-2 can't be used for this now. Status: At nitriding.");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is issued to a press; it cannot be sent to nitriding"), LANGS.hi)).toContain("12170-2");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is out at nitriding"), LANGS.hi)).not.toMatch(/[A-Za-z]{4,} (?:can't|is|has)/);
    expect(serverRefusal(trpc("CONFLICT", "12170-2 or PR-4 changed meanwhile; nothing was issued"), LANGS.gu)).not.toContain("meanwhile");
  });

  test("the words the server names are the app's own, per language", () => {
    const m = "Only a booking can be confirmed (this order is closed)";
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.en)).toBe("Only a booking can be confirmed. This order is Closed.");
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.hi)).toContain(LANGS.hi("orders.status.closed"));
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.gu)).toContain(LANGS.gu("orders.status.closed"));
    expect(serverRefusal(trpc("BAD_REQUEST", "Only a draft plan can be released (this plan is released)"), LANGS.en)).toContain("Released");
    expect(serverRefusal(trpc("BAD_REQUEST", "An edit can't move the order from confirmed to booking. Use Confirm, Close or Cancel."), LANGS.en)).toBe(
      "An edit can't move the order from Confirmed to Booking. Use Confirm, Close or Cancel.",
    );
  });

  test("an owned die names its owner, from the server's meta first", () => {
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to KD Extrusion", { ownerName: "KD Extrusion" }), LANGS.en)).toBe("This die belongs to KD Extrusion.");
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to KD Extrusion"), LANGS.hi)).toBe(LANGS.hi("native.refusal.owned", { name: "KD Extrusion" }));
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to another customer"), LANGS.en)).toBe("This die belongs to another customer.");
    expect(serverRefusal(trpc("FORBIDDEN", "Missing permission die.issue"), LANGS.en)).toBe(LANGS.en("errors.forbidden"));
  });

  test("a sentence this build does not know is never shown or spoken", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = LANGS[lang];
      const said = serverRefusal(trpc("BAD_REQUEST", "Some new English sentence the server learnt"), t);
      expect(said).toBe(t("native.refusal.unknown"));
      expect(said).not.toContain("Some new");
    }
    expect(serverRefusal(trpc("CONFLICT", "Brand new conflict"), LANGS.en)).toBe(LANGS.en("errors.conflict"));
    expect(serverRefusal(trpc("NOT_FOUND", "Brand new miss"), LANGS.en)).toBe(LANGS.en("errors.notFound"));
    expect(serverRefusal(trpc("BAD_REQUEST", '[{"code":"too_small","message":"Required"}]'), LANGS.en)).toBe(LANGS.en("native.refusal.unknown"));
    expect(serverRefusal(trpc("INTERNAL_SERVER_ERROR", "boom"), LANGS.en)).toBe(LANGS.en("native.saveUnsureBody"));
  });

  test("a status word this build does not know falls to the generic line, not to English", () => {
    expect(serverRefusal(trpc("BAD_REQUEST", "A paused order can't be closed"), LANGS.hi)).toBe(LANGS.hi("native.refusal.unknown"));
  });

  test("an answer that never came says to check first, a lapsed session says to sign in", () => {
    expect(serverRefusal(new RequestTimeoutError(60_000), LANGS.en)).toBe(LANGS.en("native.saveUnsureBody"));
    expect(serverRefusal({ message: "x", data: { code: "UNAUTHORIZED", httpStatus: 401 } }, LANGS.en)).toBe(LANGS.en("errors.sessionExpired"));
  });

  test("a refused confirm lists what the order still needs, one line each, in the language", () => {
    const lines = (t: (typeof LANGS)[keyof typeof LANGS]) =>
      serverRefusalLines(trpc("BAD_REQUEST", "Fill these before confirming: po_number, line_1_alloy, line_2_wat"), t, (c) => blockerText(c, t));
    expect(lines(LANGS.en).slice(0, 2)).toEqual(["Add the PO number.", "Line 1: add the alloy"]);
    expect(lines(LANGS.en)[2]).toBe(LANGS.en("native.refusal.unknown")); // an unknown blocker code is not echoed
    expect(lines(LANGS.hi)[0]).toBe(LANGS.hi("orders.blockers.po_number"));
    const edit = serverRefusalLines(trpc("BAD_REQUEST", "This order is confirmed; it still needs: po_number"), LANGS.en, (c) => blockerText(c, LANGS.en));
    expect(edit).toEqual(["This order is Confirmed. It still needs:", "Add the PO number."]);
  });

  test("mapSentence leaves a sentence it does not know alone", () => {
    expect(mapSentence("Something else entirely", LANGS.en)).toBeNull();
  });
});
