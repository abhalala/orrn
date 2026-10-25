import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

import { classifyRefusal, PRESS_REFUSALS, pressErrorView } from "./errors";
import { CLOSE_GATE_CODES, gateKey } from "./model";

const dig = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);
const SERVER = join(import.meta.dir, "../../../../../packages/server/src");
const read = (file: string) => readFileSync(join(SERVER, file), "utf8");

const trpc = (code: string | undefined, message: string, meta?: Record<string, unknown>) => ({ message, data: code ? { code, ...(meta ? { meta } : {}) } : undefined });

describe("every refusal the press screens know has words in en, hi and gu", () => {
  test("each table entry's key exists in all three languages", () => {
    for (const r of PRESS_REFUSALS) {
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ id: r.id, lang: name, type: typeof dig(dict, r.key) }).toEqual({ id: r.id, lang: name, type: "string" });
      }
    }
  });

  test("each entry classifies its own sample, and ids are unique", () => {
    expect(new Set(PRESS_REFUSALS.map((r) => r.id)).size).toBe(PRESS_REFUSALS.length);
    for (const r of PRESS_REFUSALS) expect({ id: r.id, got: classifyRefusal(r.sample)?.id }).toEqual({ id: r.id, got: r.id });
  });

  test("the server still says what the table matches (a reworded server refusal fails here)", () => {
    const source = ["routers/pressRun.ts", "routers/press.ts", "lib/press.ts", "lib/clock.ts"].map(read).join("\n");
    for (const r of PRESS_REFUSALS) expect({ id: r.id, found: source.includes(r.src) }).toEqual({ id: r.id, found: true });
  });

  test("every close gate the server can raise has a sentence in en, hi and gu", () => {
    const block = /const GATE_TEXT[^{]*\{([\s\S]*?)\n\};/.exec(read("routers/pressRun.ts"))?.[1] ?? "";
    const serverCodes = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]!);
    expect(serverCodes.length).toBeGreaterThan(20);
    expect([...serverCodes].sort()).toEqual([...CLOSE_GATE_CODES].sort());
    for (const code of serverCodes) {
      const key = gateKey(code)!;
      for (const dict of [en, hi, gu]) expect({ code, type: typeof dig(dict, key) }).toEqual({ code, type: "string" });
    }
  });

  test("a message in a plain `bad(...)` of the press routers is mapped or knowingly generic", () => {
    // Refusals a client check already stops, or that only a forged call can raise: they fall back
    // to the generic sentence with the server text beneath. Anything new must be mapped or listed.
    const GENERIC_OK = [
      /^Pick the die copy that was used$/,
      /^Name the run/,
      /^Pick the reason for voiding$/,
      /^Add a note for Other$/,
      /^Pick a downtime reason from the list$/,
      /^A trial or sample run has no order lines$/,
      /^An order line is not on this run's plan$/,
      /^There is no cut length row /,
      /^This run has no die copy yet$/,
      /^Only a die trial run takes a pass or fail$/,
      /^PR-12's times are confirmed$/,
      /^PR-12 is voided$/,
      /^PR-12 has another copy issued$/,
      /^PR-12 is not from a plan$/,
      /^This plan is not released yet/,
      /^This is PR-12's only line/,
      /^That run is on another press$/,
      /^That run is closed$/,
      /^The period must end after it starts$/,
      /^PR-12 is urgent; it stays above the other runs$/,
      /^Urgent runs stay at the top; mark PR-12 urgent to move it there$/,
      /^Add a note for Other$/,
    ];
    const found: string[] = [];
    for (const file of ["routers/pressRun.ts", "routers/press.ts"]) {
      for (const m of read(file).matchAll(/\bbad\(\s*([`"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g)) {
        const text = m[2]!.replace(/\$\{STATUS_WORD[^}]*\}/g, "running").replace(/\$\{[^}]*(?:Mm|mm)[^}]*\}/g, "3658").replace(/\$\{[^}]*DAYS[^}]*\}/g, "7").replace(/\$\{[^}]*\}/g, "PR-12");
        found.push(text);
      }
    }
    expect(found.length).toBeGreaterThan(30);
    const unmapped = found.filter((text) => !classifyRefusal(text) && !GENERIC_OK.some((re) => re.test(text)));
    expect(unmapped).toEqual([]);
  });
});

describe("pressErrorView: the person's language first, the server's English only as a second line", () => {
  const view = (locale: "en" | "hi" | "gu", error: unknown, opts?: Parameters<typeof pressErrorView>[2]) => pressErrorView(createI18n(locale).t, error, opts);

  test("a known refusal reads in hi and gu with no server English and no detail line", () => {
    for (const r of PRESS_REFUSALS) {
      for (const locale of ["hi", "gu"] as const) {
        const v = view(locale, trpc(r.code, r.sample));
        expect({ id: r.id, locale, leaked: v.text.includes(r.sample) || v.detail !== null }).toEqual({ id: r.id, locale, leaked: false });
        expect(v.text).not.toMatch(/^press\.console\./);
      }
    }
  });

  test("the numbers of the refusal are in the sentence", () => {
    expect(view("en", trpc("BAD_REQUEST", "Pick the order line for 3658 mm")).text).toBe("Pick the order line for 3658 mm");
    expect(view("hi", trpc("BAD_REQUEST", "A late entry must be within 7 days")).text).toContain("7");
    expect(view("en", trpc("CONFLICT", "PR-3 is being counted now; Count and check was not saved. Reload.")).text).toContain("PR-3");
  });

  test("the busy press, the die owner, the billets left and the late window are mapped", () => {
    expect(view("hi", trpc("CONFLICT", "Another run is running on this press; stop it first")).text).toBe(createI18n("hi").t("press.console.busy"));
    expect(view("gu", trpc("FORBIDDEN", "This die belongs to X", { ownerName: "Royal Aluminium" })).text).toContain("Royal Aluminium");
    expect(view("en", trpc("CONFLICT", "Only 2.400 kg of cast K31 is left", { gates: ["billet_short_reason_missing"], billetsOnHandG: 2400 })).text).toContain("2.4");
    expect(view("en", trpc("BAD_REQUEST", "A late entry must be within 7 days")).text).toContain("7");
  });

  test("a refused close carries gate codes: each is a sentence of the screen", () => {
    const v = view("gu", trpc("BAD_REQUEST", "Enter the billets used", { gates: ["no_billets", "no_cast"] }));
    expect(v.text).toContain(createI18n("gu").t("press.console.gates.no_billets"));
    expect(v.text).toContain(createI18n("gu").t("press.console.gates.no_cast"));
    expect(v.detail).toBeNull();
  });

  test("an unknown message falls back to a generic sentence in the person's language, server text beneath", () => {
    for (const locale of ["en", "hi", "gu"] as const) {
      const v = view(locale, trpc("BAD_REQUEST", "Brand new refusal nobody mapped"));
      expect(v.text).toBe(createI18n(locale).t("press.console.errors.generic"));
      expect(v.text).not.toContain("Brand new");
      expect(v.detail).toBe("Brand new refusal nobody mapped");
    }
    // The caller's own fallback sentence replaces the generic one, still with the detail beneath.
    expect(view("hi", trpc("BAD_REQUEST", "Something odd"), { fallback: "press.console.startFailed" })).toEqual({
      text: createI18n("hi").t("press.console.startFailed"),
      detail: "Something odd",
    });
  });

  test("a zod JSON message, an over-long one and a dropped connection never show as detail", () => {
    expect(view("en", trpc("BAD_REQUEST", '[{"code":"too_small"}]')).detail).toBeNull();
    expect(view("en", trpc("BAD_REQUEST", "x".repeat(400))).detail).toBeNull();
    expect(view("hi", trpc(undefined, "Failed to fetch"))).toEqual({ text: createI18n("hi").t("press.console.saveFailed"), detail: null });
  });

  test("an unmapped CONFLICT says it changed; with conflictReason it quotes the server's reason (reopen blockers)", () => {
    const plain = view("en", trpc("CONFLICT", "Something else changed"));
    expect(plain.text).toBe(createI18n("en").t("press.console.errors.conflict"));
    expect(plain.detail).toBe("Something else changed");
    const blocked = view("hi", trpc("CONFLICT", "Ageing row AG-4 points at this run"), { conflictReason: true });
    expect(blocked.text).toContain('"Ageing row AG-4 points at this run"');
    expect(blocked.detail).toBeNull();
  });
});

describe("the short-stock hint states D22 (review r1 I-2)", () => {
  test("the run is logged with the weighed kg and the cast shows the shortfall; the stock figure is never what posts", () => {
    const hint = (dict: unknown, key: string) => dig(dict, `press.console.${key}`) as string;
    expect(hint(en, "shortStock")).toContain("logged with the weighed kg");
    expect(hint(en, "shortStock")).toContain("billets short by {short} kg");
    expect(hint(en, "shortStockNoFigure")).toContain("logged with the weighed kg");
    for (const dict of [en, hi, gu]) {
      for (const key of ["shortStock", "shortStockNoFigure"]) expect(hint(dict, key)).not.toMatch(/\bposts?\b/);
      expect(hint(dict, "shortStock")).toContain("{kg}");
      expect(hint(dict, "shortStock")).toContain("{short}");
    }
  });
});
