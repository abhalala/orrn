import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("pack Review above the phone's bottom action bar", () => {
  test("For order stays in the scroll content with no dead spacer", () => {
    const review = read("features/pack/review-step.tsx");
    expect(review).toContain('t("pack.forOrder")');
    expect(review).not.toContain("pack-review-bottom-clearance");
    expect(review).not.toContain("pack.new.saveOnly");
  });

  test("ReviewStep and For order are inside Screen, while the action bar is outside it", () => {
    const screen = read("app/(tabs)/pack/new.tsx");
    const scroll = screen.slice(screen.lastIndexOf("<Screen>"), screen.lastIndexOf("</Screen>"));
    expect(scroll).toContain("<ReviewStep");
    expect(screen.lastIndexOf("</Screen>")).toBeLessThan(screen.indexOf("<PackReviewActionBar"));
    const bar = read("features/pack/review-action-bar.tsx");
    expect(bar).toContain("<ActionBar>");
    expect(bar).toContain('testID="pack-review-save"');
    expect(bar).toContain('testID="pack-review-edit"');
  });
});
