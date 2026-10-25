import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Collector UIs (BACKLOG 46): the press alerts list with acknowledge, the Today chips that link to it,
 * the limits editor in Settings -> Devices, and the spectro inbox (attach to a melt of an existing cast,
 * dismiss with a reason; a simulated file only dismisses). The seed has five alerts (all ended; three
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

/** The row or card that mentions `text` (phone cards are list items, wide screens table rows). */
const rowWith = (page: Page, text: string | RegExp) => page.locator("main#main").locator("tr, li").filter({ hasText: text }).last();

test.setTimeout(120_000);

for (const width of WIDTHS) {
  const own = OWN[width];
  test.describe(`press alerts at ${width}`, () => {
    test("opens on open alerts (none), All lists them, a supervisor acknowledges one", async ({ page }) => {
      await open(page, "/press/alerts", width);
      await expect(page.getByRole("heading", { level: 1, name: "Press alerts" })).toBeVisible();
      // Every seeded alert has ended, so the default list is empty and says so.
      await expect(page.getByText("No open alerts.")).toBeVisible();
      await page.getByRole("radio", { name: "All" }).click();
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
      const chip = page.getByTestId("today-press-alerts-today");
      await expect(chip).toBeVisible();
      await expect(chip).toContainText("Press alerts today");
      await chip.click();
      await expect(page).toHaveURL(/\/press\/alerts\?show=all/);
      await expect(page.getByRole("heading", { level: 1, name: "Press alerts" })).toBeVisible();
    });
  });

  test.describe(`limits editor at ${width}`, () => {
    test("Settings, Devices: set an upper limit for every press, it is kept after a reload", async ({ page }) => {
      await open(page, "/settings?tab=devices", width, "owner");
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

    test("a role without users.manage does not get the Devices tab", async ({ page }) => {
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
      await sheet.getByTestId("inbox-cast").selectOption({ index: 1 });
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

test("the alerts list and the inbox read in Hindi and Gujarati", async ({ page }) => {
  for (const [locale, title] of [["hi", "प्रेस अलर्ट"], ["gu", "પ્રેસ એલર્ટ"]] as const) {
    await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
    await open(page, "/press/alerts?show=all", 375);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});
