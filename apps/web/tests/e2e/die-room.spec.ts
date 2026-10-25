import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { ownPressRun } from "./helpers/own-press";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Die room (`/dies`, `/dies/$id`, `/dies/copies/$copyId`, `/lift`, `/dies/issues`, `/dies/makers`,
 * `/dies/$id/bands/new`) against the seeded plant: Tee 13090 with three copies (green, amber, red),
 * Channel 12230 owned by KD Extrusion, Patti 14701 with its copy out on P1. Every figure on screen
 * (percent, tone, band position, kg/m) comes from the server; these tests add readings and check
 * what the server answers.
 *
 * Tests run in parallel (fullyParallel), so every mutating test owns what it touches: each width has
 * its own copy for a tier proposal (13090-1/2/3), for a reading (13090-4/5/6) and for an issue
 * (13090-7/8/9: refused on its P1 run PR-2/3/4 while 14701-1 sits there, then onto a press and run of
 * its own, BACKLOG 36); the 375 lift page has 13090-10; the section and
 * band edits use sections nothing else reads (Angle 11250, Flat 14730). The seed is reset at the
 * start of each run, so two runs in a row meet the same plant.
 */

const WIDTHS = [375, 820, 1280] as const;
type Width = (typeof WIDTHS)[number];

/** Per width: the Tee copies it changes, the reading it adds (kg/12ft -> percent) and the run it issues to. */
const PLAN: Record<Width, { tierCopy: string; readCopy: string; reading: string; pct: string; issueCopy: string; run: string }> = {
  375: { tierCopy: "13090-1", readCopy: "13090-4", reading: "2.790", pct: "+3.3%", issueCopy: "13090-7", run: "PR-2" },
  820: { tierCopy: "13090-2", readCopy: "13090-5", reading: "2.795", pct: "+3.5%", issueCopy: "13090-8", run: "PR-3" },
  1280: { tierCopy: "13090-3", readCopy: "13090-6", reading: "2.800", pct: "+3.7%", issueCopy: "13090-9", run: "PR-4" },
};

async function open(page: Page, path: string, opts: { role: LocalRole; width: number; locale?: "hi" }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (opts.locale) await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  await signInViaApi(page, opts.role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
}

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

/** Wait for the page and tab crossfades to finish (finite animations only), so a capture or an axe run never sees one mid-way. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** DR_SHOTS=<dir> keeps a full-page capture of every screen the checks visit. */
async function shot(page: Page, tag = "") {
  const dir = process.env.DR_SHOTS;
  if (!dir) return;
  const name = `${tag ? `${tag}__` : ""}${page.viewportSize()?.width ?? 0}${await page.locator("html").getAttribute("lang") === "hi" ? "-hi" : ""}__${new URL(page.url()).pathname.replace(/\W+/g, "_")}${new URL(page.url()).search.replace(/\W+/g, "_")}`;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: "disabled" });
}

async function expectClean(page: Page) {
  await settle(page);
  await shot(page);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

/** Go to a copy's card through the Tee section page, the way a person would. */
async function openCopy(page: Page, code: string) {
  await page.getByRole("link", { name: code, exact: true }).click();
  await expect(page.locator("main#main h1")).toHaveText(code);
}

async function openTee(page: Page) {
  await page.getByRole("link", { name: /13090/ }).first().click();
  await expect(page.locator("main#main h1")).toContainText("13090");
}

/** A searchable picker: type what the floor writes, then take the option. */
async function pickFromSearch(page: Page, scope: Locator, name: string, text: string, option: string | RegExp = text) {
  const box = scope.getByRole("combobox", { name, exact: true });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).click();
}

