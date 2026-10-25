import { expect, test } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * The fixture-only `/preview/*` demos were retired when every module got a real screen. Each old
 * URL lands on its real route (or, for ageing, the honest coming-soon page), and no
 * navigation item says "Preview" any more. Needs the local stack (this worktree's API + web ports).
 */

type Row = { old: string; next: RegExp; role?: LocalRole };

const ROWS: readonly Row[] = [
  { old: "/preview", next: /\/today$/ },
  { old: "/preview/die-room", next: /\/dies$/ },
  { old: "/preview/die-room/card", next: /\/dies$/ },
  { old: "/preview/die-room/lift", next: /\/dies$/ },
  { old: "/preview/die-room/maker", next: /\/dies\/makers$/ },
  { old: "/preview/orders", next: /\/orders$/ },
  { old: "/preview/orders/new", next: /\/orders\/new$/ },
  { old: "/preview/orders/plan", next: /\/orders\/plan$/ },
  { old: "/preview/orders/SO-12", next: /\/orders\/SO-12$/ },
  { old: "/preview/press", next: /\/press$/ },
  { old: "/preview/press/console", next: /\/press\/lines$/ },
  { old: "/preview/press/report", next: /\/press\/report$/ },
  { old: "/preview/press/summary", next: /\/press\/summary$/ },
  { old: "/preview/floor", next: /\/pack\/new$/ },
  { old: "/preview/floor/list", next: /\/pack$/ },
  { old: "/preview/floor/dispatch", next: /\/dispatch$/ },
  { old: "/preview/floor/stock", next: /\/stock$/ },
  { old: "/preview/platform", next: /\/today$/ },
  { old: "/preview/platform/settings", next: /\/settings$/ },
  { old: "/preview/platform/devices", next: /\/settings\?tab=devices$/ },
  { old: "/preview/platform/portal", next: /\/portal$/, role: "party" },
  { old: "/preview/foundry", next: /\/casts$/ },
  { old: "/preview/foundry/cast", next: /\/casts$/ },
  { old: "/preview/foundry/stock", next: /\/foundry\/stock$/ },
  { old: "/preview/foundry/certificate", next: /\/casts$/ },
  { old: "/preview/ageing", next: /\/preview\/coming-soon\?module=ageing$/ },
  { old: "/preview/ageing/batch", next: /\/preview\/coming-soon\?module=ageing$/ },
  { old: "/preview/ageing/report", next: /\/preview\/coming-soon\?module=ageing$/ },
];

for (const width of [375, 1280]) {
  test.describe(`old preview URLs at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    for (const row of ROWS) {
      test(`${row.old} lands on ${row.next.source}`, async ({ page }) => {
        await signInViaApi(page, row.role ?? "owner");
        await page.goto(row.old);
        await expect(page).toHaveURL(row.next);
        await expect(page.locator("main, [data-slot='portal-shell']").first()).toBeVisible();
        // None of the old demo furniture survives a redirect.
        await expect(page.getByText("sample data · nothing is saved")).toHaveCount(0);
      });
    }

    test("the coming-soon page says the module is being built on another machine", async ({ page }) => {
      await signInViaApi(page, "owner");
      for (const [module, heading] of [["ageing", "Ageing"]] as const) {
        await page.goto(`/preview/coming-soon?module=${module}`);
        await expect(page.locator("main#main h1").first()).toHaveText(heading);
        await expect(page.getByText("This module is being built on another machine")).toBeVisible();
        await expectNoHorizontalScroll(page);
      }
    });

    test("no navigation item says Preview", async ({ page }) => {
      await signInViaApi(page, "owner");
      await page.goto("/today");
      await expect(page.locator("main#main h1").first()).toBeVisible();
      await expect(page.locator("a[href^='/preview']")).toHaveCount(0);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByText("Preview")).toHaveCount(0);
      if (width < 768) {
        await page.getByRole("button", { name: "Account and more" }).click();
        const sheet = page.getByRole("dialog", { name: "More" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByText("Preview")).toHaveCount(0);
        await expect(sheet.locator("a[href^='/preview']")).toHaveCount(0);
      }
    });
  });
}
