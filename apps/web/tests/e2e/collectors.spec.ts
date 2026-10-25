import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { devInvite, uniqueEmail, type InviteRole } from "./helpers/front-door";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Collector UIs (BACKLOG 46): the press alerts list with acknowledge, the Today chips that link to it,
 * the limits editor in Settings -> Standards, and the spectro inbox (attach to a melt of an existing cast,
 * dismiss with a reason; a simulated file only dismisses). Review I-5: the limits editor lives in
 * Settings -> Standards (managers reach it), and foundry reaches the inbox from Today. The seed has five alerts (all ended; three
 * unacknowledged, one per width), and seven spectro files (two per width and a simulated one) on the
 * closed cast with one melt. Each width works its own alert, file and limit, so parallel widths never meet.
 */

const WIDTHS = [375, 820, 1280] as const;
const OWN: Record<(typeof WIDTHS)[number], { metric: string; limitMetric: string; max: string }> = {
  375: { metric: "Ram speed", limitMetric: "Ram speed", max: "12.5" },
  820: { metric: "Billet temperature", limitMetric: "Billet temperature", max: "480" },
  1280: { metric: "Exit temperature", limitMetric: "Exit temperature", max: "560" },
};

async function open(page: Page, path: string, width: number, role: LocalRole = "supervisor") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

async function expectClean(page: Page) {
  await expectNoHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).include("main#main").exclude("[data-sonner-toaster]").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/**
 * A fresh member of the seeded plant with a role no seeded account has (manager, foundry): invited
 * through the dev hook into the demo company, joined the real way, then on Today.
 */