test.setTimeout(120_000);
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const width of WIDTHS) {
  test.describe(`die room at ${width}`, () => {
    const plan = PLAN[width];

    test("the board lists sections with the worst drift of their copies on the rack", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await expect(page.getByText("13090").first()).toBeVisible();
      // Tee: the worst of green, amber and red is red. Channel has one green copy and an owner.
      await expect(page.getByText("Over band").first()).toBeVisible();
      await expect(page.getByText("KD Extrusion").first()).toBeVisible();
      await expect(page.getByText("In band").first()).toBeVisible();
      await expectClean(page);

      // A copy code finds its section, with a slash or a hyphen.
      await page.getByLabel("Search dies").fill("13090/2");
      await expect(page).toHaveURL(/q=13090(-|%2F)2/);
      await expect(page.getByText("13090").first()).toBeVisible();
      await expect(page.getByText("12230")).toHaveCount(0);
    });

    test("a section shows its bands and the copies on each", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await openTee(page);
      await expect(page.getByTestId("band-primary")).toContainText("2.700–2.900");
      const heavy = page.locator("[data-testid^='band-']").filter({ hasText: "2.900–3.100" });
      await expect(heavy).toHaveCount(1);
      await expect(page.getByTestId("copy-13090-1")).toContainText("In band");
      // Explorer W1 M3: off its band, a copy's percent carries the number only and the position
      // chip gives the one verdict ("+9.3%" and "Above band", never "Near the edge" next to it).
      await expect(page.getByTestId("copy-13090-2")).toContainText("+9.3%");
      await expect(page.getByTestId("copy-13090-2")).toContainText("Above band");
      await expect(page.getByTestId("copy-13090-2")).not.toContainText("Near the edge");
      await expect(heavy).toContainText("13090-3");
      await expect(heavy).toContainText("Above band");
      await expect(heavy).not.toContainText("Over band");
      await expectClean(page);
    });

    test("the die room adds a reading and the server answers with the percent and tone", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await openTee(page);
      await openCopy(page, plan.readCopy);
      await expect(page.getByTestId("current-weight")).toContainText("kg/12ft");

      await page.getByRole("button", { name: "Add reading" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Weight of 12 ft").fill(plan.reading);
      await dialog.getByRole("button", { name: "Add reading" }).click();

      await expect(page.getByTestId("current-weight")).toContainText(plan.reading);
      await expect(page.getByTestId("current-chips")).toContainText(plan.pct);
      await expect(page.getByTestId("current-chips")).toContainText("In band");
      await expect(page.getByTestId("readings-list").locator("li").first()).toContainText(plan.reading);
      await expectClean(page);
    });

    test("a tier change is only a proposal: it waits for a manager", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await openTee(page);
      await openCopy(page, plan.tierCopy);
      await page.getByRole("tab", { name: "Tier" }).click();
      await page.getByRole("button", { name: "Change tier" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("New tier").fill("3");
      await dialog.getByLabel("Reason").fill("Worn after the last run");
      await dialog.getByRole("button", { name: "Ask for approval" }).click();

      const pending = page.getByTestId("tier-pending");
      await expect(pending).toContainText("Waiting for a manager");
      await expect(pending).toContainText("tier 3");
      // No way to approve it from here.
      await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
      // One proposal at a time.
      await expect(page.getByRole("button", { name: "Change tier" })).toBeDisabled();
      await expectClean(page);
    });
  });
}

