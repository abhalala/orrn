/**
 * Lengths on the order, plan and dispatch screens follow the plant's length unit (units layer, review fix): a plant on metres
 * read "3658 mm" on these screens while stock and pack read "3.658 m", because they called the domain's mm and inch helper.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { cutLengthText } from "./fmt-text";

const at = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const metres = formatterFor(screenPrefs({ units: { length: "m" } }), at);
const inch = formatterFor(screenPrefs({ units: { length: "ft_in" } }), at);
const mm = formatterFor(screenPrefs({}), at);

describe("a length on a screen", () => {
  test("metres read 3.658 m, feet and inches 12 ft, a plant on mm 3658 mm", () => {
    expect(metres.q("bundle.length", 3658)).toBe("3.658 m");
    expect(inch.q("bundle.length", 3658)).toBe("12 ft");
    expect(mm.q("bundle.length", 3658)).toBe("3658 mm");
  });
  test("the ageing report column has no unit in its header: bare mm for a plant on mm, a unit otherwise", () => {
    expect(cutLengthText(mm, 3658)).toBe("3658");
    expect(cutLengthText(metres, 3658)).toBe("3.658 m");
    expect(cutLengthText(inch, 3658)).toBe("12 ft");
  });
});

describe("no order, plan or dispatch screen calls the mm and inch helper", () => {
  const ROOT = join(import.meta.dir, "../../features");
  const files = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  };
  const named = ["orders", "dispatch", "ageing"];
  test("none of their files imports formatLength from the domain", () => {
    const bad = named
      .flatMap((d) => files(join(ROOT, d)))
      .filter((f) => /import\s*\{[^}]*\bformatLength\b[^}]*\}\s*from\s*"@orrn\/domain"/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(bad).toEqual([]);
  });
  test("the ageing report writes its cut length through the formatter", () => {
    expect(readFileSync(join(ROOT, "ageing/report-view.tsx"), "utf8")).toContain("cutLengthText(fmt, r.lengthMm)");
  });
});
