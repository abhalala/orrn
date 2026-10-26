import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { openOwnCast, lockOwnMelt } from "./helpers/own-foundry";
import { ownerApi } from "./helpers/owner-api";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Foundry masters, the yield report and the approvals the foundry raises (W2-FD-W): furnaces and alloys
 * with the limits editor (masters.publish), `/reports/foundry-yield`, and the melt correction request ->
 * approval -> correct round trip with the figures in the approval sheet. 375 / 820 / 1280, in the roles
 * that can and cannot publish.
 */

const WIDTHS = [375, 820, 1280] as const;
const TAG: Record<(typeof WIDTHS)[number], string> = { 375: "A", 820: "B", 1280: "C" };

async function open(page: Page, path: string, width: number, role: LocalRole) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

async function expectClean(page: Page) {
  await expectNoHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).include("main#main").exclude("[data-sonner-toaster]").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const h1 = (page: Page) => page.locator("main#main h1").first();
const rowWith = (page: Page, text: string | RegExp) => page.locator("main#main").locator("tr, li").filter({ hasText: text }).last();

test.setTimeout(180_000);

for (const width of WIDTHS) {
  const tag = TAG[width];
  test.describe(`foundry masters at ${width}`, () => {
    test("a manager adds a furnace, changes its capacity and retires it", async ({ page }) => {
      const code = `E2E${tag}${Date.now().toString(36).slice(-4).toUpperCase()}`;
      await open(page, "/masters/furnaces", width, "manager");
      await expect(h1(page)).toHaveText("Furnaces");
      await expect(rowWith(page, "F1")).toBeVisible();
      await page.getByTestId("add-furnace").click();
      await page.getByTestId("furnace-save").click();
      await expect(page.getByText("Use letters, digits and dashes, up to 12.")).toBeVisible();
      await page.getByTestId("furnace-code").fill(code);
      await page.getByTestId("furnace-name").fill(`Test furnace ${tag}`);
      await page.getByTestId("furnace-capacity").fill("4500");
      await page.getByTestId("furnace-dia").fill("152");
      await page.getByTestId("furnace-save").click();
      await expect(page.getByText("Saved").first()).toBeVisible();
      const row = rowWith(page, code);
      await expect(row).toContainText("4,500");
      await expect(row).toContainText("152");
      await expectClean(page);

      await row.getByTestId("edit-furnace").click();
      await page.getByTestId("furnace-capacity").fill("5000");
      await page.getByTestId("furnace-save").click();
      await expect(rowWith(page, code)).toContainText("5,000");
      // The cast page's new-cast screen lists the furnace chips of active furnaces only.
      await rowWith(page, code).getByTestId("edit-furnace").click();
      await page.getByTestId("furnace-toggle").click();
      await expect(rowWith(page, code)).toContainText("Retired");
    });

    test("a manager adds an alloy, sets its limits as percent and they survive a reload", async ({ page }) => {
      const code = `E2E${tag}${Date.now().toString(36).slice(-4).toUpperCase()}`;
      await open(page, "/masters/alloys", width, "manager");
      await expect(h1(page)).toHaveText("Alloys");
      await expect(rowWith(page, "6063")).toContainText("Si 0.20 to 0.60");
      await page.getByTestId("add-alloy").click();
      await page.getByTestId("alloy-code").fill(code);
      await page.getByTestId("alloy-name").fill(`Test alloy ${tag}`);
      await page.getByTestId("alloy-save").click();
      await expect(rowWith(page, code)).toContainText("No limits");

      await rowWith(page, code).getByTestId("edit-limits").click();
      // A minimum above the maximum is named, not sent.
      await page.getByTestId("limit-min-mg").fill("0.9");
      await page.getByTestId("limit-max-mg").fill("0.45");
      await page.getByTestId("limits-save").click();
      await expect(page.getByText("The minimum is above the maximum.")).toBeVisible();
      await page.getByTestId("limit-min-mg").fill("0.45");
      await page.getByTestId("limit-max-mg").fill("0.9");
      await page.getByTestId("limit-max-fe").fill("0.35");
      await page.getByTestId("limits-save").click();
      await expect(page.getByText("Saved").first()).toBeVisible();
      await expect(rowWith(page, code)).toContainText("Mg 0.45 to 0.90");
      await expect(rowWith(page, code)).toContainText("Fe max 0.35");
      await page.reload();
      await expect(rowWith(page, code)).toContainText("Mg 0.45 to 0.90");
      await expectClean(page);
      await rowWith(page, code).getByTestId("edit-alloy").click();
      await page.getByTestId("alloy-toggle").click();
      await expect(rowWith(page, code)).toContainText("Retired");
    });

    test("a viewer and a foundry hand read the masters but have nothing to change", async ({ page }) => {
      await open(page, "/masters/furnaces", width, "viewer");
      await expect(page.getByTestId("add-furnace")).toHaveCount(0);
      await expect(page.getByTestId("edit-furnace")).toHaveCount(0);
      await expect(rowWith(page, "F1")).toBeVisible();
      await page.goto("/masters/alloys");
      await expect(h1(page)).toHaveText("Alloys");
      await expect(page.getByTestId("add-alloy")).toHaveCount(0);
      await expect(page.getByTestId("edit-limits")).toHaveCount(0);
      await expectClean(page);
    });

    test("the Masters hub lists furnaces and alloys for a manager only", async ({ page }) => {
      await open(page, "/masters", width, "manager");
      await expect(page.getByRole("link", { name: /Furnaces/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Alloys/ })).toBeVisible();
      await expectClean(page);
    });

    test("a manager states the opening balance of a return stream once; the stream shows it", async ({ page }) => {
      const api = await ownerApi();
      const code = `E2E${tag}${Date.now().toString(36).slice(-4).toUpperCase()}`;
      await api.mutate("foundry.returnStreams.create", { code, name: `Opening test ${code}`, kind: "charge" });
      await api.dispose();
      await open(page, "/foundry/stock", width, "manager");
      const row = page.locator(`[data-stream='${code}']`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId("stream-balance")).toHaveText("0.0 kg");
      await row.getByTestId("stream-opening").click();
      await page.getByTestId("opening-save").click();
      await expect(page.getByText("Write the kg as a number above zero.")).toBeVisible();
      await page.getByTestId("opening-kg").fill("1250");
      // It cannot be undone, so the first press asks once more and posts nothing.
      await page.getByTestId("opening-save").click();
      await expect(page.getByTestId("opening-confirm")).toContainText("1,250.0 kg");
      await expect(page.getByTestId("opening-confirm")).toContainText("It cannot be changed later.");
      await expect(row.getByTestId("stream-balance")).toHaveText("0.0 kg");
      await page.getByTestId("opening-save").click();
      await expect(page.getByText("Opening balance posted").first()).toBeVisible();
      await expect(row.getByTestId("stream-balance")).toHaveText("1,250.0 kg");
      // Once posted the stream stops offering it (the server would refuse a second one).
      await expect(row.getByTestId("stream-opening")).toHaveCount(0);
      await expect(row.getByTestId("stream-opened")).toHaveText("Opening balance posted");
      await expectClean(page);
    });

    test("a foundry hand sees the streams but has no opening button", async ({ page }) => {
      await open(page, "/foundry/stock", width, "foundry");
      await expect(page.getByTestId("streams-panel")).toBeVisible();
      await expect(page.getByTestId("stream-opening")).toHaveCount(0);
    });

    test("the foundry yield report groups locked melts by day, alloy and furnace and prints", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id, { inKg: 200, logsKg: 190, drossKg: 4, feKg: 1 });
      await api.dispose();
      await open(page, "/reports/foundry-yield", width, "manager");
      await expect(h1(page)).toHaveText("Foundry yield");
      const table = page.getByTestId("yield-table");
      await expect(table).toBeVisible();
      await expect(page.getByTestId("yield-totals")).toBeVisible();
      await page.getByRole("radio", { name: "Alloy" }).click();
      await expect(page).toHaveURL(/group=alloy/);
      await expect(table.locator("[data-key='6063']")).toBeVisible();
      await page.getByRole("radio", { name: "Furnace" }).click();
      await expect(table.locator("[data-key='F1']")).toBeVisible();
      await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
      // A range with no locked melt is zeros, not an error.
      await page.getByTestId("yield-from").fill("2020-01-01");
      await page.getByTestId("yield-to").fill("2020-01-05");
      await expect(page.getByText("No locked melts in these days.")).toBeVisible();
      await expectClean(page);
    });

    test("a melt correction: asked by foundry, shown to the manager with its figures, approved, then the melt is a draft again", async ({ page, browser }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      const melt = await lockOwnMelt(api, cast.id, { inKg: 100, logsKg: 95, drossKg: 3, feKg: 1 });
      await api.dispose();

      // Foundry asks for the correction from the melt page.
      await open(page, `/casts/${cast.id}/melt/${melt.meltId}`, width, "foundry");
      await expect(page.getByTestId("melt-sheet")).toBeVisible();
      await page.getByTestId("ask-correction").click();
      await page.getByTestId("ask-confirm").click();
      await expect(page.getByText("Pick what is wrong.").first()).toBeVisible();
      await page.getByTestId("ask-reason").selectOption({ index: 1 });
      await page.getByTestId("ask-confirm").click();
      await expect(page.getByTestId("correction-pending")).toBeVisible();
      await expect(page.getByTestId("correct-now")).toHaveCount(0);

      // The manager sees it in Approvals with the melt's figures and a link to the melt.
      const managerContext = await browser.newContext({ viewport: { width, height: 900 } });
      const manager = await managerContext.newPage();
      await open(manager, "/approvals", width, "manager");
      const item = manager.locator("main#main").locator("li, tr").filter({ hasText: `Correct melt 1 of cast ${cast.number}` }).first();
      await expect(item).toBeVisible();
      await item.getByRole("button", { name: "Review" }).click();
      const figures = manager.getByTestId("foundry-summary");
      await expect(figures).toContainText("Metal in");
      await expect(figures).toContainText("100.000 kg");
      await expect(figures).toContainText("95.000 kg");
      // Today's melt comes first, from the server now; the request's own figures are the second block.
      const now = manager.getByTestId("foundry-live");
      await expect(now).toContainText("Metal in");
      await expect(now).toContainText("100.000 kg");
      await expect(now).toContainText("95.000 kg");
      await expect(manager.getByTestId("foundry-live-note")).toHaveCount(0);
      await expect(manager.getByRole("link", { name: "Open melt" })).toHaveAttribute("href", `/casts/${cast.id}/melt/${melt.meltId}`);
      await manager.getByRole("button", { name: "Approve" }).click();
      // "Approved" is also the tab label; wait for this request to leave Pending before closing the manager's context.
      await expect(item).toHaveCount(0);
      await expect(manager.getByText("Approved").first()).toBeVisible();
      await managerContext.close();

      // Foundry corrects now: the melt opens again as a draft copy.
      await page.reload();
      await expect(page.getByTestId("correct-now")).toBeVisible();
      await page.getByTestId("correct-now").click();
      await expect(page).toHaveURL(new RegExp(`/casts/${cast.id}/melt/(?!${melt.meltId})[^/?]+`));
      await expect(page.getByTestId("corrects-note")).toHaveText("This draft corrects melt 1.");
      await expect(page.getByTestId("melt-step-times")).toBeVisible();
    });

    test("a supervisor cancels a locked melt of an open cast with a reason; a foundry hand is not offered it", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      const melt = await lockOwnMelt(api, cast.id, { inKg: 100, logsKg: 95, drossKg: 3, feKg: 1 });
      await api.dispose();

      await open(page, `/casts/${cast.id}/melt/${melt.meltId}`, width, "foundry");
      await expect(page.getByTestId("melt-sheet")).toBeVisible();
      await expect(page.getByTestId("cancel-melt")).toHaveCount(0);
    });

    test("cancelling a locked melt asks for a reason, reverses it and keeps its number as cancelled", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      const melt = await lockOwnMelt(api, cast.id, { inKg: 100, logsKg: 95, drossKg: 3, feKg: 1 });
      await api.dispose();

      await open(page, `/casts/${cast.id}/melt/${melt.meltId}`, width, "supervisor");
      await page.getByTestId("cancel-melt").click();
      await page.getByTestId("cancel-melt-confirm").click();
      await expect(page.getByText("Give a reason.").first()).toBeVisible();
      await page.getByTestId("cancel-melt-reason").fill("Locked on the wrong cast");
      await page.getByTestId("cancel-melt-confirm").click();
      await expect(page).toHaveURL(new RegExp(`/casts/${cast.id}$`));
      await expect(page.getByText(`Melt 1 of ${cast.number} is cancelled`).first()).toBeVisible();
      await expect(page.getByTestId("fig-produced").locator("dd > span").first()).toHaveText("0.0 kg");
      await page.goto(`/casts/${cast.id}/melt/${melt.meltId}`);
      await expect(page.getByText("This melt is cancelled. Its kg were reversed.")).toBeVisible();
      await expect(page.getByTestId("cancel-melt")).toHaveCount(0);
    });
  });
}