test.describe("issue to a press and take it back", () => {
  for (const width of WIDTHS) {
    const plan = PLAN[width];
    test(`${width}: ${plan.issueCopy} is refused on P1 (14701-1 is there), then goes to a press of its own and comes back`, async ({ page }) => {
      // BACKLOG 36: one copy per press line. This width's own press and queued run (parallel-safe).
      const own = await ownPressRun(page, { sectionId: "dev-die-13090", purpose: "sample", tag: String(width) });
      await open(page, "/dies/issues", { role: "dieroom", width });
      // The seeded open issue: 14701-1 on P1 for run PR-1, with the die not yet in the press.
      const openIssues = page.getByTestId("open-issues");
      await expect(openIssues.getByTestId("issue-14701-1")).toContainText("Issued to P1");
      await expect(openIssues.getByTestId("issue-14701-1")).toContainText("PR-1");

      const form = page.getByTestId("issue-form");
      await pickFromSearch(page, form, "Copy", plan.issueCopy);
      // The run is named by the person: nothing is picked for them (no silent "oldest").
      await expect(form.getByRole("combobox", { name: "Press run" })).toContainText("Pick a press run");
      await form.getByRole("button", { name: "Issue", exact: true }).click();
      await expect(form.getByRole("alert")).toContainText("Pick a press run");

      // Three Tee runs wait on P1 (PR-2, PR-3, PR-4): each width names its own. P1 holds 14701-1, so
      // the server refuses a second copy there and nothing is issued.
      await form.getByRole("combobox", { name: "Press run" }).click();
      await page.getByRole("option", { name: plan.run }).click();
      await expect(form.getByRole("combobox", { name: "Press run" })).toContainText(plan.run);
      // The run sets the line: P1, and the person cannot pick another.
      await expect(form.getByRole("combobox", { name: "Press line" })).toContainText("P1");
      await expect(form.getByRole("combobox", { name: "Press line" })).toBeDisabled();
      await form.getByRole("button", { name: "Issue", exact: true }).click();
      await expect(form.getByRole("alert")).toContainText(`P1 already has 14701-1 for PR-1. Take it back, or record its die out, before issuing ${plan.issueCopy}.`);
      await expect(openIssues.getByTestId(`issue-${plan.issueCopy}`)).toHaveCount(0);

      // Its own press is free: the copy goes there.
      await form.getByRole("combobox", { name: "Press run" }).click();
      await page.getByRole("option", { name: own.runNumber }).click();
      await expect(form.getByRole("combobox", { name: "Press line" })).toContainText(own.lineCode);
      await form.getByRole("button", { name: "Issue", exact: true }).click();

      const mine = openIssues.getByTestId(`issue-${plan.issueCopy}`);
      await expect(mine).toContainText(`Issued to ${own.lineCode}`);
      await expect(mine).toContainText(own.runNumber);
      await expectClean(page);

      if (width === 820) {
        // Cancelling asks first; saying no keeps the issue.
        await mine.getByRole("button", { name: "Cancel issue" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText(`Cancel the issue of ${plan.issueCopy}?`);
        await dialog.getByRole("button", { name: "Keep it issued" }).click();
        await expect(mine).toBeVisible();
        await mine.getByRole("button", { name: "Cancel issue" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Cancel issue" }).click();
      } else {
        await mine.getByRole("button", { name: "Take back" }).click();
      }
      await expect(openIssues.getByTestId(`issue-${plan.issueCopy}`)).toHaveCount(0);
      await expect(openIssues.getByTestId("issue-14701-1")).toBeVisible();
    });
  }
});


test.describe("files", () => {
  test("1280: the press drawing goes up in three steps and shows on the card", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 1280 });
    await openTee(page);
    await openCopy(page, "13090-1");
    await page.getByRole("tab", { name: "Files" }).click();
    await page.getByRole("checkbox", { name: /press drawing/i }).click();
    await page.getByLabel("Add file").setInputFiles({
      name: "tee-1-25.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
    });
    const row = page.locator("li").filter({ hasText: "tee-1-25.pdf" });
    await expect(row).toContainText("Press drawing");
  });
});

test.describe("band, lift and the duplicate guard (owner)", () => {
  test("a duplicate band answers 'Already exists' with a link; a new band can take a lift that waits", async ({ page }) => {
    await open(page, "/dies", { role: "owner", width: 820 });
    await openTee(page);
    await page.getByRole("link", { name: "Add band" }).click();
    await expect(page.locator("main#main h1")).toHaveText("New band");

    // The same wall and weights as the heavy band that is already there.
    await page.getByLabel("Wall").fill("3");
    await page.getByLabel("Min").fill("2.9");
    await page.getByLabel("Max").fill("3.1");
    await page.getByRole("button", { name: "Save band" }).click();
    const exists = page.getByRole("alert").filter({ hasText: "Already exists" });
    await expect(exists).toContainText("2.900–3.100");
    await expect(exists.getByRole("link")).toHaveAttribute("href", /\/dies\/.+/);

    // Channel 12230 gets a second band, then its one copy is lifted onto it.
    await page.goto("/dies");
    await page.getByRole("link", { name: /12230/ }).first().click();
    await page.getByRole("link", { name: "Add band" }).click();
    await page.getByLabel("Wall").fill("3");
    await page.getByLabel("Min").fill("3.0");
    await page.getByLabel("Max").fill("3.2");
    await page.getByRole("button", { name: "Save band" }).click();
    await expect(page.locator("main#main h1")).toContainText("12230");
    await expect(page.locator("[data-testid^='band-']")).toHaveCount(2);

    await openCopy(page, "12230-1");
    await page.getByRole("tab", { name: "Tier" }).click();
    await page.getByRole("link", { name: "Move to band" }).click();
    await expect(page.locator("main#main h1")).toHaveText("Move to another band");
    await page.getByLabel("Reason").fill("Reads heavy now");
    await page.getByRole("button", { name: "Ask for approval" }).click();
    const pending = page.getByTestId("lift-pending");
    await expect(pending).toContainText("Waiting for a manager");
    await expect(pending).toContainText("3.000–3.200");
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await expectClean(page);
  });
});

test.describe("the lift page on a phone keeps its action above the tab bar", () => {
  test("375: Ask for approval sits above the tab bar", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 375 });
    await openTee(page);
    // 13090-10 reads above its band and no other test proposes on it: the lift page says by how many grams.
    await openCopy(page, "13090-10");
    await page.getByRole("tab", { name: "Tier" }).click();
    await page.getByRole("link", { name: "Move to band" }).click();
    await expect(page.getByTestId("off-band")).toContainText("above by 50 g");
    const action = page.getByRole("button", { name: "Ask for approval" });
    await expect(action).toBeVisible();
    await settle(page);
    const bar = await page.locator("[data-slot='form-actions']").boundingBox();
    const tabs = await page.locator("[data-slot='tab-bar']").boundingBox();
    expect(bar && tabs && bar.y + bar.height <= tabs.y + 1, `bar ${JSON.stringify(bar)} tabs ${JSON.stringify(tabs)}`).toBe(true);
    await expectClean(page);
  });

  test("375: the band form's Save sits above the tab bar", async ({ page }) => {
    await open(page, "/dies", { role: "owner", width: 375 });
    await openTee(page);
    await page.getByRole("link", { name: "Add band" }).click();
    await expect(page.getByRole("button", { name: "Save band" })).toBeVisible();
    const bar = await page.locator("[data-slot='form-actions']").boundingBox();
    const tabs = await page.locator("[data-slot='tab-bar']").boundingBox();
    expect(bar && tabs && bar.y + bar.height <= tabs.y + 1, `bar ${JSON.stringify(bar)} tabs ${JSON.stringify(tabs)}`).toBe(true);
    await expectClean(page);
  });
});

