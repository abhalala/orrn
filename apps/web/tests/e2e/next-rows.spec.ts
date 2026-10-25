import { expect, request, test, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
import { ownerApi } from "./helpers/owner-api";
import { freshPlant, signInPlant, type FreshPlant } from "./helpers/fresh-plant";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * W4-NEXTROWS: the remaining Next rows on real screens (local stack, this worktree's ports).
 * FP-PF-17 plant switcher, FP-OP-14 dispatch value, FP-DR-18 die work log, FP-OP-21 owner's press
 * view, FP-PF-14 release notes, FP-OP-19 order print and export, FP-PR-19 the station outbox.
 */

const WIDTHS = [375, 820, 1280] as const;

async function ok(res: Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

/** Gives the plant's owner a second plant (an invite from the local `/dev/invite` hook, accepted as that owner). */
async function secondPlantFor(plant: FreshPlant): Promise<string> {
  const { email, password } = plant.members.owner;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const name = `Second ${plant.companyName}`.slice(0, 80);
    const invite = await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role: "owner", companyName: name } }), "/dev/invite");
    const made = (await invite.json()) as { token: string };
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: made.token } }), "invite.acceptByToken");
    return name;
  } finally {
    await api.dispose();
  }
}

test.describe("FP-PF-17 plant switcher", () => {
  test("hidden with one plant", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInViaApi(page, "office");
    await page.goto("/today");
    await expect(page.locator("main#main h1").first()).toBeVisible();
    await expect(page.getByTestId("plant-switcher")).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`two plants: switch from the header at ${width}px and land on Today of the other plant`, async ({ page }) => {
      const plant = await freshPlant(`Switch${width}`);
      const second = await secondPlantFor(plant);
      await page.setViewportSize({ width, height: 900 });
      await signInPlant(page, plant, "owner");
      await page.goto("/today");
      await expect(page.locator("main#main h1").first()).toBeVisible();
      const trigger = page.getByTestId("plant-switcher").filter({ visible: true }).first();
      await expect(trigger).toBeVisible();
      await expectNoHorizontalScroll(page);
      await trigger.click();
      const items = page.getByTestId("plant-switcher-item");
      await expect(items).toHaveCount(2);
      // Accepting the invite made the second plant the active one; switch back to the first.
      const target = (await page.getByRole("menuitemradio", { checked: false }).first().textContent()) ?? "";
      expect([plant.companyName, second].some((n) => target.includes(n))).toBe(true);
      await page.getByRole("menuitemradio", { checked: false }).first().click();
      await expect(page).toHaveURL(/\/today$/);
      await page.getByTestId("plant-switcher").filter({ visible: true }).first().click();
      await expect(page.getByRole("menuitemradio", { checked: true })).toContainText(target.includes(plant.companyName) ? plant.companyName : second);
    });
  }
});

test.describe("FP-PF-14 release notes on About", () => {
  for (const width of WIDTHS) {
    test(`About lists what changed (or says none yet) at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "office");
      await page.goto("/settings?tab=about");
      const card = page.getByTestId("release-notes");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("release-note").or(card.getByTestId("release-notes-none")).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("FP-DR-18 die work log on the copy card", () => {
  for (const width of WIDTHS) {
    test(`log a correction that sends the copy back on trial at ${width}px`, async ({ page }) => {
      // A copy of its own on a section no other spec reads (Angle 11262), on the rack.
      const api = await ownerApi();
      const made = await api.mutate<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-11262", status: "available" });
      await api.dispose();

      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signInViaApi(page, "owner");
      await page.goto(`/dies/copies/${made.id}?tab=work`);
      const panel = page.getByTestId("work-panel");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalScroll(page);

      await panel.getByTestId("work-add").click();
      const sheet = page.getByRole("dialog");
      await sheet.getByTestId("work-kind").selectOption({ label: "Correction" });
      await sheet.getByLabel("Hardness after (HV)").fill("960");
      await sheet.getByTestId("work-note").fill("Bearing opened at the nose");
      await sheet.getByLabel("Send the copy back on trial").check();
      await sheet.getByTestId("work-save").click();
      await expect(page.getByText(`Work logged on ${made.code}`)).toBeVisible();

      const row = panel.getByTestId("work-row").first();
      await expect(row).toContainText("Correction");
      await expect(row).toContainText("960 HV");
      await expect(row).toContainText("Sent on trial");
      await expect(row).toContainText("Bearing opened at the nose");
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("FP-OP-19 order print and export", () => {
  for (const width of WIDTHS) {
    test(`order sheet in Excel and the print button at ${width}px; the book exports`, async ({ page }) => {
      const api = await ownerApi();
      const { id: customerId } = await api.mutate<{ id: string }>("customer.create", { name: `Print Traders ${width}-${Date.now().toString(36)}` });
      const made = await api.mutate<{ id: string; number: string }>("orders.create", {
        customerId,
        poNumber: `PR-${width}-${Date.now().toString(36)}`,
        lines: [{ sectionId: "dev-die-11262", cutLengthMm: 3658, kgG: 250_000, pcs: null, finish: null }],
      });
      await api.dispose();

      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "office");
      await page.goto(`/orders/${made.id}`);
      await expect(page.locator("[data-order-print]")).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalScroll(page);
      const [file] = await Promise.all([page.waitForEvent("download"), page.locator("[data-order-excel]").click()]);
      expect(file.suggestedFilename()).toBe(`order-${made.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.xlsx`);

      await page.goto("/orders");
      const exportButton = page.locator("[data-book-export]");
      await expect(exportButton).toBeVisible({ timeout: 30_000 });
      const [book] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
      expect(book.suggestedFilename()).toMatch(/^order-book-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });
  }

  test("the plan's shift die list in Excel (plans open from 820px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInViaApi(page, "office");
    await page.goto("/orders/plan/dev-plan-trial-1");
    await expect(page.locator("[data-plan-print]")).toBeVisible({ timeout: 30_000 });
    const [file] = await Promise.all([page.waitForEvent("download"), page.locator("[data-plan-excel]").click()]);
    expect(file.suggestedFilename()).toMatch(/^plan-PP-\d+\.xlsx$/);
  });
});

test.describe("FP-OP-21 press plan on the owner's phone", () => {
  test("375px: read-only plan and today's figures; no planning grid", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await signInViaApi(page, "owner");
    await page.goto("/orders/plan");
    await expect(page.locator("[data-phone-summary]")).toBeVisible({ timeout: 30_000 });
    const card = page.locator('[data-phone-plan-card="PP-2"]');
    await expect(card).toBeVisible();
    await expect(card.locator("[data-phone-die]").first()).toBeVisible();
    await expect(card.locator("[data-die-chip]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    // The plan's own page shows the same read-only view on a phone.
    await page.goto("/orders/plan/dev-plan-trial-2");
    await expect(page.locator('[data-phone-plan-card="PP-2"]')).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
  });

  for (const width of [820, 1280] as const) {
    test(`${width}px: the planning board, not the phone view`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "owner");
      await page.goto("/orders/plan");
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-phone-plan]")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }
});
