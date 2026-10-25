import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Platform (Wave 1, FP-PF): the Settings tabs (company letterhead, shifts, standards, modules,
 * team, devices, backup, help, about), Today's production-day caption and four KPIs, the audit
 * viewer, Godseye's app builds / backups / support pages, and forgot password. Each screen at
 * the three layouts (phone 375, iPad 820, laptop 1280): inside the screen, axe clean, and the
 * actions hidden from roles that do not hold them. Needs the local stack and the seeded accounts.
 * Procedures whose answer would write to the shared seed are answered in the browser instead.
 * Set PF_SHOTS=<dir> to save a screenshot of each screen.
 */

const WIDTHS = [375, 820, 1280] as const;

const procedureOf = (url: string) => decodeURIComponent(new URL(url).pathname.split("/trpc/")[1] ?? "").split(",");

async function open(page: Page, path: string, opts: { role?: LocalRole; width: number; height?: number; locale?: "hi" | "gu" }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (opts.locale) {
    await page.addInitScript((locale) => {
      try {
        localStorage.setItem("orrn.locale", locale);
      } catch {
        /* storage blocked */
      }
    }, opts.locale);
  }
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main#main h1")).toBeVisible();
}

/** A public page: no session, no shell. */
async function openPublic(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
}

/** Rewrites one procedure's result in every (batched) tRPC response. */
async function rewrite<T>(page: Page, procedure: string, edit: (data: T) => void) {
  await page.route("**/trpc/**", async (route) => {
    const index = procedureOf(route.request().url()).indexOf(procedure);
    if (index === -1) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    if (data) edit((data.json ?? data) as T);
    await route.fulfill({ response, json: body });
  });
}

/** Answers one mutation without calling the server; records what was sent. */
async function answer(page: Page, procedure: string, result: unknown | { error: { code: string; message: string; status: number } }) {
  const sent: string[] = [];
  await page.route(`**/trpc/${procedure}**`, async (route) => {
    sent.push(route.request().postData() ?? "");
    const batched = new URL(route.request().url()).searchParams.has("batch");
    const failure = (result as { error?: { code: string; message: string; status: number } }).error;
    const body = failure
      ? { error: { message: failure.message, code: -32600, data: { code: failure.code, httpStatus: failure.status } } }
      : { result: { data: result } };
    await route.fulfill({ status: failure?.status ?? 200, json: batched ? [body] : body });
  });
  return sent;
}

/** The input of one recorded mutation call (batched `{"0": input}`, or `{json: input}`, or the bare input). */
function inputOf(body: string): Record<string, any> {
  const payload = JSON.parse(body);
  const first = Array.isArray(payload) ? payload[0] : (payload["0"] ?? payload);
  return first && typeof first === "object" && "json" in first ? first.json : first;
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

async function expectContained(page: Page) {
  // Lists dim while they load; axe must see them settled.
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

async function shot(page: Page, name: string, width: number) {
  const dir = process.env.PF_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${width}.png`), fullPage: true });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const SETTINGS_TABS = ["Company", "Shifts", "Standards", "Modules", "Team", "Devices", "Backup", "Help", "About", "Printing", "Data"];

test.describe("settings tabs", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: every tab is there and Company carries the letterhead form`, async ({ page }) => {
      await open(page, "/settings", { width });
      const tabs = page.getByRole("tablist", { name: "Settings" });
      for (const name of SETTINGS_TABS) await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
      const letterhead = page.getByTestId("settings-letterhead");
      await expect(letterhead.getByLabel("Legal name")).toBeVisible();
      await expect(letterhead.getByLabel("GSTIN")).toBeVisible();
      await expect(letterhead.getByLabel("Address")).toBeVisible();
      await expect(letterhead.getByLabel("Phone")).toBeVisible();
      await expect(page.getByTestId("letterhead-save")).toBeDisabled();
      await shot(page, "settings-company", width);
      await expectContained(page);
    });

    test(`owner ${width}: the letterhead refuses a short GSTIN and sends the trimmed fields otherwise`, async ({ page }) => {
      const sent = await answer(page, "company.updateSettings", { settings: {} });
      await open(page, "/settings", { width });
      const form = page.getByTestId("settings-letterhead");
      await form.getByTestId("letterhead-legal-name").fill("  Fourcubes Extrusions Pvt Ltd ");
      await form.getByTestId("letterhead-gstin").fill("24abcde1234f1z");
      await form.getByTestId("letterhead-save").click();
      await expect(form.getByText("GSTIN is 15 letters and digits.")).toBeVisible();
      expect(sent).toHaveLength(0);
      await form.getByTestId("letterhead-gstin").fill("24abcde1234f1z5");
      await form.getByTestId("letterhead-address").fill("Plot 14, GIDC, Surat");
      await form.getByTestId("letterhead-save").click();
      await expect.poll(() => sent.length).toBe(1);
      const input = inputOf(sent[0]!);
      expect(input.letterhead).toEqual({ legalName: "Fourcubes Extrusions Pvt Ltd", gstin: "24ABCDE1234F1Z5", address: "Plot 14, GIDC, Surat", phone: null });
    });

    test(`viewer ${width}: Company letterhead is read only, and the owner-only tabs are not offered`, async ({ page }) => {
      await open(page, "/settings", { role: "viewer", width });
      await expect(page.getByTestId("letterhead-save")).toHaveCount(0);
      const tabs = page.getByRole("tablist", { name: "Settings" });
      await expect(tabs.getByRole("tab", { name: "Shifts" })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: "Devices" })).toHaveCount(0);
      await expect(tabs.getByRole("tab", { name: "Backup" })).toHaveCount(0);
      await expectContained(page);
    });
  }
});

test.describe("shifts", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: shifts show as editable rows; an overlap is refused with the server's words`, async ({ page }) => {
      await open(page, "/settings?tab=shifts", { width });
      const shifts = page.getByTestId("settings-shifts");
      await expect(shifts.getByTestId("shift-row")).toHaveCount(2);
      await expect(shifts.getByTestId("shift-name-0")).toHaveValue("Day");
      await expect(shifts.getByTestId("shift-start-0")).toHaveValue("08:00");
      await expect(shifts.getByTestId("shifts-save")).toBeDisabled();
      await expect(shifts.getByText("A change applies from the next read.")).toBeVisible();
      await shot(page, "settings-shifts", width);
      await expectContained(page);

      // Night to 09:00 overlaps Day (08:00-20:00) by an hour: advice shows live, the server refuses the save.
      await shifts.getByTestId("shift-end-1").fill("09:00");
      await expect(shifts.getByTestId("shifts-hint")).toContainText("no gap or overlap");
      await shifts.getByTestId("shifts-save").click();
      const refused = shifts.getByTestId("shifts-refused");
      await expect(refused).toBeVisible();
      await expect(refused).toContainText("Not saved");
      await expect(refused).toContainText(/overlap|uncovered/);
      await expectContained(page);
      // Undo puts the stored shifts back.
      await shifts.getByRole("button", { name: "Undo changes" }).click();
      await expect(shifts.getByTestId("shift-end-1")).toHaveValue("08:00");
      await expect(shifts.getByTestId("shifts-refused")).toHaveCount(0);
    });
  }

  test("viewer: shifts are cards with no form and no Save", async ({ page }) => {
    await open(page, "/settings?tab=shifts", { role: "viewer", width: 820 });
    const shifts = page.getByTestId("settings-shifts");
    await expect(shifts.getByTestId("shift-card")).toHaveCount(2);
    await expect(shifts.getByTestId("shifts-save")).toHaveCount(0);
    await expect(shifts.getByTestId("shifts-read-only")).toBeVisible();
    await expectContained(page);
  });

  test("a fifth shift cannot be added: the add button leaves at four", async ({ page }) => {
    await open(page, "/settings?tab=shifts", { width: 1280 });
    const shifts = page.getByTestId("settings-shifts");
    await shifts.getByRole("button", { name: "Add shift" }).click();
    await shifts.getByRole("button", { name: "Add shift" }).click();
    await expect(shifts.getByTestId("shift-row")).toHaveCount(4);
    await expect(shifts.getByRole("button", { name: "Add shift" })).toHaveCount(0);
    // Four rows with two new blanks cannot be saved as is: the advice says why.
    await expect(shifts.getByTestId("shifts-hint")).toBeVisible();
  });
});

