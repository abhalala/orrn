import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { bigLot, lockOwnMelt, openOwnCast } from "./helpers/own-foundry";
import { ownerApi } from "./helpers/owner-api";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * The foundry screens (W2-FD-W, FP-FD-02..08, 10..15, 17, 18): /casts, /casts/new, the cast page with its
 * tail panel and trace, the melt stepper from first time to lock, the certificate, billet stock and the
 * Today tile, at 375 / 820 / 1280 as foundry, supervisor, manager and viewer. Each width opens casts of
 * its own through the API or the screen and only ever asserts on them.
 */

const WIDTHS = [375, 820, 1280] as const;

async function open(page: Page, path: string, width: number, role: LocalRole, locale?: "hi" | "gu") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (locale) await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
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
const main = (page: Page) => page.locator("main#main");

/** Yesterday on the plant clock (Asia/Kolkata), as the date field wants it. */
function yesterdayIst(): string {
  const ist = new Date(Date.now() + 5.5 * 3_600_000 - 86_400_000);
  return ist.toISOString().slice(0, 10);
}

test.setTimeout(180_000);

for (const width of WIDTHS) {
  test.describe(`foundry at ${width}`, () => {
    test("foundry opens a cast, writes a melt step by step and locks it", async ({ page }) => {
      const api = await ownerApi();
      const lot = await bigLot(api);
      await api.dispose();

      await open(page, "/casts/new", width, "foundry");
      await expect(h1(page)).toHaveText("Open a cast");
      await expect(page.getByTestId("furnace-line")).toContainText("F1");
      await expect(page.getByTestId("open-cast-submit")).toBeDisabled();
      const alloyValue = await page.getByTestId("alloy-pick").locator("option", { hasText: "6063" }).first().getAttribute("value");
      await page.getByTestId("alloy-pick").selectOption(alloyValue!);
      await page.getByTestId("open-cast-submit").click();
      await expect(page).toHaveURL(/\/casts\/[^/]+$/);
      await expect(h1(page)).toHaveText(/^Cast [A-L]\d+$/);
      const number = (await h1(page).innerText()).replace("Cast ", "").trim();
      const castUrl = page.url();
      // Nothing is made yet: an empty cast says so and has its tail chip neutral.
      await expect(page.getByTestId("tail-chip")).toHaveText("No melts yet");
      await expect(page.getByTestId("fig-produced")).toContainText("0");
      await expectClean(page);

      await page.getByTestId("new-melt").click();
      await expect(page).toHaveURL(/\/melt\/new$/);
      await expect(h1(page)).toContainText(`New melt of ${number}`);
      // Step 1: times.
      await page.getByTestId("melt-date").fill(yesterdayIst());
      await page.getByTestId("melt-time-preheatStart").fill("05:00");
      await page.getByTestId("melt-time-chargingStart").fill("06:00");
      await page.getByTestId("melt-time-chargingEnd").fill("07:00");
      await page.getByTestId("melt-time-castingStart").fill("08:00");
      await page.getByTestId("melt-time-castingEnd").fill("10:00");
      await expect(page.getByTestId("melt-furnace")).toHaveValue(/.+/);
      await expectClean(page);
      await page.getByTestId("melt-next").click();
      // The first save made the draft: the URL has its id, the step is Charge.
      await expect(page).toHaveURL(/\/melt\/(?!new)[^/?]+\?step=charge$/);
      await expect(page.getByTestId("melt-step-charge")).toBeVisible();

      // Step 2: charge one lot.
      await page.getByTestId("add-lot").click();
      await page.getByTestId("lot-pick").selectOption(lot.id);
      await page.getByTestId("lot-kg").fill("100");
      await expect(page.getByTestId("charge-total")).toContainText("100");
      await expect(page.getByTestId("balance-chip")).toContainText("In 100");
      await page.getByTestId("melt-next").click();
      await expect(page.getByTestId("melt-step-chemicals")).toBeVisible();

      // Step 3: LDO dips, used = start - end.
      await page.getByTestId("ldo-start").fill("42");
      await page.getByTestId("ldo-end").fill("37");
      await expect(page.getByTestId("ldo-used")).toContainText("5");
      await page.getByTestId("melt-next").click();
      await expect(page.getByTestId("melt-step-output")).toBeVisible();

      // Step 4: 4 logs of 12 ft, 95 kg; dross 3, iron 1 -> burn 1 kg (1.0 %), yield 95.0 %.
      await page.getByTestId("add-log").click();
      await page.getByTestId("log-pcs").fill("4");
      await page.getByTestId("log-length").fill("12");
      await page.getByTestId("log-kg").fill("95");
      await page.getByTestId("melt-dross").fill("3");
      await page.getByTestId("melt-fe").fill("1");
      const chip = page.getByTestId("balance-chip");
      await expect(chip).toContainText(/Burn 1(\.0)? kg \(1\.0%\)/);
      await expect(chip).toContainText("Yield 95.0%");
      await expectClean(page);
      await page.getByTestId("melt-next").click();

      // Step 5: no spectro yet, so the gate list names it; type the numbers with a reason.
      await expect(page.getByTestId("melt-step-spectro")).toBeVisible();
      await expect(page.getByTestId("spectro-none")).toBeVisible();
      await expect(page.getByTestId("gates")).toContainText("Spectro has not passed");
      await page.getByTestId("spectro-type").click();
      const vals: Record<string, string> = { si: "0.42", fe: "0.18", cu: "0.02", mn: "0.03", mg: "0.52", zn: "0.01", ti: "0.02", cr: "0.01" };
      for (const [el, v] of Object.entries(vals)) await page.getByTestId(`spectro-el-${el}`).fill(v);
      await expect(page.getByTestId("spectro-preview")).toContainText("Pass");
      await page.getByTestId("spectro-type-reason").fill("The printer is down");
      await page.getByTestId("spectro-type-confirm").click();
      const result = page.getByTestId("spectro-result").first();
      await expect(result).toHaveAttribute("data-verdict", "pass");
      await expect(result.getByTestId("spectro-table")).toContainText("98.790");
      await expect(page.getByTestId("gates-ready")).toBeVisible();
      await expectClean(page);

      await page.getByTestId("melt-lock").click();
      await expect(page).toHaveURL(castUrl);
      await expect(page.getByText(`Melt 1 of ${number} is locked`).first()).toBeVisible();
      await expect(page.getByTestId("fig-produced")).toContainText("95");
      await expect(page.getByTestId("fig-in")).toContainText("100");
      await expect(page.getByTestId("fig-burn")).toContainText("1");
      await expect(page.getByTestId("fig-tail")).toContainText("0");
      await expect(page.getByTestId("tail-chip")).toHaveText("Every billet accounted for");
      await expectClean(page);

      // The locked melt opens read-only with the correction request, not a form.
      await main(page).getByRole("link", { name: /Melt 1/ }).first().click();
      await expect(page.getByTestId("melt-sheet")).toBeVisible();
      await expect(page.getByTestId("sheet-logs")).toContainText("95");
      await expect(page.getByTestId("melt-save")).toHaveCount(0);
      await expect(page.getByTestId("ask-correction")).toBeVisible();
      await expectClean(page);
    });

    test("lock gates are said in the user's language (Hindi) and point to the step that fixes them", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await api.mutate("foundry.melts.save", { castId: cast.id, times: {} });
      const got = await api.query<{ melts: { id: string }[] }>("foundry.casts.get", { id: cast.id });
      const meltId = got.melts[0]!.id;
      await api.dispose();

      await open(page, `/casts/${cast.id}/melt/${meltId}?step=spectro`, width, "foundry", "hi");
      const gates = page.getByTestId("gates");
      await expect(gates).toBeVisible();
      await expect(gates).toContainText("चार्जिंग शुरू");
      await expect(gates.locator("[data-gate='no_input']")).toContainText("फ़र्नेस");
      const text = await main(page).innerText();
      expect(text).not.toMatch(/\bfoundry\.[a-z]+\.[A-Za-z.]+/);
      expect(text).not.toContain("Add what went into the furnace");
      await gates.locator("[data-gate='no_input']").getByRole("button").click();
      await expect(page.getByTestId("melt-step-charge")).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    test("the floor screens read in Gujarati: the list, the cast, the stepper and the lock gates, no raw key", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id);
      await api.mutate("foundry.melts.save", { castId: cast.id, times: {} });
      const got = await api.query<{ melts: { id: string; status: string }[] }>("foundry.casts.get", { id: cast.id });
      const draftId = got.melts.find((m) => m.status === "draft")!.id;
      await api.dispose();
      const noRawKey = async () => {
        const text = await main(page).innerText();
        expect(text.match(/\b(?:foundry|approvals|units|common)\.[A-Za-z_]+(?:\.[A-Za-z_0-9]+)*\b/)?.[0] ?? null, "a raw dictionary key is on screen").toBeNull();
        await expect(page.locator("html")).toHaveAttribute("lang", "gu");
        await expectNoHorizontalScroll(page);
      };
      await open(page, "/casts", width, "foundry", "gu");
      await expect(h1(page)).toHaveText("Cast");
      await noRawKey();
      await page.goto(`/casts/${cast.id}`);
      await expect(page.getByTestId("tail-panel")).toContainText("Billet");
      await noRawKey();
      await page.goto(`/casts/${cast.id}/melt/${draftId}?step=spectro`);
      await expect(page.getByTestId("gates")).toContainText("લખો");
      await noRawKey();
      for (const step of ["times", "charge", "chemicals", "output"]) {
        await page.goto(`/casts/${cast.id}/melt/${draftId}?step=${step}`);
        await expect(page.getByTestId(`melt-step-${step}`)).toBeVisible();
        await noRawKey();
      }
    });

    test("a draft melt is discarded: it keeps its number as cancelled and nothing is posted", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await api.mutate("foundry.melts.save", { castId: cast.id, times: {} });
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "foundry");
      await expect(page.getByTestId("tail-chip")).toHaveText("No melts yet");
      await main(page).getByRole("link", { name: /Melt 1/ }).first().click();
      await expect(page.getByTestId("melt-step-times")).toBeVisible();
      await page.getByTestId("discard-draft").click();
      await page.getByTestId("discard-confirm").click();
      await expect(page).toHaveURL(new RegExp(`/casts/${cast.id}$`));
      await expect(page.getByText("Draft discarded").first()).toBeVisible();
      await expect(main(page).locator("tr, li").filter({ hasText: "Melt 1" }).first()).toContainText("Cancelled");
      await expect(page.getByTestId("fig-produced")).toContainText("0");
    });

    test("the casts list filters by status, opens a cast and traces a cast code and a bundle", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id);
      await api.dispose();

      await open(page, "/casts", width, "supervisor");
      await expect(h1(page)).toHaveText("Casts");
      await page.getByTestId("trace-input").fill(cast.number.toLowerCase());
      await page.getByTestId("trace-go").click();
      await expect(page).toHaveURL(new RegExp(`q=${cast.number}`, "i"));
      const rows = main(page).locator("tr, li").filter({ hasText: cast.number });
      await expect(rows.first()).toBeVisible();
      await page.getByRole("radio", { name: "Closed" }).click();
      await expect(page).toHaveURL(/status=closed/);
      await expect(main(page).getByTestId("cast-number").filter({ hasText: new RegExp(`^${cast.number}$`) })).toHaveCount(0);
      await page.getByRole("radio", { name: "Open", exact: true }).click();
      await expect(main(page).getByTestId("cast-number").filter({ hasText: new RegExp(`^${cast.number}$`) }).first()).toBeVisible();
      await page.getByTestId("trace-input").fill("hello");
      await page.getByTestId("trace-go").click();
      await expect(page.getByText("Type a cast code like k31 or a bundle number like 26J1842.")).toBeVisible();
      await expect(page.getByTestId("open-cast")).toBeVisible();
      await expect(page.getByRole("link", { name: "Spectro inbox" })).toBeVisible();
      await expectClean(page);
      await main(page).getByTestId("cast-number").filter({ hasText: new RegExp(`^${cast.number}$`) }).first().click();
      await expect(page).toHaveURL(new RegExp(`/casts/${cast.id}$`));
    });

    test("the cast page: tail panel, trace tree and a close that needs no reason when every billet is accounted for", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id, { inKg: 120, logsKg: 100, drossKg: 4, feKg: 1 });
      await api.dispose();

      await open(page, `/casts/${cast.id}`, width, "supervisor");
      await expect(h1(page)).toHaveText(`Cast ${cast.number}`);
      await expect(page.getByTestId("fig-produced")).toContainText("100");
      await expect(page.getByTestId("fig-onhand")).toContainText("100");
      await expect(page.getByTestId("fig-pressed")).toContainText("0");
      await expect(page.getByTestId("fig-tail")).toContainText("0");
      // Burn and bundles are shown beside the tail, never in it.
      await expect(page.getByTestId("fig-burn")).toContainText("15");
      await expect(page.getByTestId("fig-bundles")).toBeVisible();
      await page.getByRole("tab", { name: "Trace" }).click();
      await expect(page).toHaveURL(/tab=trace/);
      const tree = page.getByTestId("trace-tree");
      await expect(tree.getByTestId("trace-lots")).toContainText("LOT-");
      await expect(tree.getByTestId("trace-melts")).toContainText("Melt 1");
      await expect(tree.getByTestId("trace-billets")).toContainText("made 100");
      await expect(tree.getByTestId("trace-runs")).toContainText("The press has not used this cast yet.");
      await expectClean(page);
      await page.getByRole("tab", { name: "Melts" }).click();

      await page.getByTestId("close-cast").click();
      await expect(page.getByTestId("close-figures")).toContainText("100");
      // The closer counts first: nothing is decided before the count is written.
      await expect(page.getByText("Write the count to see the tail.")).toBeVisible();
      await page.getByTestId("close-pcs").fill("4");
      await page.getByTestId("close-kg").fill("100");
      await expect(page.getByTestId("close-clean")).toBeVisible();
      await expect(page.getByTestId("close-adjust")).toHaveText("No change to the ledger");
      await expect(page.getByTestId("close-reason")).toHaveCount(0);
      await page.getByTestId("close-confirm").click();
      await expect(page.getByText(`Cast ${cast.number} is closed`).first()).toBeVisible();
      await expect(page.getByTestId("cast-chips")).toContainText("Closed");
      await expect(page.getByTestId("close-cast")).toHaveCount(0);
      await expect(page.getByTestId("new-melt")).toHaveCount(0);
    });

    test("a count below the ledger needs a reason, moves the ledger to the count and closes", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id, { inKg: 120, logsKg: 100, drossKg: 4, feKg: 1 });
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "supervisor");
      await page.getByTestId("close-cast").click();
      await page.getByTestId("close-pcs").fill("4");
      await page.getByTestId("close-kg").fill("98");
      await expect(page.getByTestId("close-tail")).toContainText("2");
      await expect(page.getByTestId("close-adjust")).toContainText("-");
      await expect(page.getByTestId("close-needs-approval")).toHaveCount(0);
      await page.getByTestId("close-confirm").click();
      await expect(page.getByText("Pick a reason.")).toBeVisible();
      await page.getByTestId("close-reason").selectOption({ index: 2 });
      await page.getByTestId("close-confirm").click();
      await expect(page.getByText(`Cast ${cast.number} is closed`).first()).toBeVisible();
      // The counted billets are what stays on hand.
      await expect(page.getByTestId("fig-onhand")).toContainText("98");
      await expect(page.getByTestId("fig-tail")).toContainText("0");
    });

    test("a count far below the ledger goes to a second person with the figures in front of them", async ({ page, browser }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id, { inKg: 120, logsKg: 100, drossKg: 4, feKg: 1 });
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "supervisor");
      await page.getByTestId("close-cast").click();
      await page.getByTestId("close-pcs").fill("3");
      await page.getByTestId("close-kg").fill("90");
      await expect(page.getByTestId("close-needs-approval")).toBeVisible();
      await page.getByTestId("close-reason").selectOption({ index: 2 });
      await expect(page.getByTestId("close-confirm")).toHaveText("Send for approval");
      await page.getByTestId("close-confirm").click();
      await expect(page.getByText(`Close of cast ${cast.number} sent for approval`).first()).toBeVisible();
      await expect(page.getByTestId("closing-note")).toBeVisible();
      await expect(page.getByTestId("new-melt")).toHaveCount(0);

      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const manager = await ctx.newPage();
      await open(manager, "/approvals", width, "manager");
      const item = manager.locator("main#main").locator("li, tr").filter({ hasText: `Close cast ${cast.number}` }).first();
      await item.getByRole("button", { name: "Review" }).click();
      const figures = manager.getByTestId("foundry-summary");
      await expect(figures).toContainText("On hand by the ledger");
      await expect(figures).toContainText("Counted by the closer");
      await expect(figures).toContainText("90");
      await expect(manager.getByRole("link", { name: "Open cast" })).toHaveAttribute("href", `/casts/${cast.id}`);
      await manager.getByRole("button", { name: "Approve" }).click();
      await expect(manager.getByText("Approved").first()).toBeVisible();
      await ctx.close();
      await page.reload();
      await expect(page.getByTestId("cast-chips")).toContainText("Closed");
      await expect(page.getByTestId("fig-onhand")).toContainText("90");
    });

    test("an empty cast can be cancelled by a supervisor, with a reason", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "supervisor");
      await page.getByTestId("cancel-cast").click();
      await page.getByTestId("cancel-confirm").click();
      await expect(page.getByText("Give a reason.")).toBeVisible();
      await page.getByTestId("cancel-reason").fill("Opened by mistake");
      await page.getByTestId("cancel-confirm").click();
      await expect(page.getByText(`Cast ${cast.number} is cancelled`).first()).toBeVisible();
      await expect(page.getByTestId("cast-chips")).toContainText("Cancelled");
    });

    test("the certificate reads the cast: staff copy, melts, spectro against the limits, a print button", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      const melt = await lockOwnMelt(api, cast.id);
      await api.mutate("foundry.spectro.enter", {
        meltId: melt.meltId,
        valuesPpm: { si: 4200, fe: 4100, cu: 200, mn: 300, mg: 5200, zn: 100, ti: 200, cr: 100 },
        entryReason: "e2e fail reading",
      });
      await api.dispose();
      await open(page, `/casts/${cast.id}/certificate`, width, "manager");
      await expect(h1(page)).toHaveText("Test certificate");
      const cert = page.getByTestId("cast-certificate");
      // Fe 0.41 is above the 6063 limit of 0.35: it prints as a fail and there is no way to mark it passed.
      await expect(page.getByTestId("cert-verdict")).toHaveText("Fail");
      await expect(cert).toHaveAttribute("data-verdict", "fail");
      await expect(cert).toContainText(cast.number);
      await expect(cert.locator("[data-element='fe']")).toContainText("0.410");
      await expect(cert.locator("[data-element='fe']")).toContainText("Outside");
      await expect(cert).toContainText("not a tax invoice");
      await expect(page.getByRole("button", { name: /pass/i })).toHaveCount(0);
      await expect(page.getByTestId("cert-print")).toBeVisible();
      await expectClean(page);
    });

    test("billet stock lists the cast under its alloy; Today carries the Foundry tile", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id, { inKg: 100, logsKg: 90, drossKg: 5, feKg: 2 });
      await api.dispose();
      await open(page, "/foundry/stock", width, "foundry");
      await expect(h1(page)).toHaveText("Billet stock");
      const card = page.locator(`[data-cast='${cast.number}']`).first();
      await expect(card).toBeVisible();
      await expect(card).toContainText("90");
      await expect(page.locator("[data-alloy='6063']").first()).toBeVisible();
      await expectClean(page);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/casts/${cast.id}$`));

      await page.goto("/today");
      const tile = page.getByTestId("today-foundry");
      await expect(tile).toBeVisible();
      await expect(tile).toContainText("Open casts");
      await expect(tile).toContainText("Melts in progress");
      await expect(tile).toContainText("Spectro waiting");
      await expect(page.getByTestId("today-spectro-inbox-link")).toBeVisible();
      await expectClean(page);
    });

    test("a viewer reads the casts, the cast page and the stock but cannot start or close anything", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id);
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "viewer");
      await expect(h1(page)).toHaveText(`Cast ${cast.number}`);
      await expect(page.getByTestId("tail-panel")).toBeVisible();
      await expect(page.getByTestId("new-melt")).toHaveCount(0);
      await expect(page.getByTestId("close-cast")).toHaveCount(0);
      await expect(page.getByTestId("cancel-cast")).toHaveCount(0);
      await page.goto("/casts");
      await expect(page.getByTestId("open-cast")).toHaveCount(0);
      // The melt page for a viewer is the read-only sheet.
      await page.goto(`/casts/${cast.id}`);
      await main(page).getByRole("link", { name: /Melt 1/ }).first().click();
      await expect(page.getByTestId("melt-sheet")).toBeVisible();
      await expect(page.getByTestId("ask-correction")).toHaveCount(0);
      await expectClean(page);
    });

    test("the cost card is for purchase readers: a manager sees it, a foundry hand does not", async ({ page }) => {
      const api = await ownerApi();
      const cast = await openOwnCast(api);
      await lockOwnMelt(api, cast.id);
      await api.dispose();
      await open(page, `/casts/${cast.id}`, width, "manager");
      await expect(page.getByTestId("cost-card")).toBeVisible();
      await expect(page.getByTestId("new-melt")).toHaveCount(0);
      await page.goto("/casts");
      await open(page, `/casts/${cast.id}`, width, "foundry");
      await expect(page.getByTestId("cost-card")).toHaveCount(0);
      await expect(page.getByTestId("new-melt")).toBeVisible();
    });
  });
}