test.describe("owner block", () => {
  for (const width of WIDTHS) {
    test(`${width}: pack for another customer on KD Extrusion's die is refused, naming the owner`, async ({ page }) => {
      await open(page, "/dies/issues", { role: "dieroom", width });
      const panel = page.getByTestId("owner-check");
      await pickFromSearch(page, panel, "Copy", "12230-1");
      await pickFromSearch(page, panel, "For customer", "Royal", "Royal Aluminium");
      await panel.getByRole("radio", { name: "Pack" }).click();

      const result = page.getByTestId("owner-result");
      await expect(result).toContainText("This die belongs to KD Extrusion");
      // The die room cannot ask for the exception; roles that pack or plan can.
      await expect(result.getByRole("button")).toHaveCount(0);

      // The owner themselves is allowed.
      await pickFromSearch(page, panel, "For customer", "KD Extrusion");
      await expect(result).toContainText("Allowed. This die belongs to KD Extrusion.");
      await expectClean(page);
    });
  }

  test("375: a role that packs asks for an exception and it waits for a manager", async ({ page }) => {
    await open(page, "/dies/issues", { role: "owner", width: 375 });
    const panel = page.getByTestId("owner-check");
    await pickFromSearch(page, panel, "Copy", "12230-1");
    await pickFromSearch(page, panel, "For customer", "Royal", "Royal Aluminium");
    await panel.getByLabel("Why is it needed").fill("KD asked us to cover the Royal order");
    await panel.getByRole("button", { name: /Ask to use it for Royal Aluminium/ }).click();
    await expect(page.getByTestId("owner-waiting")).toContainText("Waiting for a manager");
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
  });
});

