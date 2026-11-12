import { expect, test, type Page } from "@playwright/test";

import { freshPlant, signInPlant, type FreshPlant, type PlantRole } from "./helpers/fresh-plant";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

async function expectShell(page: Page) {
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function openPlant(page: Page, plant: FreshPlant, role: PlantRole) {
  await page.context().clearCookies();
  await signInPlant(page, plant, role);
  await page.goto("/today");
  await expectShell(page);
}

test("a member saves their own menu order and resets it", async ({ page }) => {
  const plant = await freshPlant("NavOrder");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");

  const total = await mainNav(page).getByRole("link").count();
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Today");
  await mainNav(page).getByRole("button", { name: "Arrange menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  await expect(dialog).toBeVisible();

  const handle = dialog.getByRole("button", { name: "Drag to move Orders" });
  await handle.focus();
  await handle.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  for (let move = 0; move < 5; move += 1) await handle.press("ArrowUp");
  await expect(page.getByTestId("nav-order-announcement")).toHaveText(`Orders moved to position 1 of ${total}`);
  await handle.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  await expect(page.getByText("Menu order saved", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Orders");
  await page.reload();
  await expectShell(page);
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Orders");

  const officePage = await page.context().browser()!.newPage();
  try {
    await officePage.setViewportSize({ width: 1280, height: 900 });
    await openPlant(officePage, plant, "office");
    await expect(mainNav(officePage).getByRole("link").first()).toHaveAccessibleName("Today");
    await expect(mainNav(officePage).getByRole("link", { name: "Orders" })).toBeVisible();
  } finally {
    await officePage.close();
  }

  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Orders");
  await mainNav(page).getByRole("button", { name: "Arrange menu" }).click();
  await dialog.getByRole("button", { name: "Reset to default" }).click();
  const confirm = dialog.getByRole("alert");
  await expect(confirm).toContainText("Put the menu back in the default order?");
  await confirm.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByText("Menu order saved", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Today");

  await page.reload();
  await expectShell(page);
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Today");
});

test("phone More keeps items moved above the divider", async ({ page }) => {
  const plant = await freshPlant("NavPhone");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");

  await mainNav(page).getByRole("button", { name: "More", exact: true }).click();
  let moreSheet = page.getByRole("dialog", { name: "More" });
  await moreSheet.getByRole("button", { name: "Arrange menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  const handle = dialog.getByRole("button", { name: "Drag to move Reports" });
  await handle.focus();
  await handle.press("Space");
  for (let move = 0; move < 5; move += 1) await handle.press("ArrowUp");
  await handle.press("Space");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Menu order saved", { exact: true })).toBeVisible();

  await mainNav(page).getByRole("button", { name: "More", exact: true }).click();
  moreSheet = page.getByRole("dialog", { name: "More" });
  await expect(moreSheet.getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(moreSheet.getByRole("link").first()).toHaveAccessibleName("Reports");
});
