import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Die room (`/dies`, `/dies/$id`, `/dies/copies/$copyId`, `/lift`, `/dies/issues`, `/dies/makers`,
 * `/dies/$id/bands/new`) against the seeded plant: Tee 13090 with three copies (green, amber, red),
 * Channel 12230 owned by KD Extrusion, Patti 14701 with its copy out on P1. Every figure on screen
 * (percent, tone, band position, kg/m) comes from the server; these tests add readings and check
 * what the server answers.
 *
 * Mutations are spread over the three widths so a rerun on one seeded plant never meets its own
 * leftovers: reading values differ per width and so do the copies that get a tier proposal.
 */

const WIDTHS = [375, 820, 1280] as const;
type Width = (typeof WIDTHS)[number];

/** Per width: the Tee copy that gets a tier proposal, and the reading added to 13090-1 (kg/12ft -> percent). */
const PLAN: Record<Width, { tierCopy: string; reading: string; pct: string }> = {
  375: { tierCopy: "13090-1", reading: "2.790", pct: "+3.3%" },
  820: { tierCopy: "13090-2", reading: "2.795", pct: "+3.5%" },
  1280: { tierCopy: "13090-3", reading: "2.800", pct: "+3.7%" },
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

/** DR_SHOTS=<dir> keeps a full-page capture of every screen the checks visit. */
async function shot(page: Page) {
  const dir = process.env.DR_SHOTS;
  if (!dir) return;
  const name = `${page.viewportSize()?.width ?? 0}${await page.locator("html").getAttribute("lang") === "hi" ? "-hi" : ""}__${new URL(page.url()).pathname.replace(/\W+/g, "_")}${new URL(page.url()).search.replace(/\W+/g, "_")}`;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function expectClean(page: Page) {
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

async function pickOption(page: Page, trigger: string | RegExp, option: string | RegExp) {
  await page.getByRole("combobox", { name: trigger }).click();
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
      await expect(page.getByTestId("copy-13090-2")).toContainText("Near the edge");
      await expect(page.getByTestId("copy-13090-2")).toContainText("Above band");
      await expect(heavy).toContainText("13090-3");
      await expect(heavy.getByText("Over band").first()).toBeVisible();
      await expectClean(page);
    });

    test("the die room adds a reading and the server answers with the percent and tone", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await openTee(page);
      await openCopy(page, "13090-1");
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
    // 13090-2 reads above its band: the lift page says by how many grams.
    await openCopy(page, "13090-2");
    await page.getByRole("tab", { name: "Tier" }).click();
    await page.getByRole("link", { name: "Move to band" }).click();
    await expect(page.getByTestId("off-band")).toContainText("above by 50 g");
    const action = page.getByRole("button", { name: "Ask for approval" });
    // Tier 13090-2 may already carry a proposal from the tier test; then the form is replaced by the waiting note.
    if (await action.isVisible()) {
      const bar = await page.locator("[data-slot='form-actions']").boundingBox();
      const tabs = await page.locator("[data-slot='tab-bar']").boundingBox();
      expect(bar && tabs && bar.y + bar.height <= tabs.y + 1, `bar ${JSON.stringify(bar)} tabs ${JSON.stringify(tabs)}`).toBe(true);
    } else {
      await expect(page.getByTestId("lift-pending")).toBeVisible();
    }
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
      await panel.getByRole("combobox", { name: "Copy" }).click();
      await page.getByRole("option", { name: "12230-1" }).click();
      await panel.getByRole("combobox", { name: "For customer" }).click();
      await page.getByRole("option", { name: "Royal Aluminium" }).click();
      await panel.getByRole("radio", { name: "Pack" }).click();

      const result = page.getByTestId("owner-result");
      await expect(result).toContainText("This die belongs to KD Extrusion");
      // The die room cannot ask for the exception; roles that pack or plan can.
      await expect(result.getByRole("button")).toHaveCount(0);

      // The owner themselves is allowed.
      await panel.getByRole("combobox", { name: "For customer" }).click();
      await page.getByRole("option", { name: "KD Extrusion" }).click();
      await expect(result).toContainText("Allowed. This die belongs to KD Extrusion.");
      await expectClean(page);
    });
  }

  test("375: a role that packs asks for an exception and it waits for a manager", async ({ page }) => {
    await open(page, "/dies/issues", { role: "owner", width: 375 });
    const panel = page.getByTestId("owner-check");
    await panel.getByRole("combobox", { name: "Copy" }).click();
    await page.getByRole("option", { name: "12230-1" }).click();
    await panel.getByRole("combobox", { name: "For customer" }).click();
    await page.getByRole("option", { name: "Royal Aluminium" }).click();
    await panel.getByLabel("Why is it needed").fill("KD asked us to cover the Royal order");
    await panel.getByRole("button", { name: /Ask to use it for Royal Aluminium/ }).click();
    await expect(page.getByTestId("owner-waiting")).toContainText("Waiting for a manager");
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
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
