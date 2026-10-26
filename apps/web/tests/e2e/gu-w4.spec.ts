import { gu } from "@orrn/i18n/gu";
import { expect, test, type Page, type Route } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Gujarati on a phone (W4-GU, BACKLOG 43 and 48, PF §9-8). At 375 wide with the device language set to
 * Gujarati: the die room, orders, Today, Pack, Scan, settings and approvals read in Gujarati, no screen
 * prints a raw dictionary key, and a refusal the server words in English (a retired copy takes no
 * readings; an order cannot be confirmed without its PO) arrives in Gujarati, never as the server's sentence.
 */

/** A dictionary key printed raw: a known top-level namespace, then dotted words (`dieRoom.board.title`). */
const RAW_KEY =
  /\b(?:dieRoom|dies|orders|settings|approvals|today|pack|scan|dispatch|stock|press|common|nav|errors|refusal|native|status|units|bundle|customers|reasons|roles|ui|packingList|ageing|auth|guides|printing)\.[A-Za-z_]+(?:\.[A-Za-z_0-9]+)*\b/;

async function open(page: Page, path: string, role: LocalRole = "owner") {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("orrn.locale", "gu"));
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

/** Gujarati, no raw keys, no sideways scroll. */
async function expectGujarati(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "gu");
  const text = await page.locator("body").innerText();
  expect(text.match(RAW_KEY)?.[0] ?? null, "a raw dictionary key is on screen").toBeNull();
  await expectNoHorizontalScroll(page);
}

const h1 = (page: Page) => page.locator("main#main h1").first();

/** Answers one tRPC procedure with a refusal, the way the server words it (batched or not). */
async function refuse(page: Page, procedure: string, message: string, code = "BAD_REQUEST") {
  await page.route(`**/trpc/${procedure}**`, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const batched = new URL(req.url()).searchParams.get("batch") === "1";
    const entry = { error: { message, code: -32600, data: { code, httpStatus: 400 } } };
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify(batched ? [entry] : entry) });
  });
}

