import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("pack Review above the phone's bottom action bar", () => {
  test("every review row has scroll clearance, including For order", () => {
    const review = read("features/pack/review-step.tsx");
    expect(review.indexOf('t("pack.forOrder")')).toBeGreaterThan(-1);
    expect(review.indexOf('t("pack.forOrder")')).toBeLessThan(review.indexOf('testID="pack-review-bottom-clearance"'));
    expect(review).toContain('testID="pack-review-bottom-clearance" className="h-40"');
    expect(review).not.toContain("pack.new.saveOnly");
  });

  test("Save and Edit sit in the bar outside the scroll view on a small phone", () => {
    const screen = read("app/(tabs)/pack/new.tsx");
    expect(screen).toContain('<View className="flex-1 bg-canvas">');
    expect(screen.indexOf("</Screen>")).toBeLessThan(screen.indexOf("<ActionBar>"));
    const bar = screen.slice(screen.indexOf("<ActionBar>"), screen.indexOf("</ActionBar>"));
    expect(bar).toContain('testID="pack-review-save"');
    expect(bar).toContain('t("pack.new.saveOnly")');
    expect(bar).toContain('testID="pack-review-edit"');
    expect(bar).toContain('t("native.pack.editBundles")');
  });
});
