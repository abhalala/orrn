import { expect, request, test, type Page } from "@playwright/test";

import { freshPlant, signInPlant, type FreshPlant, type PlantRole } from "./helpers/fresh-plant";
import { m, q } from "./helpers/orders-api";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

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

async function openArrange(page: Page) {
  await page.locator("[data-slot='side-nav']").getByRole("button", { name: /W2 owner/ }).click();
  await page.getByRole("menuitem", { name: "Arrange menu" }).click();
}

async function secondPlantFor(plant: FreshPlant): Promise<string> {
  const { email, password } = plant.members.owner;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const invite = await api.post(`${API_URL}/dev/invite`, {
      data: { email, role: "owner", companyName: `Second ${plant.companyName}`.slice(0, 80) },
    });
    expect(invite.ok(), `/dev/invite returned ${invite.status()}`).toBe(true);
    const made = (await invite.json()) as { token: string; companyId: string };
    await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } });
    await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: made.token } });
    return made.companyId;
  } finally {
    await api.dispose();
  }
}

test("a member saves their own menu order and resets it", async ({ page }) => {
  const plant = await freshPlant("NavOrder");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");

  const total = await mainNav(page).getByRole("link").count();
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Today");
  await openArrange(page);
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  await expect(dialog).toBeVisible();

  const handle = dialog.getByRole("button", { name: "Reorder Orders" });
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
  await openArrange(page);
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
  const handle = dialog.getByRole("button", { name: "Reorder Reports" });
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

test("Escape restores the picked row and a second Escape cancels", async ({ page }) => {
  const plant = await freshPlant("NavEscape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await openArrange(page);

  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  const handle = dialog.getByRole("button", { name: "Reorder Orders" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowUp");
  await handle.press("ArrowUp");
  await handle.press("Escape");

  await expect(dialog).toBeVisible();
  await expect(handle).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.locator("[data-slot='nav-arrange-list'] > li").nth(5)).toHaveAttribute("data-nav-key", "orders");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(mainNav(page).getByRole("link").first()).toHaveAccessibleName("Today");
});

test("a plant change under the editor cannot receive the old plant's order", async ({ page }) => {
  const plant = await freshPlant("NavPlant");
  const secondCompanyId = await secondPlantFor(plant);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await m(page, "company.switch", { companyId: plant.companyId });
  await page.reload();
  await expectShell(page);
  await openArrange(page);
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });

  await m(page, "company.switch", { companyId: secondCompanyId });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("The plant changed. Open the menu again and arrange it for this plant.", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  const me = await q<{ company: { navOrder: unknown } }>(page, "auth.me", {});
  expect(me.company.navOrder).toBeNull();
});

test("Arrange menu is reachable from the account footer at 1280 by 900", async ({ page }) => {
  const plant = await freshPlant("NavFooter");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");

  await page.locator("[data-slot='side-nav']").getByRole("button", { name: /W2 owner/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Arrange menu" }).click();
  await expect(page.getByRole("dialog", { name: "Arrange menu" })).toBeVisible();
});

test("reset confirmation stays in the footer and restores focus", async ({ page }) => {
  const plant = await freshPlant("NavResetFocus");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await openArrange(page);
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  const reset = dialog.getByRole("button", { name: "Reset to default" });
  await reset.click();

  const confirm = dialog.getByRole("alert");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button").first()).toBeFocused();
  await expect(dialog.locator("[data-slot='sheet-footer']").getByRole("alert")).toHaveCount(1);
  await confirm.getByRole("button", { name: "Keep my order" }).click();
  await expect(reset).toBeFocused();
});

test("divider crossings and the arrange hint are announced", async ({ page }) => {
  const plant = await freshPlant("NavAnnounce");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await openArrange(page);
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  await expect(dialog.getByText("Items above More stay at the top of the menu. Drag an item across the line to move it.")).toBeVisible();

  const handle = dialog.getByRole("button", { name: "Reorder Dispatch" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowDown");
  await expect(page.getByTestId("nav-order-announcement")).toHaveText("Dispatch moved below More");
  await handle.press("ArrowUp");
  await expect(page.getByTestId("nav-order-announcement")).toHaveText("Dispatch moved above More");
});

test("Tab drops the picked row without losing its new place", async ({ page }) => {
  const plant = await freshPlant("NavBlur");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await openArrange(page);
  const dialog = page.getByRole("dialog", { name: "Arrange menu" });
  const handle = dialog.getByRole("button", { name: "Reorder Orders" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowUp");
  await handle.press("Tab");

  await expect(handle).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.locator("[data-slot='nav-arrange-list'] > li").nth(4)).toHaveAttribute("data-nav-key", "orders");
});

test("a failed editor chunk leaves the app shell usable", async ({ page }) => {
  const plant = await freshPlant("NavChunk");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openPlant(page, plant, "owner");
  await page.route("**/src/shell/nav-arrange-editor.tsx", (route) => route.abort());
  try {
    await openArrange(page);
    await expect(page.getByText("The menu order could not be saved. Try again.", { exact: true })).toBeVisible();
    await expectShell(page);
    await expect(page.getByText("Something went wrong!")).toHaveCount(0);
    await expect(page.locator("[data-slot='side-nav']").getByRole("button", { name: /W2 owner/ })).toBeEnabled();
  } finally {
    await page.unroute("**/src/shell/nav-arrange-editor.tsx");
  }
});