test.describe("Gujarati at 375", () => {
  test("Today reads in Gujarati", async ({ page }) => {
    await open(page, "/today");
    await expect(h1(page)).toContainText("નમસ્તે");
    await expectGujarati(page);
  });

  test("Pack: the sessions list and the new session", async ({ page }) => {
    await open(page, "/pack");
    await expect(h1(page)).toHaveText(gu.pack.title);
    await expectGujarati(page);
    await open(page, "/pack/new");
    await expect(h1(page)).toHaveText(gu.pack.new.title);
    await expectGujarati(page);
  });

  test("Scan: the sheet opens in Gujarati", async ({ page }) => {
    await open(page, "/today");
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __orrnScan?: unknown }).__orrnScan)).toBe("object");
    await page.evaluate(() => (window as unknown as { __orrnScan: { open(m: unknown): void } }).__orrnScan.open({ kind: "lookup" }));
    const sheet = page.getByRole("dialog", { name: gu.scan.title });
    await expect(sheet).toBeVisible();
    await expectGujarati(page);
  });

  test("the die room: board, issue and return, makers", async ({ page }) => {
    await open(page, "/dies", "dieroom");
    await expect(h1(page)).toHaveText(gu.dies.title);
    await expect(page.getByTestId("board-tiles").or(page.getByText(gu.dieRoom.board.tiles.available).first()).first()).toBeVisible();
    await expectGujarati(page);
    await open(page, "/dies/issues", "dieroom");
    await expect(h1(page)).toHaveText(gu.dieRoom.issues.title);
    await expectGujarati(page);
    await open(page, "/dies/makers", "dieroom");
    await expect(h1(page)).toHaveText(gu.dieRoom.maker.makers);
    await expectGujarati(page);
  });

  test("a die card: its readings and tabs", async ({ page }) => {
    await open(page, "/dies", "dieroom");
    await page.getByRole("link", { name: /13090/ }).first().click();
    await expect(h1(page)).toContainText("13090");
    await expectGujarati(page);
    await page.getByTestId("copy-13090-1").getByRole("link").first().click();
    await expect(page.getByTestId("current-weight")).toBeVisible();
    await expectGujarati(page);
    for (const tab of ["runs", "nitriding", "tier", "maker", "files"]) {
      await page.goto(`${page.url().split("?")[0]}?tab=${tab}`);
      await expect(page.getByRole("tab", { selected: true })).toBeVisible();
      await expectGujarati(page);
    }
  });

  test("a refused die room write is worded in Gujarati, not in the server's English", async ({ page }) => {
    await open(page, "/dies", "dieroom");
    await page.getByRole("link", { name: /13090/ }).first().click();
    await page.getByTestId("copy-13090-4").getByRole("link").first().click();
    await expect(page.getByTestId("current-weight")).toBeVisible();
    await refuse(page, "dieInstance.addReading", "13090-4 is retired; it takes no readings");
    await page.getByRole("button", { name: gu.dieRoom.reading.add }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(gu.dieRoom.reading.weight).fill("2.790");
    await dialog.getByRole("button", { name: gu.dieRoom.reading.add }).click();
    const said = dialog.getByRole("alert");
    await expect(said).toContainText("13090-4");
    await expect(said).not.toContainText("retired");
    await expect(said).not.toContainText("takes no readings");
    await expect(said).toHaveText(gu.refusal.retiredNoReadings.replace("{code}", "13090-4"));
  });

  test("orders: the list, a booking, and a confirm refused for its missing PO", async ({ page }) => {
    await open(page, "/orders", "office");
    await expect(h1(page)).toHaveText(gu.orders.title);
    await expectGujarati(page);
    await page.getByRole("link", { name: /SO-3/ }).first().click();
    await expect(page.getByRole("heading", { name: "SO-3", level: 1 })).toBeVisible();
    await expectGujarati(page);
    await page.getByRole("button", { name: gu.orders.confirm }).click();
    const error = page.locator("[data-order-error]");
    await expect(error).toContainText(gu.orders.blockers.po_number);
    await expect(error).not.toContainText("Add the PO number");
    await expectGujarati(page);
  });

  test("orders: a refusal the server words in English is worded in Gujarati", async ({ page }) => {
    await open(page, "/orders", "office");
    await page.getByRole("link", { name: /SO-3/ }).first().click();
    await expect(page.getByRole("heading", { name: "SO-3", level: 1 })).toBeVisible();
    await refuse(page, "orders.confirm", "Only a booking can be confirmed (this order is closed)");
    await page.getByRole("button", { name: gu.orders.confirm }).click();
    const error = page.locator("[data-order-error]");
    await expect(error).toContainText(gu.orders.status.closed);
    await expect(error).not.toContainText("Only a booking");
    await expect(error).toHaveText(gu.refusal.onlyBookingConfirm.replace("{status}", gu.orders.status.closed));
  });

  test("a sentence the build does not know is never shown", async ({ page }) => {
    await open(page, "/orders", "office");
    await page.getByRole("link", { name: /SO-3/ }).first().click();
    await expect(page.getByRole("heading", { name: "SO-3", level: 1 })).toBeVisible();
    await refuse(page, "orders.confirm", "A brand new sentence the server learnt last night");
    await page.getByRole("button", { name: gu.orders.confirm }).click();
    const error = page.locator("[data-order-error]");
    await expect(error).toHaveText(gu.refusal.unknown);
    await expect(error).not.toContainText("brand new");
  });

  test("settings: every tab", async ({ page }) => {
    await open(page, "/settings");
    await expect(h1(page)).toHaveText(gu.settings.title);
    await expectGujarati(page);
    for (const tab of ["company", "team", "shifts", "standards", "modules", "devices", "backup", "support", "about", "printing", "data"] as const) {
      const trigger = page.getByRole("tab", { name: gu.settings.tabs[tab] });
      if ((await trigger.count()) === 0) continue; // a tab the role or plant does not show
      await trigger.first().click();
      await expect(page.getByRole("tab", { selected: true })).toHaveText(gu.settings.tabs[tab]);
      await expectGujarati(page);
    }
  });

  test("approvals reads in Gujarati", async ({ page }) => {
    await open(page, "/approvals", "owner");
    await expect(h1(page)).toHaveText(gu.approvals.title);
    await expectGujarati(page);
  });
});
