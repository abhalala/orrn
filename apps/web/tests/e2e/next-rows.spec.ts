import { expect, request, test, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
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