async function joinAs(page: Page, role: InviteRole, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const email = uniqueEmail(`e2e-${role}`);
  const { path } = await devInvite(page.context().request, { email, role, companyId: "dev-company-orrn" });
  await page.goto(path);
  await page.getByLabel("Your name").fill(role === "manager" ? "Nilesh Patel" : "Ramesh Solanki");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(`E2e-${crypto.randomUUID().slice(0, 12)}`);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Go to Today" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

/** The row or card that mentions `text` (phone cards are list items, wide screens table rows). */
const rowWith = (page: Page, text: string | RegExp) => page.locator("main#main").locator("tr, li").filter({ hasText: text }).last();

test.setTimeout(120_000);

for (const width of WIDTHS) {
  const own = OWN[width];
  test.describe(`press alerts at ${width}`, () => {
    test("opens on the open alerts (not acknowledged yet, ended or not), All lists them, a supervisor acknowledges one", async ({ page }) => {
      await open(page, "/press/alerts", width);
      await expect(page.getByRole("heading", { level: 1, name: "Press alerts" })).toBeVisible();
      // BACKLOG 81: open = not acknowledged. Every seeded alert has ended, but four were never acknowledged, so
      // the default list holds them (this width's own alert among them) and the tab counts them.
      await expect(page.getByRole("radio", { name: /^Open \(\d+\)/ })).toBeVisible();
      await expect(page.getByText("No open alerts.")).toHaveCount(0);
      await expect(rowWith(page, own.metric)).toBeVisible();
      await page.getByRole("radio", { name: /^All \(\d+\)/ }).click();
      await expect(page).toHaveURL(/show=all/);
      await expect(rowWith(page, own.metric)).toBeVisible();
      await expect(page.getByText("From the simulator").first()).toBeVisible();
      await expect(page.getByText("Container temperature").first()).toBeVisible();
      await expectClean(page);

      const mine = rowWith(page, own.metric);
      await expect(mine.getByText("Ended")).toBeVisible();
      await mine.getByRole("button", { name: "Acknowledge" }).click();
      await expect(page.getByText("Alert acknowledged").first()).toBeVisible();
      await expect(mine.getByText("Acknowledged").first()).toBeVisible();
      await expect(mine.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
      // The one the seed acknowledged already has no button either.
      await expect(rowWith(page, "Pressure").getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
    });

    test("a press hand reads the list but cannot acknowledge", async ({ page }) => {
      await open(page, "/press/alerts?show=all", width, "press");
      await expect(page.getByRole("heading", { level: 1, name: "Press alerts" })).toBeVisible();
      await expect(page.getByText("Ram speed").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
    });

    test("Today's press tile links its alert chip to the list", async ({ page }) => {
      await open(page, "/today", width, "press");
      // The open chip and the page's Open tab are one number (BACKLOG 81).
      const openChip = page.getByTestId("today-press-alerts-open");
      await expect(openChip).toBeVisible();
      const openCount = Number(/(\d+)\s*$/.exec((await openChip.innerText()).trim())?.[1]);
      expect(openCount).toBeGreaterThan(0);
      await openChip.click();
      await expect(page).toHaveURL(/\/press\/alerts$/);
      await expect(page.getByRole("radio", { name: new RegExp(`^Open \\(${openCount}\\)`) })).toBeVisible();
      await open(page, "/today", width, "press");
      const chip = page.getByTestId("today-press-alerts-today");
      await expect(chip).toBeVisible();
      await expect(chip).toContainText("Press alerts today");
      await chip.click();
      await expect(page).toHaveURL(/\/press\/alerts\?show=all/);
      await expect(page.getByRole("heading", { level: 1, name: "Press alerts" })).toBeVisible();
    });
  });

  test.describe(`limits editor at ${width}`, () => {
    test("Settings, Standards: set an upper limit for every press, it is kept after a reload", async ({ page }) => {
      await open(page, "/settings?tab=standards", width, "owner");
      const card = page.getByTestId("settings-collectors");
      await expect(card).toBeVisible();
      await expect(card.getByRole("link", { name: "Open the press alerts" })).toHaveAttribute("href", "/press/alerts");
      await expect(card.getByRole("link", { name: "Open the spectro inbox" })).toHaveAttribute("href", "/casts/inbox");
      const band = card.getByTestId(`band-${own.metric === "Ram speed" ? "ram_speed" : own.metric === "Billet temperature" ? "billet_temp" : "exit_temp"}`);
      await expect(band).toBeVisible();
      // Nothing to save yet; both sides empty is not a band.
      await expect(band.getByRole("button", { name: "Save" })).toBeDisabled();
      await band.getByLabel("Upper limit").fill(own.max);
      await band.getByLabel("Lower limit").fill(String(Number(own.max) + 1));
      await expect(band.getByText("Give a lower or an upper limit, and keep the lower one below the upper.")).toBeVisible();
      await expect(band.getByRole("button", { name: "Save" })).toBeDisabled();
      await band.getByLabel("Lower limit").fill("");
      await band.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Limits saved").first()).toBeVisible();
      await expectClean(page);

      await page.reload();
      await expect(page.getByTestId("settings-collectors")).toBeVisible();
      const again = page.getByTestId("settings-collectors").getByTestId(`band-${own.metric === "Ram speed" ? "ram_speed" : own.metric === "Billet temperature" ? "billet_temp" : "exit_temp"}`);
      await expect(again.getByLabel("Upper limit")).toHaveValue(own.max);
      // Switch it off again so the shared plant is left as found.
      await again.getByLabel("On").uncheck();
      await again.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Limits saved").first()).toBeVisible();
    });

    test("a role without masters.publish reads the limits on Standards with nothing to save", async ({ page }) => {
      await open(page, "/settings?tab=standards", width, "viewer");
      const card = page.getByTestId("settings-collectors");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("collectors-read-only")).toBeVisible();
      await expect(card.getByRole("button", { name: "Save" })).toHaveCount(0);
      // The Devices tab is still admin-only and no longer carries the card.
      await open(page, "/settings?tab=devices", width, "viewer");
      await expect(page.getByTestId("settings-collectors")).toHaveCount(0);
    });
  });

  test.describe(`spectro inbox at ${width}`, () => {
    test("a simulated file can only be dismissed; a real one is attached to a melt of an existing cast", async ({ page }) => {
      await open(page, "/casts/inbox", width);
      await expect(page.getByRole("heading", { level: 1, name: "Spectro inbox" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Waiting", selected: true })).toBeVisible();
      const sim = rowWith(page, "simulated-6063.csv");
      await expect(sim).toBeVisible();
      await expect(sim.getByText("Simulated").first()).toBeVisible();
      await expect(sim.getByRole("button", { name: "Attach to a melt" })).toBeDisabled();
      await expectClean(page);

      const file = `6063-${width}-attach.csv`;
      const mine = rowWith(page, file);
      await expect(mine).toBeVisible();
      await mine.getByRole("button", { name: "Attach to a melt" }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      // The melt picker waits for a cast.
      await expect(sheet.getByTestId("inbox-melt")).toBeDisabled();
      // The seed's cast with the locked melt dev-melt-1 (dev-seed.ts), never "the newest cast": chain.spec opens a
      // cast of its own and pins its certificate to "Chemistry pending" (MERGER-11 found the two colliding).
      await sheet.getByTestId("inbox-cast").selectOption("dev-press-cast-1");
      await expect(sheet.getByTestId("inbox-melt")).toBeEnabled();
      await sheet.getByTestId("inbox-melt").selectOption({ label: "Melt 1" });
      await expect(sheet.getByText("si 4500, fe 2000, mg 5200")).toBeVisible();
      await sheet.getByTestId("inbox-attach-confirm").click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText(/File attached to melt 1 of cast/).first()).toBeVisible();
      await expect(page.locator("main#main").getByText(file)).toHaveCount(0);
      await page.getByRole("tab", { name: "Handled" }).click();
      await expect(rowWith(page, file)).toContainText("Attached");
    });

    test("dismiss asks for a reason and moves the file to Handled", async ({ page }) => {
      await open(page, "/casts/inbox", width);
      const file = `6063-${width}-dismiss.csv`;
      await rowWith(page, file).getByRole("button", { name: "Dismiss" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByTestId("inbox-dismiss-confirm").click();
      await expect(sheet.getByText("Give a reason.")).toBeVisible();
      await sheet.getByTestId("inbox-dismiss-reason").fill("Test piece, not a melt sample");
      await sheet.getByTestId("inbox-dismiss-confirm").click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText("File dismissed").first()).toBeVisible();
      await page.getByRole("tab", { name: "Handled" }).click();
      await expect(rowWith(page, file)).toContainText("Dismissed");
      await expect(rowWith(page, file)).toContainText("Test piece, not a melt sample");
    });

    test("a role that does not enter casts reads the list with no Attach or Dismiss", async ({ page }) => {
      await open(page, "/casts/inbox", width, "operator");
      await expect(page.getByRole("heading", { level: 1, name: "Spectro inbox" })).toBeVisible();
      await expect(page.getByText("simulated-6063.csv")).toBeVisible();
      await expect(page.getByRole("button", { name: "Attach to a melt" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    });
  });
}

test.describe("collector screens reach the roles that use them (review I-5)", () => {
  test("a manager opens Settings, Standards and can edit the limits", async ({ page }) => {
    await joinAs(page, "manager", 820);
    await page.goto("/settings?tab=standards");
    const card = page.getByTestId("settings-collectors");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("collectors-read-only")).toHaveCount(0);
    await expect(card.getByTestId("band-pressure").getByLabel("Upper limit")).toBeEditable();
    await expect(card.getByRole("link", { name: "Open the press alerts" })).toHaveAttribute("href", "/press/alerts");
    await expectClean(page);
  });

  test("foundry opens the spectro inbox from Today and can attach or dismiss", async ({ page }) => {
    await joinAs(page, "foundry", 375);
    const chip = page.getByTestId("today-spectro-inbox-link");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Spectro inbox");
    await chip.click();
    await expect(page).toHaveURL(/\/casts\/inbox$/);
    await expect(page.getByRole("heading", { level: 1, name: "Spectro inbox" })).toBeVisible();
    await expect(rowWith(page, "simulated-6063.csv").getByRole("button", { name: "Dismiss" })).toBeVisible();
    // Back goes to Today, where foundry came from.
    await page.getByRole("link", { name: "Today" }).first().click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("Today has no inbox chip for a role that does not enter casts", async ({ page }) => {
    await open(page, "/today", 820, "operator");
    await expect(page.getByTestId("today-spectro-inbox-link")).toHaveCount(0);
  });
});

test("the alerts list and the inbox read in Hindi and Gujarati", async ({ page }) => {
  for (const [locale, title] of [["hi", "प्रेस अलर्ट"], ["gu", "પ્રેસ એલર્ટ"]] as const) {
    await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
    await open(page, "/press/alerts?show=all", 375);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});
