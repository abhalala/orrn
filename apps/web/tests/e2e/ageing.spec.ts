import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { localPassword, signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Ageing screens (W3-AG-W): `/ageing` board, `/ageing/load`, `/ageing/batch/$id`, `/ageing/history`,
 * `/reports/ageing`, Today's tile, the order strip's aged cell and the bundle page's badge, against the
 * local seed (OV-1, T-1, T-2, AG-1 released on an approved override, AG-2 in the oven) and a trolley and
 * oven of the test's own per width. The press role does the oven work, the supervisor judges, the manager
 * approves; the operator loads; the viewer has no ageing screens.
 *
 * Lines come from the seed's logged press runs (`ageing.batches.availableLines`): each width loads two or
 * three pieces, and every batch a width made is voided or finished in `afterAll`, so the pieces go back.
 * The oven simulator (`OVEN_SIMULATOR=1` in wrangler.local.jsonc) writes the temperature curve.
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const WIDTHS = [375, 820, 1280] as const;
const SHOTS = process.env.AGEING_SHOTS_DIR;

type Api = {
  q<T>(path: string, input?: unknown): Promise<T>;
  m<T>(path: string, input?: unknown): Promise<T>;
  dispose(): Promise<void>;
};

async function apiAs(role: LocalRole): Promise<Api> {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
  const login = await ctx.post(`${API}/api/auth/sign-in/email`, { data: { email: `${role}@orrn.local`, password: localPassword() } });
  expect(login.ok(), `sign-in as ${role} returned ${login.status()}`).toBe(true);
  return {
    async q<T>(path: string, input?: unknown) {
      const url = `${API}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
      const res = await ctx.get(url);
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    async m<T>(path: string, input?: unknown) {
      const res = await ctx.post(`${API}/trpc/${path}`, { data: input ?? {} });
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    dispose: () => ctx.dispose(),
  };
}

async function openAs(browser: Browser, role: LocalRole, width: number, path: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 25_000 });
  return { page, context };
}

async function axeSerious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

/** No sideways scroll, no clipped text, no serious axe violation. */
async function clean(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await axeSerious(page)).toEqual([]);
}

async function shot(page: Page, width: number, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
}

const localInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Line = { pressRunLineId: string; pressRunNumber: string; sectionLabel: string; pcsLeft: number; alloy: string | null; temper: string | null };
type Fx = { tag: string; oven: { id: string; code: string }; trolleys: { id: string; code: string }[]; recipeId: string; shiftId: string; lines: Line[]; batches: string[] };

async function makeFixture(width: number): Promise<Fx> {
  const owner = await apiAs("owner");
  try {
    const tag = `${width}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const oven = await owner.m<{ id: string; code: string }>("ageing.ovens.save", { code: `EO${tag}`.slice(0, 12), status: "active", capacityG: 2_000_000, maxTempX10: 2500 });
    const trolleys: Fx["trolleys"] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      trolleys.push(await owner.m<{ id: string; code: string }>("ageing.trolleys.save", { code: `ET${tag}${n}`.slice(0, 12), status: "active", capacityG: 2_000_000 }));
    }
    const recipes = await owner.q<{ items: { id: string; alloy: string; temper: string; kind: string; status: string }[] }>("ageing.recipes.list", {});
    const recipe = recipes.items.find((r) => r.alloy === "6063" && r.temper === "T6" && r.kind === "full" && r.status === "active");
    expect(recipe, "the dev seed's active 6063 T6 recipe").toBeTruthy();
    const settings = await owner.q<{ shifts: { id: string }[] }>("company.getSettings");
    const available = await owner.q<{ items: Line[] }>("ageing.batches.availableLines", { limit: 50 });
    const lines = available.items.filter((l) => l.alloy === "6063" && l.temper === "T6" && l.pcsLeft >= 12);
    expect(lines.length, "logged 6063 T6 press lines with pieces left (dev seed)").toBeGreaterThan(1);
    return { tag, oven, trolleys, recipeId: recipe!.id, shiftId: settings.shifts[0]!.id, lines, batches: [] };
  } finally {
    await owner.dispose();
  }
}

/** Leave the plant as it was: void or finish every batch the width made, take its trolleys and oven out of service. */
async function cleanup(fx: Fx) {
  const owner = await apiAs("owner");
  const problems: string[] = [];
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  try {
    // A batch a failed test left on one of the width's trolleys (a successor, a half-made load) is finished too.
    const rack = await owner.q<{ items: { id: string; openBatchId: string | null }[] }>("ageing.trolleys.list", { includeInactive: true });
    for (const r of rack.items) if (r.openBatchId && fx.trolleys.some((t) => t.id === r.id) && !fx.batches.includes(r.openBatchId)) fx.batches.push(r.openBatchId);
    const abort = (await owner.q<{ id: string }[]>("press.reasons", { kind: "ageing_abort" }))[0]!.id;
    const scrap = (await owner.q<{ id: string }[]>("press.reasons", { kind: "ageing_scrap" }))[0]!.id;
    // Open override requests of these batches are decided first (a rejected one changes nothing).
    const pending = await owner.q<{ items: { id: string; kind: string; subjectId: string; status: string }[] }>("approval.list", { status: "pending", kind: "ageing_override", limit: 100, offset: 0 });
    for (const a of pending.items.filter((x) => fx.batches.includes(x.subjectId))) await attempt(`reject ${a.id}`, () => owner.m("approval.decide", { id: a.id, decision: "rejected", note: "e2e cleanup" }));
    // Newest first: voiding an aged-again successor puts its pieces back on the first batch, which is then finished.
    for (const id of [...fx.batches].reverse()) {
      await attempt(`finish batch ${id}`, async () => {
        const b = await owner.q<{ status: string; rows: { id: string; status: string; remainingPcs: number }[]; successorBatchId: string | null }>("ageing.batches.get", { id });
        if (b.status === "closed" || b.status === "void") return;
        if (b.status === "in_oven") await owner.m("ageing.batches.out", { batchId: id, gasEndMilli: 9_999_999 });
        const now = await owner.q<{ status: string; reworkOfBatchId: string | null; rows: { id: string; status: string; remainingPcs: number }[] }>("ageing.batches.get", { id });
        if (now.status === "loading") {
          // A loading batch is voided; for a rework successor that undoes the rework (r1).
          await owner.m("ageing.batches.void", { batchId: id, reason: "e2e cleanup" });
          return;
        }
        const judged = await owner.q<{ rows: { id: string; status: string; remainingPcs: number }[] }>("ageing.batches.get", { id });
        now.rows = judged.rows;
        // Judged batches: the pieces still on the trolley are discarded, which closes the batch.
        for (const r of now.rows) {
          if (r.remainingPcs > 0 && (r.status === "released" || r.status === "held")) await owner.m("ageing.batches.discardRemaining", { rowId: r.id, pcs: r.remainingPcs, reasonCodeId: scrap, note: "e2e cleanup" });
        }
        const after = await owner.q<{ status: string }>("ageing.batches.get", { id });
        if (after.status !== "closed" && after.status !== "void") await owner.m("ageing.batches.void", { batchId: id, reasonCodeId: abort, reason: "e2e cleanup" });
      });
    }
    for (const t of fx.trolleys) await attempt(`trolley ${t.code}`, () => owner.m("ageing.trolleys.save", { id: t.id, code: t.code, status: "out_of_service" }));
    await attempt(`oven ${fx.oven.code}`, () => owner.m("ageing.ovens.save", { id: fx.oven.id, code: fx.oven.code, status: "out_of_service" }));
  } finally {
    await owner.dispose();
  }
  if (problems.length > 0) throw new Error(`ageing cleanup left things behind:\n${problems.join("\n")}`);
}

/** A loaded batch on trolley `n` through the API (press role): returns its id and its rows. */
async function loadVia(fx: Fx, n: number, pcs: number, lineIndex = 0) {
  const press = await apiAs("press");
  try {
    const loaded = await press.m<{ id: string; number: string; rows: { id: string }[] }>("ageing.batches.load", {
      trolleyId: fx.trolleys[n]!.id,
      rows: [{ pressRunLineId: fx.lines[lineIndex]!.pressRunLineId, pcs }],
      clientMutationId: `e2e-${fx.tag}-${n}-${Math.random().toString(36).slice(2, 7)}`,
    });
    fx.batches.push(loaded.id);
    return loaded;
  } finally {
    await press.dispose();
  }
}

for (const width of WIDTHS) {
  test.describe(`ageing at ${width}px`, () => {
    test.describe.configure({ mode: "serial" });
    let fx: Fx;
    let main: { id: string; number: string } | null = null;

    test.beforeAll(async () => {
      fx = await makeFixture(width);
    });
    test.afterAll(async () => {
      if (fx) await cleanup(fx);
    });

    test("the board shows the ovens and trolleys, and the press role has the one load button", async ({ browser }) => {
      const { page, context } = await openAs(browser, "press", width, "/ageing");
      await expect(page.getByRole("heading", { level: 1, name: "Ageing" })).toBeVisible();
      await expect(page.locator(`[data-testid="oven-card"][data-oven="${fx.oven.code}"]`)).toContainText("Empty");
      await expect(page.locator(`[data-testid="trolley-card"][data-trolley="${fx.trolleys[0]!.code}"]`)).toHaveAttribute("data-state", "free");
      // The seed's AG-2 is soaking in OV-1 with a line of readings.
      const seeded = page.locator('[data-testid="oven-card"][data-oven="OV-1"]');
      await expect(seeded).toContainText("AG-2");
      await expect(seeded.getByTestId("temp-spark")).toBeVisible();
      await expect(seeded.getByTestId("oven-last-temp")).toContainText("°C");
      await expect(page.getByTestId("load-trolley")).toBeVisible();
      await clean(page);
      await shot(page, width, "board");
      await context.close();
    });

    test("press loads a trolley from a logged press line, starts it, logs readings, takes it out and records hardness", async ({ browser }) => {
      test.setTimeout(180_000);
      const { page, context } = await openAs(browser, "press", width, `/ageing/load?trolley=${fx.trolleys[0]!.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Load a trolley" })).toBeVisible();
      await expect(page.locator('[data-slot="trolley-picker"]').getByRole("radio", { name: fx.trolleys[0]!.code })).toBeChecked();
      const line = fx.lines[0]!;
      const box = page.getByRole("checkbox", { name: new RegExp(`${line.pressRunNumber} ${line.sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
      await box.check();
      // Pieces default to all that is left; a pick over the line is told so and not sent.
      const pcs = page.locator(`[data-line="${line.pressRunNumber}"]`).first().getByTestId("line-pcs");
      await pcs.fill(String(line.pcsLeft + 1));
      await expect(page.locator(`[data-line="${line.pressRunNumber}"]`).first()).toContainText(`Only ${line.pcsLeft} pieces`);
      await pcs.fill("4");
      await expect(page.getByTestId("load-summary")).toContainText("1 line, 4 pcs");
      await clean(page);
      await shot(page, width, "load");
      await page.getByTestId("load-submit").click();
      await page.waitForURL(/\/ageing\/batch\//, { timeout: 20_000 });
      const id = new URL(page.url()).pathname.split("/").pop()!;
      fx.batches.push(id);
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(/^AG-\d+$/, { timeout: 15_000 });
      main = { id, number: (await page.getByRole("heading", { level: 1 }).first().innerText()).trim() };
      await expect(page.locator('[data-slot="stepper"]')).toBeVisible();
      await expect(page.getByTestId("action-start")).toBeVisible();

      // Start: oven, recipe copied and shown, shift, gas start, in 8 hours ago (the curve is all in the past).
      await page.getByTestId("action-start").click();
      const start = page.getByTestId("start-form");
      await start.getByTestId("start-oven").selectOption({ value: fx.oven.id });
      await expect(start.getByTestId("start-recipe")).toHaveValue(fx.recipeId);
      await expect(start).toContainText("185.0 °C");
      await start.getByTestId("start-gas").fill("1000");
      await start.getByTestId("start-in-at").fill(localInput(Date.now() - 8 * 3_600_000));
      await page.getByTestId("start-form-submit").click();
      await expect(page.getByTestId("start-form")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId("batch-recipe")).toContainText("6063 T6");

      // The dev simulator writes the curve; a typed reading is added next to it.
      await page.getByTestId("simulate").click();
      await expect(page.getByTestId("readings-table")).toContainText("Simulated", { timeout: 15_000 });
      await page.getByTestId("add-reading").click();
      await page.getByTestId("temp-input").fill("185");
      await page.getByTestId("temp-form-submit").click();
      await expect(page.getByTestId("temp-form")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId("readings-table")).toContainText("Typed");
      await expect(page.getByTestId("temp-spark").first()).toBeVisible();
      await clean(page);
      await shot(page, width, "batch-oven");

      // Take out: gas end below the start is refused in the person's words and nothing changes.
      await page.getByTestId("action-takeOut").click();
      await page.getByTestId("out-gas").fill("900");
      await page.getByTestId("out-form-submit").click();
      await expect(page.getByTestId("ageing-refusal")).toContainText("Gas end is below gas start");
      await page.getByTestId("out-gas").fill("1500.5");
      await page.getByTestId("out-form-submit").click();
      await expect(page.getByTestId("out-form")).toBeHidden({ timeout: 15_000 });
      const verdict = page.getByTestId("verdict-panel");
      await expect(verdict).toHaveAttribute("data-verdict", "ok");
      await expect(verdict).toContainText("Soak met");

      // Hardness: three Webster samples at or above the recipe's 10.0.
      await page.getByTestId("action-hardness").click();
      const form = page.getByTestId("hardness-form");
      await form.getByTestId("hardness-sample-1").fill("10");
      await form.getByTestId("hardness-sample-2").fill("10.5");
      await form.getByTestId("hardness-sample-3").fill("11");
      await expect(form.getByTestId("hardness-median")).toContainText("10.5");
      await page.getByTestId("hardness-form-submit").click();
      await expect(page.getByTestId("hardness-form")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId("row-hardness").first()).toContainText("10.5");
      // The press role's work ends here: releasing is the supervisor's, and the screen says so.
      await expect(page.getByTestId("action-release")).toHaveCount(0);
      await expect(page.getByTestId("waiting-release")).toBeVisible();
      await clean(page);
      await shot(page, width, "batch-out");
      await context.close();
    });

    test("the supervisor releases, holds a line and clears the hold; the operator cannot release", async ({ browser }) => {
      test.setTimeout(120_000);
      expect(main, "the previous test made the batch").toBeTruthy();
      const op = await openAs(browser, "operator", width, `/ageing/batch/${main!.id}`);
      await expect(op.page.getByTestId("action-release")).toHaveCount(0);
      await op.context.close();

      const { page, context } = await openAs(browser, "supervisor", width, `/ageing/batch/${main!.id}`);
      await page.getByTestId("action-release").click();
      await expect(page.getByTestId("action-release")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator("main#main")).toContainText("Released");
      await expect(page.getByTestId("row-remaining").first()).toHaveText("4");

      // Hold the line (a reason from the plant's list), then clear the hold.
      await page.getByTestId("row-hold").first().click();
      await page.getByTestId("hold-form").getByTestId("hold-reason").selectOption({ index: 1 });
      await page.getByTestId("hold-form-submit").click();
      await expect(page.getByTestId("hold-form")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId("row-hold-why").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("row-unhold").first()).toBeVisible();
      await page.getByTestId("row-unhold").first().click();
      await page.getByTestId("unhold-confirm").click();
      await expect(page.getByTestId("row-hold").first()).toBeVisible({ timeout: 15_000 });
      await clean(page);
      await shot(page, width, "batch-released");
      await context.close();

      const owner = await apiAs("owner");
      try {
        const got = await owner.q<{ status: string; qcVerdict: string; rows: { status: string }[] }>("ageing.batches.get", { id: main!.id });
        expect(got).toMatchObject({ status: "released", qcVerdict: "pass", rows: [{ status: "released" }] });
        // The line is on the pack screen's trolley list.
        const source = await owner.q<{ items: { ageingRowId: string; batchNumber: string }[] }>("ageing.packSource", { limit: 50 });
        expect(source.items.some((i) => i.batchNumber === main!.number)).toBe(true);
      } finally {
        await owner.dispose();
      }
    });

    test("a short soak holds the line; the supervisor asks for approval, the manager approves with the figures in front of them, the supervisor releases", async ({ browser }) => {
      test.setTimeout(180_000);
      // Set up through the API: loaded, started now, one reading, out at once (a short soak), hardness fine.
      const loaded = await loadVia(fx, 1, 3, 1 % fx.lines.length);
      const press = await apiAs("press");
      try {
        await press.m("ageing.batches.start", { batchId: loaded.id, ovenId: fx.oven.id, recipeId: fx.recipeId, shiftId: fx.shiftId, gasStartMilli: 10_000 });
        await press.m("ageing.batches.temp", { batchId: loaded.id, tempCX10: 1850 });
        await press.m("ageing.batches.out", { batchId: loaded.id, gasEndMilli: 10_500 });
        await press.m("ageing.batches.hardness", { rowId: loaded.rows[0]!.id, method: "webster", readingsX10: [100, 105, 110] });
      } finally {
        await press.dispose();
      }

      const sup = await openAs(browser, "supervisor", width, `/ageing/batch/${loaded.id}`);
      await expect(sup.page.getByTestId("verdict-panel")).toHaveAttribute("data-verdict", "under_aged");
      await sup.page.getByTestId("action-release").click();
      // Nothing released: the soak was short, so the line is held and an approval could release it.
      await expect(sup.page.locator("[data-sonner-toast]").filter({ hasText: "held at release" })).toBeVisible({ timeout: 15_000 });
      await expect(sup.page.getByTestId("row-hold-why").first()).toBeVisible({ timeout: 15_000 });
      await expect(sup.page.getByTestId("verdict-text")).toContainText("Short by");
      await sup.page.getByTestId("override-open").click();
      await sup.page.getByTestId("override-reason").fill("Customer waiting, hardness is fine");
      await sup.page.getByTestId("override-form-submit").click();
      await expect(sup.page.getByTestId("override-form")).toBeHidden({ timeout: 15_000 });
      await expect(sup.page.getByTestId("override-state")).toHaveAttribute("data-state", "pending");
      await clean(sup.page);
      await shot(sup.page, width, "batch-held");

      const mgr = await openAs(browser, "manager", width, "/approvals");
      const card = mgr.page.locator('[data-testid="approval-card"][data-kind="ageing_override"]').filter({ hasText: loaded.number });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.getByRole("button", { name: /Review/ }).click();
      const figures = mgr.page.getByTestId("ageing-override-figures");
      await expect(figures).toBeVisible({ timeout: 15_000 });
      await expect(figures).toContainText(loaded.number);
      await expect(figures).toContainText("Under-aged");
      await expect(figures.getByTestId("override-line").first()).toContainText("10.5");
      await shot(mgr.page, width, "approval");
      await mgr.page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(mgr.page.getByTestId("ageing-override-figures")).toBeHidden({ timeout: 15_000 });
      await mgr.context.close();

      // Approving did not release anything: the supervisor presses Release again.
      await sup.page.reload();
      await expect(sup.page.getByTestId("override-state")).toHaveAttribute("data-state", "approved", { timeout: 15_000 });
      await sup.page.getByTestId("action-release").click();
      await expect(sup.page.getByTestId("action-release")).toHaveCount(0, { timeout: 15_000 });
      await expect(sup.page.locator("main#main")).toContainText("Released on approval");
      await sup.context.close();
    });

    test("a failed line can be aged again: the successor opens, and the first batch can no longer be voided", async ({ browser }) => {
      test.setTimeout(150_000);
      // Two lines on one trolley: the first passes, the second is soft.
      const press = await apiAs("press");
      let loaded: { id: string; number: string; rows: { id: string }[] };
      try {
        loaded = await press.m("ageing.batches.load", {
          trolleyId: fx.trolleys[2]!.id,
          rows: [
            { pressRunLineId: fx.lines[0]!.pressRunLineId, pcs: 2 },
            { pressRunLineId: fx.lines[1 % fx.lines.length]!.pressRunLineId, pcs: 2 },
          ],
          clientMutationId: `e2e-${fx.tag}-rework-${Math.random().toString(36).slice(2, 7)}`,
        });
        fx.batches.push(loaded.id);
        await press.m("ageing.batches.start", { batchId: loaded.id, ovenId: fx.oven.id, recipeId: fx.recipeId, shiftId: fx.shiftId, gasStartMilli: 20_000, inAt: Date.now() - 480 * 60_000 });
        await press.m("ageing.batches.simulate", { batchId: loaded.id });
        await press.m("ageing.batches.out", { batchId: loaded.id, gasEndMilli: 20_100 });
        await press.m("ageing.batches.hardness", { rowId: loaded.rows[0]!.id, method: "webster", readingsX10: [100, 105, 110] });
        await press.m("ageing.batches.hardness", { rowId: loaded.rows[1]!.id, method: "webster", readingsX10: [40, 45, 50] });
      } finally {
        await press.dispose();
      }
      // The soak is met; the first line passes and releases, the soft second line is held and can be aged again.
      const sup = await openAs(browser, "supervisor", width, `/ageing/batch/${loaded.id}`);
      await sup.page.getByTestId("action-release").click();
      await expect(sup.page.getByTestId("rework-open")).toBeVisible({ timeout: 15_000 });
      await sup.page.getByTestId("rework-open").click();
      await sup.page.getByTestId("rework-form").getByTestId("rework-trolley").selectOption({ value: fx.trolleys[4]!.id });
      await sup.page.getByTestId("rework-form-submit").click();
      await sup.page.waitForURL((u) => u.pathname.startsWith("/ageing/batch/") && !u.pathname.endsWith(loaded.id), { timeout: 20_000 });
      const successor = new URL(sup.page.url()).pathname.split("/").pop()!;
      fx.batches.push(successor);
      await expect(sup.page.getByTestId("batch-links")).toContainText("earlier batch");
      await expect(sup.page.getByTestId("action-start")).toBeVisible();
      await shot(sup.page, width, "batch-successor");
      // The first batch points at the new one, and voiding it is refused in the person's words (pieces were aged again).
      await sup.page.goto(`/ageing/batch/${loaded.id}`);
      await expect(sup.page.getByTestId("successor-link")).toBeVisible();
      await sup.page.getByTestId("void-open").click();
      await sup.page.getByTestId("void-form").getByTestId("void-reason").selectOption({ index: 1 });
      await sup.page.getByTestId("void-form-submit").click();
      await expect(sup.page.getByTestId("ageing-refusal")).toContainText("cannot be voided", { timeout: 15_000 });
      await sup.context.close();
    });

    test("a loading batch can be voided and its pieces go back to the press line", async ({ browser }) => {
      const loaded = await loadVia(fx, 3, 1, 0);
      const { page, context } = await openAs(browser, "press", width, `/ageing/batch/${loaded.id}`);
      await page.getByTestId("void-open").click();
      await page.getByTestId("void-form-submit").click();
      await page.waitForURL((u) => u.pathname === "/ageing", { timeout: 20_000 });
      await context.close();
      const o = await apiAs("owner");
      try {
        const got = await o.q<{ status: string; rows: { status: string }[] }>("ageing.batches.get", { id: loaded.id });
        expect(got.status).toBe("void");
        expect(got.rows.every((r) => r.status === "void")).toBe(true);
        // The trolley is free again.
        const rack = await o.q<{ items: { id: string; openBatchId: string | null }[] }>("ageing.trolleys.list", {});
        expect(rack.items.find((r) => r.id === fx.trolleys[3]!.id)!.openBatchId).toBeNull();
      } finally {
        await o.dispose();
      }
    });

    test("a bundle packed from the released line says Aged and links to its batch; voiding says where the pieces go, before and after the batch closes", async ({ browser }) => {
      test.setTimeout(120_000);
      expect(main, "the released batch of the first tests").toBeTruthy();
      const owner = await apiAs("owner");
      const bundles: { serial: string }[] = [];
      try {
        const batch = await owner.q<{ rows: { id: string; dieId: string; dieInstanceId: string | null; castId: string | null }[] }>("ageing.batches.get", { id: main!.id });
        const row = batch.rows[0]!;
        const yards = await owner.q<{ items: { id: string; kind: string }[] }>("stock.locations.list", {});
        const yard = yards.items.find((l) => l.kind === "yard");
        const pack = async (n: number) => {
          const res = await owner.m<{ bundles: { serial: string }[] }>("bundle.createReceipt", {
            dieId: row.dieId,
            ...(row.dieInstanceId ? { dieInstanceId: row.dieInstanceId } : {}),
            ...(row.castId ? { castId: row.castId } : {}),
            unit: "inch",
            ...(yard ? { locationId: yard.id } : {}),
            source: "plant_stock",
            ageingRowId: row.id,
            clientRequestId: `e2e-age-${fx.tag}-${n}-${Math.random().toString(36).slice(2, 10)}`,
            rows: [{ quantity: 2, weightG: 6000, lengthMm: 3658 }],
          });
          bundles.push(res.bundles[0]!);
        };
        await pack(1);
        const { page, context } = await openAs(browser, "supervisor", width, `/b/${bundles[0]!.serial}`);
        const trace = page.getByTestId("bundle-ageing");
        await expect(trace).toHaveAttribute("data-state", "aged", { timeout: 15_000 });
        await expect(page.getByTestId("aged-badge")).toHaveText("Aged");
        await expect(page.getByTestId("aged-batch-link")).toHaveText(main!.number);
        await clean(page);
        await shot(page, width, "bundle-aged");
        // The batch is still open: the pieces would go back to its line.
        await page.getByTestId("bundle-actions").getByRole("button", { name: /^Void/ }).first().click();
        await expect(page.getByTestId("void-ageing-note")).toHaveAttribute("data-outcome", "returns", { timeout: 15_000 });
        await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
        await context.close();

        // The second bundle takes the line's last pieces: the row and the batch close (Q58). Now a void writes off.
        await pack(2);
        const after = await owner.q<{ status: string }>("ageing.batches.get", { id: main!.id });
        expect(after.status).toBe("closed");
        const second = await openAs(browser, "supervisor", width, `/b/${bundles[1]!.serial}`);
        await second.page.getByTestId("bundle-actions").getByRole("button", { name: /^Void/ }).first().click();
        await expect(second.page.getByTestId("void-ageing-note")).toHaveAttribute("data-outcome", "write_off", { timeout: 15_000 });
        await expect(second.page.getByTestId("void-ageing-note")).toContainText("loose aged stock");
        await second.page.getByRole("dialog").getByLabel(/Reason/).fill("e2e write-off");
        await second.page.getByRole("dialog").getByRole("button", { name: /^Void/ }).click();
        await expect(second.page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 15_000 });
        await shot(second.page, width, "bundle-void-writeoff");
        await second.context.close();
      } finally {
        // Leave no bundle of ours in stock (the first one is voided too: the batch is closed, so it writes off).
        for (const b of bundles) {
          const got = await owner.q<{ bundle: { id: string; status: string } }>("bundle.getBySerial", { serial: b.serial }).catch(() => null);
          if (got && got.bundle.status === "available") await owner.m("bundle.transitionStatus", { id: got.bundle.id, toStatus: "void", reason: "e2e cleanup" }).catch(() => undefined);
        }
        await owner.dispose();
      }
    });

    test("history and the report list the batch; CSV downloads", async ({ browser }) => {
      expect(main).toBeTruthy();
      const { page, context } = await openAs(browser, "supervisor", width, "/ageing/history");
      await expect(page.getByRole("heading", { level: 1, name: "Ageing history" })).toBeVisible();
      await expect(page.getByTestId("history-batch").filter({ hasText: main!.number })).toBeVisible({ timeout: 15_000 });
      // By now the first test's batch is closed (its last pieces were packed).
      await page.getByTestId("history-status").selectOption("closed");
      await expect(page.getByTestId("history-batch").filter({ hasText: main!.number })).toBeVisible();
      await clean(page);
      await shot(page, width, "history");
      await context.close();

      const mgr = await openAs(browser, "manager", width, "/reports/ageing");
      await expect(mgr.page.getByRole("heading", { level: 1, name: "Ageing report" })).toBeVisible();
      await expect(mgr.page.getByText(main!.number).first()).toBeVisible({ timeout: 15_000 });
      await mgr.page.getByRole("button", { name: "Group by oven" }).or(mgr.page.getByRole("radio", { name: "Oven" })).first().click({ trial: true }).catch(() => undefined);
      const download = mgr.page.waitForEvent("download");
      await mgr.page.getByRole("button", { name: "CSV" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^ageing-\d{4}-\d{2}-\d{2}/);
      await clean(mgr.page);
      await shot(mgr.page, width, "report");
      await mgr.context.close();
    });

    test("Today's ageing tile opens the board; the viewer has no ageing screens", async ({ browser }) => {
      const sup = await openAs(browser, "supervisor", width, "/today");
      const tile = sup.page.getByTestId("today-oven");
      await expect(tile).toBeVisible({ timeout: 20_000 });
      await expect(tile).toContainText("In the oven");
      await tile.getByRole("link", { name: "Open the board" }).click();
      await sup.page.waitForURL((u) => u.pathname === "/ageing");
      await sup.context.close();

      const viewer = await openAs(browser, "viewer", width, "/today");
      await expect(viewer.page.getByTestId("today-oven")).toHaveCount(0);
      await viewer.page.goto("/ageing");
      await expect(viewer.page.getByText("The ageing screen did not load.")).toBeVisible({ timeout: 15_000 });
      await viewer.context.close();
    });
  });
}