test.describe("standards", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: one pair per profile kind; semi hollow says it uses the solid pair`, async ({ page }) => {
      await open(page, "/settings?tab=standards", { width });
      const standards = page.getByTestId("settings-standards");
      for (const kind of ["solid", "hollow", "semi"]) await expect(standards.getByTestId(`standard-${kind}`)).toBeVisible();
      await expect(standards.getByTestId("standard-solid-designation")).toHaveValue(/\S/);
      await expect(standards.getByTestId("standard-semi").getByText(/solid designation/)).toBeVisible();
      await expect(standards.getByTestId("standards-save")).toBeDisabled();
      await shot(page, "settings-standards", width);
      await expectContained(page);
    });
  }

  test("editing a pair enables Save, and the save carries only the kind that changed", async ({ page }) => {
    const sent = await answer(page, "company.updateSettings", { settings: {} });
    await open(page, "/settings?tab=standards", { width: 1280 });
    const standards = page.getByTestId("settings-standards");
    await standards.getByTestId("standard-hollow-cml").fill(" CM/L 7700123456 ");
    await standards.getByTestId("standards-save").click();
    await expect.poll(() => sent.length).toBe(1);
    const input = inputOf(sent[0]!);
    expect(Object.keys(input.standards)).toEqual(["hollow"]);
    expect(input.standards.hollow.cml).toBe("CM/L 7700123456");
  });

  test("375: opening on a tab far along the strip scrolls it into view", async ({ page }) => {
    await open(page, "/settings?tab=about", { width: 375 });
    const tab = page.getByRole("tablist", { name: "Settings" }).getByRole("tab", { name: "About", exact: true });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    // Inside the strip's visible box, not cut off at its edge.
    await expect
      .poll(async () => {
        const t = await tab.boundingBox();
        const strip = await page.getByRole("tablist", { name: "Settings" }).boundingBox();
        return !!t && !!strip && t.x >= strip.x - 1 && t.x + t.width <= strip.x + strip.width + 1;
      })
      .toBe(true);
  });

  test("viewer: the pairs are read as text", async ({ page }) => {
    await open(page, "/settings?tab=standards", { role: "viewer", width: 375 });
    const standards = page.getByTestId("settings-standards");
    await expect(standards.getByTestId("standards-read-only")).toBeVisible();
    await expect(standards.getByTestId("standard-solid-designation")).toHaveCount(0);
    await expect(standards.getByTestId("standards-save")).toHaveCount(0);
    await expectContained(page);
  });
});

test.describe("thresholds (Standards tab)", () => {
  for (const width of [375, 1280] as const) {
    test(`owner ${width}: drift, recovery and balance warning show their values; Save waits for a change`, async ({ page }) => {
      await open(page, "/settings?tab=standards", { width });
      const card = page.getByTestId("settings-thresholds");
      await expect(card.getByRole("heading", { name: "Thresholds" })).toBeVisible();
      await expect(card.getByTestId("threshold-driftGreen")).toHaveValue(/^\d/);
      await expect(card.getByTestId("threshold-driftAmber")).toHaveValue(/^\d/);
      await expect(card.getByTestId("threshold-balanceWarn")).toHaveValue(/^\d/);
      await expect(card.getByTestId("thresholds-save")).toBeDisabled();
      await shot(page, "settings-thresholds", width);
      await expectContained(page);
    });

    test(`owner ${width}: green at or above amber is refused in place, Save stays off`, async ({ page }) => {
      const sent = await answer(page, "company.updateSettings", { settings: {} });
      await open(page, "/settings?tab=standards", { width });
      const card = page.getByTestId("settings-thresholds");
      await card.getByTestId("threshold-driftGreen").fill("95");
      await card.getByTestId("threshold-driftAmber").fill("90");
      await expect(card.getByText("Green must be below amber.")).toBeVisible();
      await expect(card.getByTestId("thresholds-save")).toBeDisabled();
      await card.getByTestId("threshold-recoveryGreen").fill("80");
      await expect(card.getByText("Fill both recovery limits, or leave both blank.")).toBeVisible();
      await card.getByTestId("threshold-balanceWarn").fill("abc");
      await expect(card.getByText("Enter a number from 0 to 100, with up to two decimals.")).toBeVisible();
      await shot(page, "settings-thresholds-error", width);
      await expectContained(page);
      expect(sent).toHaveLength(0);
    });
  }

  test("a valid edit sends only what changed, in basis points", async ({ page }) => {
    const sent = await answer(page, "company.updateSettings", { settings: {} });
    await open(page, "/settings?tab=standards", { width: 1280 });
    const card = page.getByTestId("settings-thresholds");
    await card.getByTestId("threshold-driftGreen").fill("7");
    await card.getByTestId("threshold-driftAmber").fill("9,5");
    await card.getByTestId("threshold-recoveryGreen").fill("80");
    await card.getByTestId("threshold-recoveryAmber").fill("70");
    await card.getByTestId("threshold-balanceWarn").fill("3");
    await card.getByTestId("thresholds-save").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(inputOf(sent[0]!)).toEqual({
      driftGreenMaxBp: 700,
      driftAmberMaxBp: 950,
      recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 },
      pressBalanceWarnBp: 300,
    });
    await expect(page.getByText("Thresholds saved").first()).toBeVisible();
  });

  test("a refusal from the server shows its own words", async ({ page }) => {
    await answer(page, "company.updateSettings", {
      error: { code: "BAD_REQUEST", message: "The green drift limit must be below the amber limit", status: 400 },
    });
    await open(page, "/settings?tab=standards", { width: 375 });
    const card = page.getByTestId("settings-thresholds");
    await card.getByTestId("threshold-balanceWarn").fill("4");
    await card.getByTestId("thresholds-save").click();
    await expect(card.getByTestId("thresholds-refused")).toHaveText("The green drift limit must be below the amber limit");
  });

  test("under each group: who changed it last, when, and from what to what", async ({ page }) => {
    await rewrite<{ items: unknown[]; nextCursor: unknown }>(page, "audit.list", (r) => {
      r.items = [
        {
          id: "t1",
          at: "2026-10-24T08:30:00.000Z",
          action: "company.settings.update",
          subjectType: "company",
          subjectId: "c1",
          actorId: "u1",
          actorName: "Asha Patel",
          byStaff: false,
          meta: {
            changed: { driftGreenMaxBp: 700, driftAmberMaxBp: 900, press: { balanceWarnBp: 300 } },
            previous: { driftGreenMaxBp: null, driftAmberMaxBp: null, press: null },
          },
        },
      ];
      r.nextCursor = null;
    });
    await open(page, "/settings?tab=standards", { width: 375 });
    await expect(page.getByTestId("audit-driftGreenMaxBp")).toContainText("Last change: Asha Patel");
    await expect(page.getByTestId("audit-driftGreenMaxBp")).toContainText("From 8 % to 7 %");
    await expect(page.getByTestId("audit-driftAmberMaxBp")).toContainText("From 10 % to 9 %");
    await expect(page.getByTestId("audit-press")).toContainText("From 2 % to 3 %");
    await expect(page.getByTestId("audit-recoveryBands")).toHaveText("No change recorded yet.");
    await shot(page, "settings-thresholds-audit", 375);
    await expectContained(page);
  });

  test("viewer: the values are read as text, no fields and no Save", async ({ page }) => {
    await open(page, "/settings?tab=standards", { role: "viewer", width: 375 });
    const card = page.getByTestId("settings-thresholds");
    await expect(card.getByTestId("thresholds-read-only")).toBeVisible();
    await expect(card.getByTestId("threshold-driftGreen")).toHaveCount(0);
    await expect(card.getByTestId("thresholds-save")).toHaveCount(0);
    await expect(card.getByText("Green up to (%)")).toBeVisible();
    await expectContained(page);
  });
});

test.describe("modules", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: bought modules are read only chips; the switches can be pressed`, async ({ page }) => {
      await open(page, "/settings?tab=modules", { width });
      const modules = page.getByTestId("settings-modules");
      await expect(modules.getByTestId("bought-modules").locator("li")).toHaveCount(10);
      await expect(modules.getByRole("switch")).toHaveCount(4);
      await expect(modules.getByRole("switch", { name: "Die bands" })).toHaveAttribute("aria-checked", /true|false/);
      await shot(page, "settings-modules", width);
      await expectContained(page);
    });

    test(`viewer ${width}: the switch row is hidden, the values are read as text`, async ({ page }) => {
      await open(page, "/settings?tab=modules", { role: "viewer", width });
      const modules = page.getByTestId("settings-modules");
      await expect(modules.getByRole("switch")).toHaveCount(0);
      await expect(modules.getByTestId("modules-read-only")).toBeVisible();
      await expect(modules.getByTestId("bought-modules")).toBeVisible();
      await expectContained(page);
    });
  }

  test("pressing a switch saves it at once with no Save step, and says so in a toast", async ({ page }) => {
    // The save is answered in the browser: the shared seed's switches stay where they were.
    const sent = await answer(page, "company.updateSettings", { settings: {} });
    await open(page, "/settings?tab=modules", { width: 1280 });
    const dieBands = page.getByTestId("switch-dieBands");
    await expect(dieBands).toHaveAttribute("aria-checked", /true|false/);
    const before = (await dieBands.getAttribute("aria-checked")) === "true";
    await expect(page.getByTestId("settings-modules").getByRole("button", { name: /^save/i })).toHaveCount(0);
    await dieBands.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(inputOf(sent[0]!)).toEqual({ dieBands: !before });
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  });

  test("under each switch: who flipped it last, when, and from what to what; a switch never flipped says so", async ({ page }) => {
    await rewrite<{ items: unknown[]; nextCursor: unknown }>(page, "audit.list", (r) => {
      r.items = [
        {
          id: "s2",
          at: "2026-10-24T08:30:00.000Z",
          action: "company.settings.update",
          subjectType: "company",
          subjectId: "c1",
          actorId: "u1",
          actorName: "Asha Patel",
          byStaff: false,
          meta: { changed: { portalEnabled: true }, previous: { portalEnabled: false } },
        },
        {
          id: "s1",
          at: "2026-10-20T08:30:00.000Z",
          action: "company.settings.update",
          subjectType: "company",
          subjectId: "c1",
          actorId: "u2",
          actorName: "Ravi",
          byStaff: false,
          meta: { changed: { requireCastOnBundle: true }, previous: { requireCastOnBundle: null } },
        },
      ];
      r.nextCursor = null;
    });
    await open(page, "/settings?tab=modules", { width: 375 });
    await expect(page.getByTestId("audit-portalEnabled")).toContainText("Last change: Asha Patel");
    await expect(page.getByTestId("audit-portalEnabled")).toContainText("From Off to On");
    await expect(page.getByTestId("audit-requireCastOnBundle")).toContainText("Ravi");
    await expect(page.getByTestId("audit-requireCastOnBundle")).toContainText("From Automatic to On");
    await expect(page.getByTestId("audit-dieBands")).toHaveText("No change recorded yet.");
    await shot(page, "settings-modules-audit", 375);
    await expectContained(page);
  });

  test("a role that may not read the audit log still sees the switches, without the audit lines", async ({ page }) => {
    await open(page, "/settings?tab=modules", { role: "viewer", width: 820 });
    await expect(page.getByTestId("settings-modules")).toBeVisible();
    await expect(page.getByTestId("audit-dieBands")).toHaveCount(0);
  });
});

