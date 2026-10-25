import { describe, expect, test } from "bun:test";

import { createI18n } from "./core";
import { en } from "./en";
import { GU_FLOOR_NAMESPACES, GU_REASON_FLOOR_KINDS, gu } from "./gu";

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const varsOf = (s: string) =>
  [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1] as string))].sort().join(",");

const enFlat = flatten(en as Tree);
const guFlat = flatten(gu as unknown as Tree);

describe("Gujarati: partial, floor namespaces complete", () => {
  test("every gu key exists in en", () => {
    expect([...guFlat.keys()].filter((k) => !enFlat.has(k))).toEqual([]);
  });

  test("floor namespaces have every en key", () => {
    for (const ns of GU_FLOOR_NAMESPACES) {
      const missing = [...enFlat.keys()].filter((k) => k.startsWith(`${ns}.`) && !guFlat.has(k));
      expect({ ns, missing }).toEqual({ ns, missing: [] });
    }
  });

  test("reasons: every floor kind and every code of it, plus the kind names, are in gu", () => {
    for (const kind of GU_REASON_FLOOR_KINDS) {
      const missing = [...enFlat.keys()].filter((k) => k.startsWith(`reasons.${kind}.`) && !guFlat.has(k));
      expect({ kind, missing }).toEqual({ kind, missing: [] });
    }
    // The other kinds are translated as well (they were free to fall back, but the codes are few).
    const missingAll = [...enFlat.keys()].filter((k) => k.startsWith("reasons.") && !guFlat.has(k));
    expect(missingAll).toEqual([]);
  });

  test("reasons: a seeded code is a real Gujarati word, not the English default", () => {
    for (const [key, value] of guFlat) {
      if (!key.startsWith("reasons.") || key === "reasons.kinds.other") continue;
      if (value === enFlat.get(key)) {
        // Plant words kept in Latin are fine only when mixed with Gujarati (Die બદલી); a bare English label is not.
        expect({ key, value }).toEqual({ key, value: "(translated)" });
      }
    }
  });

  test("same {vars} as en, no empty strings", () => {
    const bad = [...guFlat].filter(([k, v]) => v.trim() === "" || varsOf(v) !== varsOf(enFlat.get(k) ?? ""));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  test("copy rules: no dashes, arrows, curly quotes; no banned words; one middle dot at most", () => {
    const all = [...guFlat.values()];
    expect(all.filter((s) => /[–—→‘’“”]/.test(s))).toEqual([]);
    expect(all.filter((s) => /spool|receipt|tenant|mutation/i.test(s))).toEqual([]);
    expect(all.filter((s) => (s.match(/·/g) ?? []).length > 1)).toEqual([]);
  });

  test("a missing gu key falls back to English", () => {
    const { t } = createI18n("gu");
    expect(t("pack.title")).toBe("પૅકિંગ");
    expect(createI18n("gu").t("errors.notFound")).toBe(en.errors.notFound);
  });
});
