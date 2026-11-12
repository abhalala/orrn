import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("react-native", () => require("react-native-web"));
mock.module("@/components/ui/pressable-scale", () => ({
  PressableScale: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(require("react-native-web").Pressable, props, children),
}));
mock.module("@/lib/theme", () => ({ useThemeColor: () => "#000000" }));

describe("pack Review save failure", () => {
  test("the failed-save message renders in the bottom bar above Save", async () => {
    const { PackReviewActionBar } = await import("../features/pack/review-action-bar");
    const html = renderToStaticMarkup(
      React.createElement(PackReviewActionBar, {
        saving: false,
        problem: { kind: "failed", title: "Save failed", body: "Check the order and try again" },
        onSave: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("Save failed");
    expect(html).toContain("Check the order and try again");
    expect(html.indexOf("Save failed")).toBeLessThan(html.indexOf("pack-review-save"));
    expect(html).toContain("polite");
  });
});