test.describe("team", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: other members have Change role and Remove, my own row has neither; portal logins say they are coming`, async ({ page }) => {
      await open(page, "/settings?tab=team", { width });
      const team = page.getByTestId("settings-team");
      await expect(team.getByText("owner@orrn.local")).toBeVisible();
      const change = team.getByTestId("member-change-role");
      await expect.poll(() => change.count()).toBeGreaterThan(0);
      // One row is mine ("You"), and it has no actions.
      const members = await team.getByRole("row").count();
      const rows = members > 0 ? members - 1 : await team.locator("li").count();
      expect(await change.count()).toBeLessThan(rows);
      await expect(team.getByTestId("team-portal")).toContainText("party portal opens");
      await shot(page, "settings-team", width);
      await expectContained(page);
    });
  }

  test("the role sheet starts on the member's role and Save waits for a different one; Remove asks first", async ({ page }) => {
    await open(page, "/settings?tab=team", { width: 1280 });
    const team = page.getByTestId("settings-team");
    await team.getByTestId("member-change-role").first().click();
    const sheet = page.getByRole("dialog", { name: /Change role for/ });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("member-save-role")).toBeDisabled();
    const current = await sheet.getByTestId("member-role").inputValue();
    const other = current === "viewer" ? "packer" : "viewer";
    await sheet.getByTestId("member-role").selectOption(other);
    await expect(sheet.getByTestId("member-save-role")).toBeEnabled();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);

    await team.getByTestId("member-remove").first().click();
    const dialog = page.getByRole("dialog", { name: /^Remove /});
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("They lose access to this company straight away.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("an owner's row is locked to everyone but an owner (an admin sees the lock, not the buttons)", async ({ page }) => {
    // Seen as an admin who is not any row in the list, so the owner row is somebody else's.
    await rewrite<{ company: { role: string } | null; user: { id: string } }>(page, "auth.me", (me) => {
      if (me.company) me.company.role = "admin";
      me.user.id = "someone-else";
    });
    await open(page, "/settings?tab=team", { width: 1280 });
    const team = page.getByTestId("settings-team");
    await expect(team.getByText("Only an owner can change another owner.").first()).toBeVisible();
    const ownerRow = team.getByRole("row").filter({ hasText: "owner@orrn.local" });
    await expect(ownerRow.getByTestId("member-change-role")).toHaveCount(0);
    await expect(ownerRow.getByTestId("member-remove")).toHaveCount(0);
  });

  test("viewer: no Change role, no Remove, no Invite", async ({ page }) => {
    await open(page, "/settings?tab=team", { role: "viewer", width: 375 });
    const team = page.getByTestId("settings-team");
    await expect(team.getByText("owner@orrn.local")).toBeVisible();
    await expect(team.getByTestId("member-change-role")).toHaveCount(0);
    await expect(team.getByTestId("member-remove")).toHaveCount(0);
    await expect(team.getByTestId("invite-open")).toHaveCount(0);
    await expectContained(page);
  });
});

test.describe("devices", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: published builds with their minimum, then the devices with a gate chip each`, async ({ page }) => {
      await open(page, "/settings?tab=devices", { width });
      const devices = page.getByTestId("settings-devices");
      await expect(devices.getByRole("heading", { name: "App builds" })).toBeVisible();
      await expect(devices.getByText("in.orrn.app", { exact: false }).first()).toBeVisible();
      await expect(devices.getByTestId("gate-row").first()).toContainText("Minimum build");
      const cards = devices.getByTestId("device-card");
      await expect(cards.first()).toBeVisible();
      await expect(cards.first().getByText(/Current|Below minimum build|Signed out|Web|Build not reported/).first()).toBeVisible();
      await expect(cards.first().getByRole("button", { name: "Rename" })).toBeVisible();
      await shot(page, "settings-devices", width);
      await expectContained(page);
    });
  }

  test("a device's gate status is the server's: below the minimum is flagged, no build is Build not reported; Sign out asks first", async ({ page }) => {
    // The page shows `gate` as the server sent it; it works nothing out from the app version.
    await rewrite<{ appVersion: string | null; platform: string; revokedAt: string | null; gate: string }[]>(page, "device.list", (rows) => {
      if (rows[0]) {
        rows[0].platform = "android";
        rows[0].appVersion = "0.1 (1)";
        rows[0].revokedAt = null;
        rows[0].gate = "blocked";
      }
      if (rows[1]) {
        rows[1].appVersion = null;
        rows[1].revokedAt = null;
        rows[1].platform = "ios";
        rows[1].gate = "unknown";
      }
    });
    await open(page, "/settings?tab=devices", { width: 820 });
    const card = page.getByTestId("device-card").first();
    await expect(card).toHaveAttribute("data-gate", "blocked");
    await expect(card).toContainText("Below minimum build");
    if ((await page.getByTestId("device-card").count()) > 1) {
      await expect(page.getByTestId("device-card").nth(1)).toHaveAttribute("data-gate", "unknown");
      await expect(page.getByTestId("device-card").nth(1)).toContainText("Build not reported");
    }
    await card.getByRole("button", { name: "Sign out this device" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign out this device?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("a build that looks old but the server calls current stays Current (the page does not decide)", async ({ page }) => {
    await rewrite<{ appVersion: string | null; platform: string; revokedAt: string | null; gate: string }[]>(page, "device.list", (rows) => {
      if (rows[0]) {
        rows[0].platform = "android";
        rows[0].appVersion = "0.1 (1)";
        rows[0].revokedAt = null;
        rows[0].gate = "current";
      }
    });
    await rewrite<{ minBuild: number }>(page, "release.check", (gate) => {
      gate.minBuild = 500;
    });
    await open(page, "/settings?tab=devices", { width: 820 });
    await expect(page.getByTestId("device-card").first()).toHaveAttribute("data-gate", "current");
  });

  test("rename sends the trimmed name", async ({ page }) => {
    const sent = await answer(page, "device.rename", { success: true, changed: true });
    await open(page, "/settings?tab=devices", { width: 1280 });
    await page.getByTestId("device-card").first().getByRole("button", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Name this device" });
    await dialog.getByTestId("device-label").fill("  Packing bay tablet ");
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain("Packing bay tablet");
  });

  test("a role without users.manage has no Devices tab", async ({ page }) => {
    await open(page, "/settings?tab=devices", { role: "operator", width: 375 });
    // The tab is not offered, so the URL falls back to the first section.
    await expect(page.getByTestId("settings-devices")).toHaveCount(0);
  });
});

test.describe("backup, help and about", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: last backup, restore drill in plain words; no run buttons for the plant`, async ({ page }) => {
      await open(page, "/settings?tab=backup", { width });
      const backup = page.getByTestId("settings-backup");
      await expect(backup.getByRole("heading", { name: "Restore drill" })).toBeVisible();
      await expect(backup.getByText("Ask orrn support to run the restore drill. It is done every quarter.")).toBeVisible();
      // No repo path or file name on a plant screen.
      await expect(backup).not.toContainText(/docs\/|\.md\b/);
      await expect(backup.getByTestId("backup-last")).toBeVisible();
      await expect(backup.getByTestId("backup-staff")).toHaveCount(0);
      await shot(page, "settings-backup", width);
      await expectContained(page);
    });

    test(`owner ${width}: Help has the request form and your requests`, async ({ page }) => {
      await open(page, "/settings?tab=support", { width });
      const support = page.getByTestId("settings-support");
      await expect(support.getByRole("heading", { name: "Ask for help" })).toBeVisible();
      await expect(support.getByRole("heading", { name: "Your requests" })).toBeVisible();
      await shot(page, "settings-support", width);
      await expectContained(page);
    });

    test(`owner ${width}: About shows the app, the plant, you, and where to get help`, async ({ page }) => {
      await open(page, "/settings?tab=about", { width });
      const about = page.getByTestId("settings-about");
      await expect(about.getByText("Web app version")).toBeVisible();
      await expect(about.getByText("owner@orrn.local")).toBeVisible();
      await expect(about.getByRole("link", { name: "Open Help" })).toBeVisible();
      await shot(page, "settings-about", width);
      await expectContained(page);
    });
  }

  test("backup status: the last good backup, a newer failed try, and the drill", async ({ page }) => {
    await rewrite<Record<string, unknown>>(page, "backup.status", (s) => {
      s.lastOk = { id: "b1", status: "ok", bytes: 5_242_880, startedAt: "2026-10-23T21:30:00.000Z", finishedAt: "2026-10-23T21:31:00.000Z" };
      s.lastAttempt = { id: "b2", status: "failed", bytes: null, startedAt: "2026-10-24T21:30:00.000Z", finishedAt: "2026-10-24T21:30:20.000Z" };
      s.lastDrill = { id: "d1", status: "ok", bytes: null, startedAt: "2026-10-01T05:00:00.000Z", finishedAt: "2026-10-01T05:02:00.000Z" };
    });
    await open(page, "/settings?tab=backup", { width: 820 });
    const backup = page.getByTestId("settings-backup");
    await expect(backup.getByTestId("backup-last")).toContainText("5.0 megabytes");
    await expect(backup.getByTestId("backup-attempt")).toContainText("Failed");
    await expect(backup.getByTestId("backup-drill")).toContainText("Done");
    await expectContained(page);
  });

  test("a staff session sees Back up now and Run restore drill on the plant's Backup tab", async ({ page }) => {
    await rewrite<{ isPlatformAdmin: boolean; platformRole: string | null }>(page, "auth.me", (me) => {
      me.isPlatformAdmin = true;
      me.platformRole = "admin";
    });
    await open(page, "/settings?tab=backup", { width: 1280 });
    const staff = page.getByTestId("backup-staff");
    await expect(staff.getByRole("button", { name: "Back up now" })).toBeVisible();
    await expect(staff.getByRole("button", { name: "Run restore drill" })).toBeVisible();
  });

  test("Help: an empty request is refused in place; a real one sends the body and the screen", async ({ page }) => {
    const sent = await answer(page, "support.request", { id: "r1", status: "open" });
    await open(page, "/settings?tab=support", { width: 375 });
    const support = page.getByTestId("settings-support");
    await support.getByTestId("support-send").click();
    await expect(support.getByText("Write a few words about what happened.")).toBeVisible();
    expect(sent).toHaveLength(0);
    await support.getByTestId("support-body").fill("The label did not print");
    await support.getByTestId("support-send").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain("The label did not print");
    expect(sent[0]).toContain("/settings");
  });

  test("Help lists my requests with their status and the reply", async ({ page }) => {
    await rewrite<unknown[]>(page, "support.mine", (rows) => {
      rows.splice(0, rows.length, {
        id: "r9",
        subject: "Label reprint",
        body: "Reprint gives a blank label",
        screen: "/printing",
        status: "answered",
        reply: "Check the label design in Printing",
        repliedAt: "2026-10-24T05:00:00.000Z",
        createdAt: "2026-10-23T05:00:00.000Z",
      });
    });
    await open(page, "/settings?tab=support", { width: 820 });
    const mine = page.getByTestId("support-mine");
    await expect(mine).toContainText("Label reprint");
    await expect(mine).toContainText("Answered");
    await expect(mine).toContainText("Check the label design in Printing");
    await expectContained(page);
  });

  test("About: the owner edits the support contact (name, phone, hours); only the changed fields are sent", async ({ page }) => {
    const sent = await answer(page, "company.updateSettings", { settings: {} });
    await open(page, "/settings?tab=about", { width: 375 });
    const editor = page.getByTestId("support-editor");
    await expect(editor.getByLabel("Contact name")).toBeVisible();
    await expect(editor.getByLabel("Phone")).toBeVisible();
    await expect(editor.getByLabel("Hours")).toBeVisible();
    await expect(page.getByTestId("support-save")).toBeDisabled();
    await editor.getByTestId("support-name").fill("  Lalu uncle ");
    await editor.getByTestId("support-hours").fill("Mon to Sat, 9 to 6");
    await page.getByTestId("support-save").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(inputOf(sent[0]!)).toEqual({ support: { name: "Lalu uncle", hours: "Mon to Sat, 9 to 6" } });
    await expect(page.getByText("Contact saved")).toBeVisible();
    await shot(page, "settings-about-support", 375);
    await expectContained(page);
  });

  test("About: a role without settings.update reads the contact and has no editor", async ({ page }) => {
    await open(page, "/settings?tab=about", { role: "viewer", width: 820 });
    await expect(page.getByTestId("settings-about")).toBeVisible();
    await expect(page.getByTestId("support-editor")).toHaveCount(0);
  });

  test("About shows the support contact from the settings when there is one", async ({ page }) => {
    await rewrite<{ company: { settings: Record<string, unknown> } | null }>(page, "auth.me", (me) => {
      if (me.company) me.company.settings = { ...me.company.settings, support: { name: "Asha", phone: "98250 11111", hours: "9 to 6" } };
    });
    await open(page, "/settings?tab=about", { width: 375 });
    const contact = page.getByTestId("support-contact");
    await expect(contact).toContainText("Asha");
    await expect(contact).toContainText("98250 11111");
    await expect(contact).toContainText("9 to 6");
  });
});

test.describe("Today", () => {
  const caption = /Production day \d{1,2} \w{3}, from \d{2}:\d{2}/;

  for (const width of WIDTHS) {
    test(`owner ${width}: caption, four KPIs and the role tiles`, async ({ page }) => {
      await open(page, "/today", { width });
      await expect(page.getByTestId("production-day-caption")).toHaveText(caption);
      const numbers = page.getByTestId("today-numbers");
      for (const id of ["kpi-packed", "kpi-bundles", "kpi-dispatched", "kpi-stock"]) await expect(numbers.getByTestId(id)).toBeVisible();
      await expect(numbers.getByTestId("kpi-packed")).toContainText("kg packed");
      await expect(numbers.getByTestId("kpi-bundles")).toContainText("Bundles");
      await expect(page.getByTestId("today-tiles").getByRole("link")).toHaveCount(9); // BACKLOG 35: the owner gets every station tile
      await shot(page, "today-owner", width);
      await expectContained(page);
    });

    test(`viewer ${width}: the caption and the four KPIs, nothing else`, async ({ page }) => {
      await open(page, "/today", { role: "viewer", width });
      await expect(page.getByTestId("production-day-caption")).toHaveText(caption);
      const numbers = page.getByTestId("today-numbers");
      for (const id of ["kpi-packed", "kpi-bundles", "kpi-dispatched", "kpi-stock"]) await expect(numbers.getByTestId(id)).toBeVisible();
      await expect(numbers.getByTestId("kpi-value")).toHaveCount(0);
      await expect(page.getByTestId("today-tiles")).toHaveCount(0);
      await expect(page.getByTestId("today-open-dispatches")).toHaveCount(0);
      await expect(page.getByTestId("today-sessions")).toHaveCount(0);
      await shot(page, "today-viewer", width);
      await expectContained(page);
    });
  }

  test("the KPI numbers are the server's: grams in, kg and counts out", async ({ page }) => {
    await rewrite<{ kpis: Record<string, number>; value: null }>(page, "dashboard.today", (d) => {
      d.kpis = { packedG: 1_234_500, packedBundles: 17, dispatchedG: 98_000, inStockG: 5_500_250, inStockBundles: 1_204 };
      d.value = null;
    });
    await open(page, "/today", { width: 1280 });
    const numbers = page.getByTestId("today-numbers");
    await expect(numbers.getByTestId("kpi-packed")).toContainText("1,234.5");
    await expect(numbers.getByTestId("kpi-bundles")).toContainText("17");
    await expect(numbers.getByTestId("kpi-dispatched")).toContainText("98.0");
    await expect(numbers.getByTestId("kpi-stock")).toContainText("5,500.3");
    await expect(numbers.getByTestId("kpi-stock")).toContainText("1,204 bundles now");
  });

  test("the rate slice shows only when the server sends it", async ({ page }) => {
    await rewrite<{ value: { dispatchedPaise: number; pricedBundles: number } | null }>(page, "dashboard.today", (d) => {
      d.value = { dispatchedPaise: 12_345_678, pricedBundles: 3 };
    });
    await open(page, "/today", { width: 820 });
    const value = page.getByTestId("today-numbers").getByTestId("kpi-value");
    await expect(value).toContainText("₹1,23,456.78");
    await expect(value).toContainText("3 bundles with a rate");
    await expectContained(page);
  });

  test("before shift 1 starts the caption names yesterday and says why", async ({ page }) => {
    await rewrite<{ productionDay: { day: string; startMs: number } }>(page, "dashboard.today", (d) => {
      // 07:30 IST on 24 Oct: the production day is 23 Oct, which started at 08:00 IST yesterday.
      d.productionDay.day = "2026-10-23";
      d.productionDay.startMs = Date.UTC(2026, 9, 23, 2, 30);
    });
    await page.clock.install({ time: new Date(Date.UTC(2026, 9, 24, 2, 0)) });
    await open(page, "/today", { width: 375 });
    await expect(page.getByTestId("production-day-caption")).toHaveText("Production day 23 Oct, from 08:00");
    await expect(page.getByTestId("production-day-note")).toContainText("Before 08:00 still counts for the day before.");
  });

  test("Hindi at 375: caption and KPI titles in Hindi, Latin digits, nothing cut off", async ({ page }) => {
    await open(page, "/today", { width: 375, locale: "hi" });
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByTestId("production-day-caption")).toContainText("प्रोडक्शन का दिन");
    await expect(page.getByTestId("production-day-caption")).toContainText(/\d{2}:\d{2}/);
    await expect(page.getByTestId("kpi-packed")).toContainText("पैक हुआ kg");
    await expect(page.getByTestId("kpi-stock")).toContainText("स्टॉक में");
    await shot(page, "today-hi", 375);
    await expectContained(page);
  });

  test("Gujarati at 375: caption and KPI titles in Gujarati, Latin digits, nothing cut off", async ({ page }) => {
    await open(page, "/today", { width: 375, locale: "gu" });
    await expect(page.locator("html")).toHaveAttribute("lang", "gu");
    await expect(page.getByTestId("production-day-caption")).toContainText("પ્રોડક્શન દિવસ");
    await expect(page.getByTestId("production-day-caption")).toContainText(/\d{2}:\d{2}/);
    await expect(page.getByTestId("kpi-packed")).toContainText("પૅક થયું kg");
    await expect(page.getByTestId("kpi-stock")).toContainText("સ્ટોકમાં");
    // The header date is in Gujarati too (it was English), and chips on the lists never show a raw key.
    await expect(page.locator("main#main")).toContainText(/[\u0A80-\u0AFF]+, \d{1,2} [\u0A80-\u0AFF]+/);
    await expect(page.locator("main#main")).not.toContainText(/Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/);
    // Words gu does not have yet come from English, never as a raw key.
    await expect(page.locator("main#main")).not.toContainText(/status\.\w+\.\w+/);
    await shot(page, "today-gu", 375);
    await expectContained(page);
  });
});

const AUDIT_ROWS = [
  {
    id: "a2",
    at: "2026-10-24T08:00:00.000Z",
    action: "company.settings.update",
    subjectType: "company",
    subjectId: "c1",
    actorId: "u1",
    actorName: "Owner",
    byStaff: false,
    meta: { changed: { dieBands: true }, previous: { dieBands: null } },
  },
  {
    id: "a1",
    at: "2026-10-23T08:00:00.000Z",
    action: "device.revoke",
    subjectType: "device",
    subjectId: "dev1",
    actorId: null,
    actorName: null,
    byStaff: true,
    meta: {},
  },
];

test.describe("audit viewer", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: entries with who, what and subject; details open; read only`, async ({ page }) => {
      await rewrite<{ items: unknown[]; nextCursor: unknown; from: number }>(page, "audit.list", (r) => {
        r.items = AUDIT_ROWS;
        r.nextCursor = null;
      });
      await open(page, "/audit", { width });
      await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
      const list = page.getByTestId("audit-list");
      await expect(list).toContainText("company.settings.update");
      await expect(list).toContainText("device.revoke");
      await expect(list).toContainText("orrn support");
      await expect(list.getByText("Details").first()).toBeVisible();
      // Details read as a label and a value, with old to new for a switch flip, never raw JSON.
      await list.getByText("Details").first().click();
      await expect(list.getByTestId("audit-meta").first()).toContainText("Die bands");
      await expect(list.getByTestId("audit-meta").first()).toContainText("none to Yes");
      await expect(list).not.toContainText('"changed"');
      // Nothing on the screen edits or removes an entry.
      await expect(page.getByRole("button", { name: /delete|remove|edit/i })).toHaveCount(0);
      await shot(page, "audit", width);
      await expectContained(page);
    });
  }

  test("the Kind list covers every group and a Dies filter asks for all the die prefixes at once", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (r) => {
      if (procedureOf(r.url()).includes("audit.list")) seen.push(decodeURIComponent(r.url()));
    });
    await open(page, "/audit", { width: 820 });
    const kind = page.getByTestId("audit-kind");
    for (const name of ["Press", "Foundry", "Buying and stores", "Approvals", "orrn support", "Dies"]) {
      await expect(kind.locator("option", { hasText: name })).toHaveCount(1);
    }
    await kind.selectOption("die");
    await expect.poll(() => seen.some((u) => ["die.", "die_instance.", "die_issue.", "die_band.", "die_owner.", "nitriding."].every((p) => u.includes(`"${p}"`)))).toBe(true);
  });

  test("filters reach the server: kind as a list of prefixes, dates as the plant's day bounds, subject and person as typed", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (r) => {
      if (procedureOf(r.url()).includes("audit.list")) seen.push(decodeURIComponent(r.url()));
    });
    await open(page, "/audit", { width: 1280 });
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.getByTestId("audit-kind").selectOption("dispatch");
    await expect.poll(() => seen.some((u) => u.includes('"actions":["dispatch.","packingList."]'))).toBe(true);
    await page.getByTestId("audit-from").fill("2026-10-24");
    // 24 Oct 00:00 in Kolkata is 23 Oct 18:30 UTC.
    await expect.poll(() => seen.some((u) => u.includes(`"from":${Date.UTC(2026, 9, 23, 18, 30)}`))).toBe(true);
    await page.getByTestId("audit-subject").fill("abc123");
    await page.getByTestId("audit-subject").press("Enter");
    await expect.poll(() => seen.some((u) => u.includes('"subjectId":"abc123"'))).toBe(true);
    await expect(page).toHaveURL(/kind=dispatch/);
    await expect(page).toHaveURL(/from=2026-10-24/);
    await page.getByTestId("audit-clear").click();
    await expect(page).not.toHaveURL(/kind=/);
    await expect(page.getByTestId("audit-kind")).toHaveValue("");
  });

  test("older entries load with the cursor the server gave", async ({ page }) => {
    const cursors: (string | null)[] = [];
    await page.route("**/trpc/**", async (route) => {
      const procedures = procedureOf(route.request().url());
      const index = procedures.indexOf("audit.list");
      if (index === -1) return route.fallback();
      const url = new URL(route.request().url());
      const input = JSON.parse(url.searchParams.get("input") ?? "{}");
      const call = (url.searchParams.has("batch") ? input[String(index)] : input) ?? {};
      const cursor = call.cursor ? "next" : null;
      cursors.push(cursor);
      const data = cursor
        ? { items: [AUDIT_ROWS[1]], nextCursor: null, from: Date.UTC(2026, 3, 1) }
        : { items: [AUDIT_ROWS[0]], nextCursor: { at: Date.UTC(2026, 9, 24, 8), id: "a2" }, from: Date.UTC(2026, 3, 1) };
      if (procedures.length === 1) return route.fulfill({ json: url.searchParams.has("batch") ? [{ result: { data } }] : { result: { data } } });
      const response = await route.fetch();
      const body = await response.json();
      body[index] = { result: { data } };
      await route.fulfill({ response, json: body });
    });
    await open(page, "/audit", { width: 820 });
    const list = page.getByTestId("audit-list");
    await expect(list).toContainText("company.settings.update");
    await expect(list).not.toContainText("device.revoke");
    await page.getByTestId("audit-more").click();
    await expect(list).toContainText("device.revoke");
    expect(cursors).toContain("next");
    await expect(page.getByTestId("audit-more")).toHaveCount(0);
  });

  test("a subject in a row filters by it", async ({ page }) => {
    await rewrite<{ items: unknown[]; nextCursor: unknown }>(page, "audit.list", (r) => {
      r.items = AUDIT_ROWS;
      r.nextCursor = null;
    });
    await open(page, "/audit", { width: 1280 });
    await page.getByRole("button", { name: /dev1/ }).click();
    await expect(page).toHaveURL(/subject=dev1/);
    await expect(page.getByTestId("audit-subject")).toHaveValue("dev1");
  });

  test("a role without audit.read has no Audit log in More and is told so on the page", async ({ page }) => {
    await open(page, "/audit", { role: "viewer", width: 1280 });
    await expect(page.getByText("Your role can't read the audit log.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toHaveCount(0);
  });

  test("the owner finds Audit log in the navigation", async ({ page }) => {
    await open(page, "/today", { width: 1280 });
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toBeVisible();
  });
});

