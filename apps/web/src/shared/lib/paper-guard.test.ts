/**
 * The papers (printed or downloadable sheets that leave the plant) keep today's units and words until they have their own
 * setting. A component on this list reads the paper formatter and the paper words, never the plant's: it must not call
 * `useFmt()`, `useLengthUnit()` or `useCompanyWhen()` (all three follow the Units tab), and it must read its words through
 * `paperT`. Add a new paper to the list in the same change that adds it.
 *
 * Not on the list, on purpose: the packing list views (`features/dispatch/packing-list-*`) are guarded by their own tests and
 * `useCompanyWhen` in the revisions list is a screen; report pages with a Print button are screens in the plant's units.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../..");

export const PAPERS: { file: string; what: string }[] = [
  { file: "features/pack/label-sheet.tsx", what: "the pack sticker sheet" },
  { file: "features/die-room/print-card.tsx", what: "the printed die card" },
  { file: "features/foundry/certificate-view.tsx", what: "the foundry test certificate" },
  { file: "features/portal/certificate-page.tsx", what: "the portal test certificate" },
  { file: "features/die-room/share-page.tsx", what: "the die share page a party opens from a link" },
];

const PLANT_STYLE = [/\buseFmt\s*\(/, /\buseLengthUnit\s*\(/, /\buseCompanyWhen\s*\(/, /\buseTenantFmt\s*\(/];

describe("the papers do not follow the plant's units", () => {
  for (const paper of PAPERS) {
    const src = readFileSync(join(SRC, paper.file), "utf8");
    test(`${paper.what} (${paper.file}) reads the paper formatter and the paper words`, () => {
      for (const pattern of PLANT_STYLE) expect(src).not.toMatch(pattern);
      expect(src).toMatch(/\busePaperFmt\s*\(/);
      expect(src).toMatch(/\bpaperT\s*\(/);
    });
  }
  test("the guard catches a paper that reads the plant's formatter", () => {
    const bad = `import { useFmt } from "@/shared/lib/fmt";\nconst fmt = useFmt();`;
    expect(PLANT_STYLE.some((p) => p.test(bad))).toBe(true);
    expect(PLANT_STYLE.some((p) => p.test(`const fmt = usePaperFmt();`))).toBe(false);
  });
});