test.describe("section edit: shape, alloy, temper, wall and owner (D16)", () => {
  test("1280: a manager sets all five on Angle 11250 and the board and section show them", async ({ page }) => {
    await open(page, "/dies", { role: "owner", width: 1280 });
    await page.getByRole("link", { name: /11250/ }).first().click();
    await expect(page.locator("main#main h1")).toContainText("11250");
    await page.getByRole("button", { name: "Edit die" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Solid" }).click();
    await sheet.getByLabel("Alloy").fill("6061");
    await sheet.getByLabel("Temper").fill("T5");
    await sheet.getByLabel("Wall (mm)").fill("2");
    await pickFromSearch(page, sheet, "Owner", "Apex", "Apex Fabricators");
    await settle(page);
    await shot(page, "section-edit");
    await sheet.getByRole("button", { name: "Save die" }).click();
    await expect(sheet).toHaveCount(0);

    const facts = page.locator("main#main p").filter({ hasText: "6061 T5" });
    await expect(facts).toContainText("Solid");
    await expect(facts).toContainText("Apex Fabricators");

    // The board's Shape column reads it too.
    await page.goto("/dies");
    const row = page.getByRole("row", { name: /11250/ });
    await expect(row).toContainText("Solid");
    await expect(row).toContainText("6061 T5");
    await expect(row).toContainText("Apex Fabricators");
    await expectClean(page);
  });

  test("1280: the die room cannot edit a section, so it cannot set an owner either", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 1280 });
    await openTee(page);
    await expect(page.getByRole("button", { name: "Edit die" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add copy" }).first()).toBeVisible();
  });
});

test.describe("band retire (owner)", () => {
  test("1280: an empty band on Flat 14730 is added, then retired after one question", async ({ page }) => {
    await open(page, "/dies", { role: "owner", width: 1280 });
    await page.getByRole("link", { name: /14730/ }).first().click();
    await page.getByRole("link", { name: "Add band" }).click();
    await page.getByLabel("Wall").fill("2");
    await page.getByLabel("Min").fill("3.2");
    await page.getByLabel("Max").fill("3.4");
    await page.getByRole("button", { name: "Save band" }).click();
    await expect(page.locator("main#main h1")).toContainText("14730");
    const band = page.locator("[data-testid^='band-']").filter({ hasText: "3.200–3.400 kg/12ft" });
    await expect(band).toHaveCount(1);
    await band.getByRole("button", { name: "Retire band" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Retire this band?");
    await dialog.getByRole("button", { name: "Retire band" }).click();
    await expect(band.getByText("Retired")).toBeVisible();
    await expect(band.getByRole("button", { name: "Retire band" })).toHaveCount(0);
  });
});

test.describe("an approved exception is listed and a manager closes it", () => {
  // The seed holds one approved exception: Tejura & Sons may use KD Extrusion's 12230-1. The die room
  // reads it first; the manager then closes it. One serial block, so the read always comes first.
  test.describe.configure({ mode: "serial" });

  async function checkTejura(page: Page, role: LocalRole) {
    await open(page, "/dies/issues", { role, width: 1280 });
    const panel = page.getByTestId("owner-check");
    await pickFromSearch(page, panel, "Copy", "12230-1");
    await pickFromSearch(page, panel, "For customer", "Tejura", "Tejura & Sons");
    await panel.getByRole("radio", { name: "Pack" }).click();
    return panel;
  }

  test("the die room sees the exception and the gate allowing it, with no way to close it", async ({ page }) => {
    const panel = await checkTejura(page, "dieroom");
    await expect(page.getByTestId("owner-result")).toContainText("Allowed for Tejura & Sons by an approved exception.");
    const list = page.getByTestId("open-exceptions");
    await expect(list).toContainText("Tejura & Sons");
    await expect(list).toContainText("Pack");
    await expect(list).toContainText("Approved");
    await expect(panel.getByRole("button", { name: "Close exception" })).toHaveCount(0);
  });

  test("the owner closes it, and the next check says the die belongs to KD Extrusion again", async ({ page }) => {
    const panel = await checkTejura(page, "owner");
    await expect(page.getByTestId("owner-result")).toContainText("Allowed for Tejura & Sons by an approved exception.");
    await settle(page);
    await shot(page, "exceptions");
    await panel.getByRole("button", { name: "Close exception" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Close the exception on 12230-1?");
    await dialog.getByRole("button", { name: "Close exception" }).click();

    await expect(page.getByTestId("owner-result")).toContainText("This die belongs to KD Extrusion");
    await expect(page.getByTestId("open-exceptions")).toContainText("No open exception on this copy.");
    await expectClean(page);
  });
});

test.describe("copy and customer pickers ask the server", () => {
  test("375: the list says how many it shows; typing finds a copy and a customer past it", async ({ page }) => {
    await open(page, "/dies/issues", { role: "dieroom", width: 375 });
    const panel = page.getByTestId("owner-check");
    const copy = panel.getByRole("combobox", { name: "Copy", exact: true });
    await copy.click();
    // 21 copies (12, and nine on trial for die-room-w2), 10 on the first page.
    await expect(panel.getByText(/Showing 10 of 2\d, type to find/).first()).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(10);
    await settle(page);
    await shot(page, "pickers");
    await copy.fill("13090/10");
    await expect(page.getByRole("option", { name: "13090-10" })).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: "13090-10" }).click();
    await expect(copy).toHaveValue("13090-10");

    await pickFromSearch(page, panel, "For customer", "Shivam", "Shivam Bhavnagar");
    await expect(panel.getByRole("combobox", { name: "For customer" })).toHaveValue("Shivam Bhavnagar");
    await expectClean(page);
  });
});

test.describe("A4 copy card", () => {
  test("1280: Print card shows the one-page sheet in print and hides the screen", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await open(page, "/dies", { role: "dieroom", width: 1280 });
    await openTee(page);
    await openCopy(page, "13090-2");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print card" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

    await page.emulateMedia({ media: "print" });
    const sheet = page.getByTestId("print-card");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("13090-2");
    await expect(sheet).toContainText("2.700–2.900 kg/12ft");
    await expect(sheet).toContainText("2.950");
    await expect(page.locator(".die-screen")).toBeHidden();
    const dir = process.env.DR_SHOTS;
    if (dir) await page.screenshot({ path: `${dir}/print__a4_copy_card.png`, fullPage: true, animations: "disabled" });
  });
});

test.describe("files refuse what the server refuses", () => {
  test("375: a 9 MB photo shows the server's size message and nothing is added", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 375 });
    await openTee(page);
    await openCopy(page, "13090-1");
    await page.getByRole("tab", { name: "Files" }).click();
    await page.getByLabel("Add file").setInputFiles({
      name: "too-big.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(9 * 1024 * 1024, 1),
    });
    await expect(page.getByRole("alert").filter({ hasText: "larger than 8 MB" })).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "too-big.png" })).toHaveCount(0);
    await expectClean(page);
  });
});