test.describe("Godseye: app builds, backups, support, company", () => {
  for (const width of WIDTHS) {
    test(`staff ${width}: App builds lists builds and offers the publish form`, async ({ page }) => {
      await open(page, "/admin/releases", { role: "staff", width });
      await expect(page.getByRole("heading", { level: 1, name: "App builds" })).toBeVisible();
      const form = page.getByTestId("publish-form");
      for (const label of ["Version", "Build number", "Minimum build", "Release notes"]) await expect(form.getByLabel(label)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Published builds" })).toBeVisible();
      await shot(page, "admin-releases", width);
      await expectContained(page);
    });
  }

  test("staff publish an iPhone build: the form checks first, a blank minimum keeps the floor, and the build appears in the list", async ({ page }) => {
    // The publish is answered in the browser (and the list rewritten to show the build): the
    // shared seed never gets a build, so the iOS minimum stays at the seeded 1.
    const sent = await answer(page, "platform.release.publish", { id: "e2e-stub" });
    const version = "e2e-stub-1.9.0";
    await rewrite<Record<string, unknown>[]>(page, "platform.release.list", (rows) => {
      if (sent.length === 0) return;
      rows.unshift({
        id: "e2e-stub",
        platform: "ios",
        channel: "production",
        version,
        buildNumber: 900,
        minBuild: 1,
        mandatory: false,
        notes: "Platform e2e build",
        apkUrl: null,
        publishedAt: "2026-10-24T10:00:00.000Z",
      });
    });
    await open(page, "/admin/releases", { role: "staff", width: 1280 });
    const form = page.getByTestId("publish-form");
    await form.getByRole("radio", { name: "iPhone and iPad" }).click();
    // Empty form: every missing field is flagged, nothing is sent.
    await form.getByTestId("release-publish").click();
    await expect(form.getByText("Check the fields and try again.").first()).toBeVisible();
    expect(sent).toHaveLength(0);
    // The hint names the floor in force today (the seed's iOS production minimum is 1).
    await expect(form.getByText("Leave blank to keep the current minimum (1).", { exact: false })).toBeVisible();
    await form.getByTestId("release-version").fill(version);
    await form.getByTestId("release-build").fill("900");
    await form.getByTestId("release-notes").fill("Platform e2e build");
    await form.getByTestId("release-publish").click();
    await expect(page.getByText("Build published")).toBeVisible();
    await expect.poll(() => sent.length).toBe(1);
    // Blank minimum = the current floor (1), not the new build number.
    expect(inputOf(sent[0]!)).toMatchObject({ platform: "ios", channel: "production", version, buildNumber: 900, minBuild: 1, mandatory: false });
    await expect(page.getByTestId("admin-releases")).toContainText(version);
  });

  test("the builds table shows Mandatory and Notes; staff flip Mandatory with a switch (answered in the browser)", async ({ page }) => {
    const sent = await answer(page, "platform.release.setMandatory", { id: "r-stub", mandatory: true, changed: true });
    await rewrite<Record<string, unknown>[]>(page, "platform.release.list", (rows) => {
      rows.unshift({
        id: "r-stub",
        platform: "android",
        channel: "floor",
        version: "stub-2.0.0",
        buildNumber: 2000,
        minBuild: 1900,
        mandatory: false,
        notes: "Fixes the scale reading on the pack screen",
        apkUrl: null,
        publishedAt: "2026-10-24T10:00:00.000Z",
      });
    });
    await open(page, "/admin/releases", { role: "staff", width: 1280 });
    const list = page.getByTestId("admin-releases");
    await expect(list.getByRole("columnheader", { name: "Mandatory" })).toBeVisible();
    await expect(list.getByRole("columnheader", { name: "Notes" })).toBeVisible();
    const row = list.getByRole("row", { name: /stub-2\.0\.0/ });
    await expect(row).toContainText("Fixes the scale reading on the pack screen");
    const flip = row.getByTestId("release-mandatory-switch");
    await expect(flip).toHaveAttribute("aria-checked", "false");
    await flip.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(inputOf(sent[0]!)).toEqual({ id: "r-stub", mandatory: true });
    await expect(page.getByText("Marked mandatory")).toBeVisible();
  });

  test("support staff read Mandatory as a label, with no switch", async ({ page }) => {
    await rewrite<{ isPlatformAdmin: boolean; platformRole: string | null }>(page, "auth.me", (me) => {
      me.isPlatformAdmin = true;
      me.platformRole = "support";
    });
    await open(page, "/admin/releases", { role: "staff", width: 1280 });
    await expect(page.getByTestId("admin-releases")).toBeVisible();
    await expect(page.getByTestId("release-mandatory-switch")).toHaveCount(0);
    await expect(page.getByTestId("publish-form")).toHaveCount(0);
  });

  test("a minimum build above the build number is refused before it is sent", async ({ page }) => {
    await open(page, "/admin/releases", { role: "staff", width: 820 });
    const form = page.getByTestId("publish-form");
    await form.getByTestId("release-version").fill("1.0.0");
    await form.getByTestId("release-build").fill("5");
    await form.getByTestId("release-min-build").fill("9");
    await form.getByTestId("release-notes").fill("x");
    await form.getByTestId("release-publish").click();
    await expect(form.getByText("The minimum build can't be above the build number.")).toBeVisible();
  });

  test("the server's refusal of a publish is shown in the screen's words", async ({ page }) => {
    await answer(page, "platform.release.publish", { error: { code: "CONFLICT", message: "That version is already published on this channel", status: 409 } });
    await open(page, "/admin/releases", { role: "staff", width: 1280 });
    const form = page.getByTestId("publish-form");
    await form.getByTestId("release-version").fill("1.0.0");
    await form.getByTestId("release-build").fill("5");
    await form.getByTestId("release-notes").fill("x");
    await form.getByTestId("release-publish").click();
    await expect(form.getByTestId("release-refused")).toHaveText("That version is already published on this channel.");
  });

  test("a plant user cannot open the staff pages", async ({ page }) => {
    await open(page, "/admin/releases", { role: "owner", width: 1280 });
    // The guard sends a plant user home; the staff page never renders for them.
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByTestId("publish-form")).toHaveCount(0);
    await expect(page.getByTestId("admin-releases")).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`staff ${width}: Backups lists runs and the plant picker enables the buttons`, async ({ page }) => {
      await open(page, "/admin/backups", { role: "staff", width });
      await expect(page.getByRole("heading", { level: 1, name: "Backups" })).toBeVisible();
      await expect(page.getByTestId("backup-run")).toBeDisabled();
      await expect(page.getByTestId("backup-drill")).toBeDisabled();
      const options = page.getByTestId("backup-company").locator("option");
      await expect.poll(() => options.count()).toBeGreaterThan(1);
      await page.getByTestId("backup-company").selectOption({ index: 1 });
      await expect(page.getByTestId("backup-run")).toBeEnabled();
      await expect(page.getByTestId("backup-drill")).toBeEnabled();
      await shot(page, "admin-backups", width);
      await expectContained(page);
    });
  }

  test("Backups shows a drill whose counts match and one whose counts differ", async ({ page }) => {
    await rewrite<unknown[]>(page, "platform.backup.list", (rows) => {
      const base = { companyId: "dev-company-orrn", kind: "scheduled", bytes: null, rowCount: null, error: null, sourceRunId: null, scratchCompanyId: null, finishedAt: null };
      rows.splice(
        0,
        rows.length,
        { ...base, id: "r1", purpose: "drill", status: "ok", startedAt: "2026-10-02T05:00:00.000Z", detail: { expected: { bundle: 10 }, restored: { bundle: 10 } } },
        { ...base, id: "r2", purpose: "drill", status: "failed", startedAt: "2026-10-01T05:00:00.000Z", detail: { expected: { bundle: 10 }, restored: { bundle: 9 } } },
        { ...base, id: "r3", purpose: "export", status: "ok", bytes: 2_097_152, rowCount: 1500, startedAt: "2026-10-03T21:30:00.000Z", detail: null },
      );
    });
    await open(page, "/admin/backups", { role: "staff", width: 1280 });
    const page_ = page.getByTestId("admin-backups");
    await expect(page_).toContainText("Counts match");
    await expect(page_).toContainText("Counts differ");
    await expect(page_).toContainText("2.0 megabytes");
  });

  for (const width of WIDTHS) {
    test(`staff ${width}: Support lists the requests; one opens with the reply form`, async ({ page }) => {
      await open(page, "/admin/support", { role: "staff", width });
      await expect(page.getByRole("heading", { level: 1, name: "Support requests" })).toBeVisible();
      const opener = page.getByTestId("support-open").first();
      await expect(opener).toBeVisible();
      await shot(page, "admin-support", width);
      await expectContained(page);
      await opener.click();
      const detail = page.getByTestId("support-detail");
      await expect(detail).toBeVisible();
    });
  }

  test("a reply that loses the race shows the conflict message and reloads the request", async ({ page }) => {
    await rewrite<unknown[]>(page, "platform.support.list", (rows) => {
      rows.splice(0, rows.length, {
        id: "sr1",
        companyId: "dev-company-orrn",
        companyName: "Demo plant",
        subject: "Scale not reading",
        body: "The kanta shows nothing",
        screen: "/pack/new",
        status: "open",
        reply: null,
        repliedAt: null,
        createdBy: "u1",
        createdAt: "2026-10-23T05:00:00.000Z",
      });
    });
    const sent = await answer(page, "platform.support.reply", { error: { code: "CONFLICT", message: "Someone else answered or closed this request. Reload it.", status: 409 } });
    let listReads = 0;
    page.on("request", (r) => {
      if (procedureOf(r.url()).includes("platform.support.list")) listReads += 1;
    });
    await open(page, "/admin/support", { role: "staff", width: 1280 });
    await page.getByTestId("support-open").first().click();
    const detail = page.getByTestId("support-detail");
    await expect.poll(() => listReads).toBeGreaterThan(0);
    const readsBefore = listReads;
    await detail.getByTestId("support-reply").fill("Restart the scale reader");
    await detail.getByTestId("support-send").click();
    await expect.poll(() => sent.length).toBe(1);
    // The conflict reloads the request: the list is read again.
    await expect.poll(() => listReads).toBeGreaterThan(readsBefore);
    await expect(page.getByTestId("support-conflict")).toContainText("Someone else answered or closed this request.");
    // The reply box is still there for a request that is still open.
    await expect(detail.getByTestId("support-reply")).toBeVisible();
  });

  test("an answered request offers Close but no second reply", async ({ page }) => {
    await rewrite<unknown[]>(page, "platform.support.list", (rows) => {
      rows.splice(0, rows.length, {
        id: "sr2",
        companyId: "dev-company-orrn",
        companyName: "Demo plant",
        subject: "Printer offline",
        body: "No labels",
        screen: null,
        status: "answered",
        reply: "Check the cable",
        repliedAt: "2026-10-24T05:00:00.000Z",
        createdBy: "u1",
        createdAt: "2026-10-23T05:00:00.000Z",
      });
    });
    await open(page, "/admin/support", { role: "staff", width: 820 });
    await page.getByTestId("support-open").first().click();
    const detail = page.getByTestId("support-detail");
    await expect(detail).toContainText("Check the cable");
    await expect(detail.getByTestId("support-close")).toBeVisible();
    await expect(detail.getByTestId("support-reply")).toHaveCount(0);
    await expect(detail.getByTestId("support-send")).toHaveCount(0);
  });

  test("a company in Godseye has the modules editor and an Audit tab with that plant's trail", async ({ page }) => {
    await open(page, "/admin/companies", { role: "staff", width: 1280 });
    // Search first: the local D1 keeps every e2e-made company, so the demo plant can be past page one.
    await page.getByLabel("Search companies").fill("Fourcubes");
    await expect(page).toHaveURL(/[?&]q=/);
    await page.getByRole("link", { name: /Fourcubes|Demo|orrn/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/companies\/.+/);
    await expect(page.getByRole("tab", { name: "Plan and modules" })).toBeVisible();
    // All ten modules are in the editor (the editor lists the bought modules of the plant).
    await expect(page.getByText("Scrap purchase").first()).toBeVisible();
    await rewrite<{ items: unknown[]; nextCursor: unknown }>(page, "platform.companiesAudit", (r) => {
      r.items = AUDIT_ROWS;
      r.nextCursor = null;
    });
    await page.getByRole("tab", { name: "Audit" }).click();
    await expect(page.getByTestId("company-audit")).toContainText("company.settings.update");
    // Settled before the picture: no tab animation, nothing busy, nothing overlapping.
    await expect(page.getByTestId("company-audit")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("Scrap purchase")).toHaveCount(0);
    await shot(page, "admin-company-audit", 1280);
    await expectContained(page);
  });
});

test.describe("forgot password", () => {
  for (const width of WIDTHS) {
    test(`${width}: the page renders and answers the same whether or not the address has an account`, async ({ page }) => {
      await openPublic(page, "/forgot-password", width);
      await expect(page.getByRole("heading", { level: 1, name: "Forgot your password?" })).toBeVisible();
      await shot(page, "forgot-password", width);
      expect(await blockingAxeViolations(page)).toEqual([]);
      await expectNoHorizontalScroll(page);
      await page.getByTestId("forgot-email").fill("nobody.at.all@example.com");
      await page.getByTestId("forgot-submit").click();
      const sent = page.getByTestId("forgot-sent");
      await expect(sent).toBeVisible();
      await expect(sent).toContainText("If an account exists for nobody.at.all@example.com");
      await expect(sent.getByRole("link", { name: "Back to sign in" })).toBeVisible();
      expect(await blockingAxeViolations(page)).toEqual([]);
    });
  }

  test("a bad address is flagged and nothing is sent", async ({ page }) => {
    let requests = 0;
    page.on("request", (r) => {
      if (r.url().includes("request-password-reset")) requests += 1;
    });
    await openPublic(page, "/forgot-password", 375);
    await page.getByTestId("forgot-email").fill("not-an-email");
    await page.getByTestId("forgot-submit").click();
    await expect(page.getByText("Enter an email like name@company.com.")).toBeVisible();
    expect(requests).toBe(0);
  });

  test("the sign-in page links to it", async ({ page }) => {
    await openPublic(page, "/login", 375);
    await page.getByTestId("forgot-link").click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test("the reset page asks twice, flags a short or mismatched password, and a dead token is told so", async ({ page }) => {
    await openPublic(page, "/reset-password?token=not-a-real-token", 820);
    await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
    await shot(page, "reset-password", 820);
    expect(await blockingAxeViolations(page)).toEqual([]);
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Type it again", { exact: true }).fill("short");
    await page.getByTestId("reset-submit").click();
    await expect(page.getByText("Use at least 8 characters.", { exact: true })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("Type it again", { exact: true }).fill("a-different-password");
    await page.getByTestId("reset-submit").click();
    await expect(page.getByText("The two passwords don't match.")).toBeVisible();
    await page.getByLabel("Type it again", { exact: true }).fill("a-long-enough-password");
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-broken")).toBeVisible();
    await expect(page.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("a reset link without a token, or with an error, is a dead end that offers a new link", async ({ page }) => {
    for (const path of ["/reset-password", "/reset-password?error=INVALID_TOKEN"]) {
      await openPublic(page, path, 375);
      await expect(page.getByTestId("reset-broken")).toBeVisible();
      await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible();
    }
  });

  test("a good token sets the password and the sign-in page is next", async ({ page }) => {
    await page.route("**/api/auth/reset-password", async (route) => {
      expect(route.request().postData()).toContain("a-long-enough-password");
      await route.fulfill({ json: { status: true } });
    });
    await openPublic(page, "/reset-password?token=good-token", 375);
    await page.getByLabel("New password", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("Type it again", { exact: true }).fill("a-long-enough-password");
    await page.getByTestId("reset-submit").click();
    const done = page.getByTestId("reset-done");
    await expect(done).toBeVisible();
    await expect(done).toContainText("authenticator");
    await expect(done.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  test("a sign-in link the server refused lands on /continue with the password message and a Forgot password link", async ({ page }) => {
    await openPublic(page, "/continue?error=ACCOUNT_USES_PASSWORD", 375);
    const refused = page.getByTestId("continue-refused");
    await expect(refused).toContainText("Sign in with your password");
    await expect(refused.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    await expect(refused.getByRole("link", { name: "Forgot password" })).toHaveAttribute("href", "/forgot-password");
    expect(await blockingAxeViolations(page)).toEqual([]);
  });
});

