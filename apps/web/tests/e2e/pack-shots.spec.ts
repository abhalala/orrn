import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { mockLabelPrinting } from "./helpers/mock-printing";
import { API_URL } from "./helpers/ports";

/**
 * Review screenshots of every Pack screen at 375 and 1280, light and dark.
 * Skipped unless PACK_SHOTS_DIR is set (it is not a regression test).
 *   PACK_SHOTS_DIR=/abs/dir bunx playwright test --project=e2e tests/e2e/pack-shots.spec.ts
 */
const DIR = process.env.PACK_SHOTS_DIR;
/** A saved session's page (`/pack/<id>`), never `/pack/new` itself. */
const SESSION_URL = (url: URL) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new";

/** Phone and laptop in both themes, plus the iPad portrait width in light. */
const VIEWS = [
  { width: 375, scheme: "light" },
  { width: 375, scheme: "dark" },
  { width: 820, scheme: "light" },
  { width: 1280, scheme: "light" },
  { width: 1280, scheme: "dark" },
] as const;

test.skip(!DIR, "set PACK_SHOTS_DIR to capture review screenshots");

/** Full page by default; `viewport` shows what is really on screen (sticky bar and tab bar in place). */
async function shot(page: Page, name: string, opts: { viewport?: boolean } = {}) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(DIR!, `${name}.png`), fullPage: !opts.viewport });
}

for (const { width, scheme } of VIEWS) {
  test(`pack screens ${width} ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR!, { recursive: true });
    const tag = `${width}-${scheme}`;
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signInViaApi(page, "operator");
    // Label printing shown as connected; the second label fails so the session page shows a failure.
    await mockLabelPrinting(page, API_URL, { fail: (n) => n === 2 });

    await page.goto("/pack");
    await expect(page.locator("[data-slot='responsive-list']")).toBeVisible();
    await expect(page.locator("[data-slot='packed-today'] [data-slot='big-number']")).toBeVisible();
    await shot(page, `pack-list-${tag}`);

    await page.goto("/pack/new");
    await expect(page.locator("button[data-die]").first()).toBeVisible();
    await shot(page, `pack-new-1-die-${tag}`);

    await page.getByLabel("Search die code or section").fill("14701");
    await expect(page.locator("button[data-die]")).toHaveCount(1);
    await page.locator("button[data-die]").click();
    await page.getByLabel("Feet", { exact: true }).fill("11");
    await page.getByLabel("Inches", { exact: true }).fill("6");
    await page.getByLabel("PO", { exact: true }).fill("PO-4471");
    // Next without a yard shows the yard question's error.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Choose the yard these bundles go to.")).toBeVisible();
    await shot(page, `pack-new-1-yard-error-${tag}`);
    await page.locator("[data-slot='yard-picker'] label").filter({ hasText: "Y3" }).click();
    await shot(page, `pack-new-1-defaults-${tag}`);
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const weight = page.getByLabel("Weight (kg)", { exact: true });
    const pieces = page.getByLabel("Pieces", { exact: true });
    for (const [w, p] of [
      ["47.90", "20"],
      ["48.15", "20"],
      ["40.00", "20"],
      ["52.40", "21"],
    ]) {
      await weight.fill(w!);
      await pieces.fill(p!);
      await pieces.press("Enter");
    }
    await weight.fill("47.9");
    await pieces.fill("20");
    await shot(page, `pack-new-2-bundles-in-range-${tag}`);
    await pieces.press("Enter");
    await shot(page, `pack-new-2-bundles-after-save-viewport-${tag}`, { viewport: true });
    await weight.fill("55");
    await shot(page, `pack-new-2-bundles-amber-${tag}`);
    await weight.fill("");
    await pieces.fill("");

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.locator("[data-slot='pack-totals']")).toBeVisible();
    await shot(page, `pack-new-3-review-${tag}`);

    await page.getByRole("button", { name: "Save and print labels" }).click();
    await page.waitForURL(SESSION_URL);
    await expect(page.locator("[data-slot='session-totals']")).toBeVisible();
    await expect(page.locator("[data-slot='print-panel']")).toHaveAttribute("data-status", "done");
    await shot(page, `pack-session-${tag}`);
  });
}