test.describe("a viewer reads the die room and changes nothing", () => {
  for (const width of WIDTHS) {
    test(`${width}: no action buttons on the board, section, card, tier tab or issues`, async ({ page }) => {
      await open(page, "/dies", { role: "viewer", width });
      await expect(page.getByRole("link", { name: "New die" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "13090" }).first()).toBeVisible();
      await openTee(page);
      for (const name of ["Add copy", "Add band", "Edit die"]) {
        await expect(page.getByRole("button", { name }).or(page.getByRole("link", { name }))).toHaveCount(0);
      }
      await expect(page.getByTestId("copy-13090-1")).toBeVisible();
      await openCopy(page, "13090-1");
      await expect(page.getByTestId("current-weight")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add reading" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Tier" }).click();
      await expect(page.getByRole("button", { name: "Change tier" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Maker" }).click();
      await expect(page.getByRole("button", { name: "Send to maker" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Nitriding" }).click();
      await expect(page.getByRole("button", { name: "Send to nitriding" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Files" }).click();
      await expect(page.getByLabel("Add file")).toHaveCount(0);

      await page.goto("/dies/issues");
      await expect(page.locator("main#main h1")).toHaveText("Issue and return");
      await expect(page.getByTestId("issue-form")).toContainText("Only the die room hands out dies.");
      await expect(page.getByRole("button", { name: /Take back|Cancel issue|^Issue$/ })).toHaveCount(0);
      await expectClean(page);
    });
  }
});

test.describe("Hindi on a phone", () => {
  const SCREENS: { name: string; path: string; heading: RegExp | string }[] = [
    { name: "board", path: "/dies", heading: /./ },
    { name: "issues", path: "/dies/issues", heading: /./ },
    { name: "makers", path: "/dies/makers", heading: /./ },
  ];
  for (const screen of SCREENS) {
    test(`375 hi: ${screen.name} reads, does not scroll sideways, and passes axe`, async ({ page }) => {
      await open(page, screen.path, { role: "dieroom", width: 375, locale: "hi" });
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      await expect(page.locator("main#main h1")).not.toHaveText("Dies");
      await expectClean(page);
    });
  }

  test("375 hi: section, card and its tabs", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 375, locale: "hi" });
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await openTee(page);
    await expectClean(page);
    await page.getByTestId("copy-13090-1").getByRole("link").first().click();
    await expect(page.getByTestId("current-weight")).toBeVisible();
    await expectClean(page);
    for (const tab of ["runs", "nitriding", "tier", "maker", "files"]) {
      await page.goto(`${page.url().split("?")[0]}?tab=${tab}`);
      await expect(page.getByRole("tab", { selected: true })).toBeVisible();
      await expectClean(page);
    }
  });
});

test.describe("screens are clean at every width", () => {
  for (const width of WIDTHS) {
    test(`${width}: issues, makers and the six tabs of a card`, async ({ page }) => {
      await open(page, "/dies/issues", { role: "dieroom", width });
      await expectClean(page);
      await page.goto("/dies/makers");
      await expect(page.locator("main#main h1")).toHaveText("Die makers");
      await expectClean(page);
      await page.goto("/dies");
      await openTee(page);
      await openCopy(page, "13090-1");
      for (const tab of ["Readings", "Runs", "Nitriding", "Tier", "Maker", "Files"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expect(page.getByRole("tab", { name: tab, selected: true })).toBeVisible();
        await expectClean(page);
      }
    });
  }
});
