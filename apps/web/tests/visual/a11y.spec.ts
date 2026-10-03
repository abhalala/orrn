import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * WCAG 2.2 AA smoke check for the public pages (C2 theme). Runs in every
 * project (desktop + mobile, light + dark) and fails on any serious or
 * critical axe violation.
 */
const PAGES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/waitlist", name: "waitlist" },
] as const;

test.beforeEach(async ({ page }) => {
  // Static layout so axe sees final colours, not mid-animation opacity.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const { path, name } of PAGES) {
  test(`${name} has no serious or critical axe violations`, async ({ page }, testInfo) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const theme = testInfo.project.name.includes("light") ? "light" : "dark";
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      // Dev-only overlays (TanStack/React Query devtools) are not product UI.
      .exclude(".TanStackRouterDevtools")
      .exclude(".tsqd-parent-container")
      .exclude("[class*='tsqd-']")
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    const summary = blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}
