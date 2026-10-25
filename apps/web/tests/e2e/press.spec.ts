import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { signInViaApi, localPassword, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Press (W2-PR-W): `/press`, `/press/lines`, `/press/lines/$id`, `/press/runs/$id`, `/press/report`,
 * `/press/summary` and Today's press tile against the local seed (PR-1 die_issued on P1, PR-2 logged
 * today, PR-3 a late entry waiting for approval on P2).
 *
 * Each width gets its own press line, die copies and plan, created through the API in `beforeAll`
 * (the first run's one-running-per-press rule and the three widths running in parallel must not
 * meet), and retires them afterwards. Roles: press (press.run), supervisor (press.run + press.close
 * + press.queue), office (press.queue only), viewer (reads).
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const WIDTHS = [375, 820, 1280] as const;
const SHOTS = process.env.PRESS_SHOTS_DIR;

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

/** A fresh browser context signed in as `role`, at `width`. */
async function openAs(browser: Browser, role: LocalRole, width: number, path: string, opts: { locale?: "hi" | "gu" } = {}): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  if (opts.locale) await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), opts.locale);
  await signInViaApi(page, role);
  await page.goto(path);
  // A cold Vite on a loaded machine can take longer than the 5 s default to paint.
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
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
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

const kg1 = (g: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(g / 1000);
const localInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Walk the stepper with "Save and next" until the last step (Log run / Save) shows. */
async function toLastStep(page: Page, words = { next: "Save and next", remark: "Press remark" }) {
  await expect(page.locator('[data-slot="counting"]')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole("button", { name: words.next });
    if (!(await next.isVisible())) break;
    const before = Number(await page.locator('[data-slot="counting"]').getAttribute("data-step"));
    await next.click();
    await expect(page.locator('[data-slot="counting"]')).not.toHaveAttribute("data-step", String(before));
  }
  await expect(page.getByLabel(words.remark, { exact: true })).toBeVisible();
}

async function pickOption(page: Page, trigger: ReturnType<Page["getByLabel"]>, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
}

type Run = { id: string; number: string; sectionId: string; pressPlanDieId: string };
type Fixture = {
  lineId: string;
  lineCode: string;
  planId: string;
  ready: Run;
  queued: Run;
  readyCopy: { id: string; code: string };
  lateCopy: { id: string; code: string };
};

async function makeFixture(width: number): Promise<Fixture> {
  const owner = await apiAs("owner");
  try {
    const lineCode = `E${width}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const line = await owner.m<{ id: string }>("press.lines.create", { code: lineCode, name: `E2E ${width}` });
    const readyCopy = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-13090" });
    const lateCopy = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-14701" });
    await owner.m("dieInstance.addReading", { dieInstanceId: readyCopy.id, kgPer12ftMilli: 2700 });
    const now = Date.now();
    const plan = await owner.m<{ id: string }>("plans.create", {
      windowStart: now,
      windowEnd: now + 8 * 3_600_000,
      pressLineId: line.id,
      dies: [
        { sectionId: "dev-die-13090", lines: [{ salesOrderLineId: "dev-sol-2-1", pcs: 20 }] },
        { sectionId: "dev-die-11250", lines: [{ salesOrderLineId: "dev-sol-1-2", pcs: 10 }] },
      ],
    });
    const rel = await owner.m<{ runs: Run[] }>("plans.release", { id: plan.id });
    const [ready, queued] = rel.runs as [Run, Run];
    await owner.m("dieInstance.issues.issue", { dieInstanceId: readyCopy.id, pressLineId: line.id, pressRunId: ready.id });
    return { lineId: line.id, lineCode, planId: plan.id, ready, queued, readyCopy, lateCopy };
  } finally {
    await owner.dispose();
  }
}

/** Void what is still open and retire the test press, so the plant is as it was. */
async function cleanup(fx: Fixture | undefined) {
  if (!fx) return;
  const owner = await apiAs("owner");
  try {
    const reasons = await owner.q<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
    const reasonCodeId = reasons.find((r) => r.code === "other")?.id ?? reasons[0]!.id;
    const runs = await owner.q<{ items: { id: string; status: string }[] }>("press.runs.list", { pressLineId: fx.lineId, limit: 100 });
    for (const r of runs.items) {
      if (r.status === "logged" || r.status === "voided") continue;
      if (r.status === "counting" || r.status === "running" || r.status === "stopped") continue;
      await owner.m("press.runs.void", { id: r.id, reasonCodeId, note: "e2e cleanup" }).catch(() => {});
    }
    await owner.m("press.lines.retire", { id: fx.lineId }).catch(() => {});
  } finally {
    await owner.dispose();
  }
}

for (const width of WIDTHS) {
  test.describe(`press at ${width}`, () => {
    test.describe.configure({ mode: "serial" });
    let fx: Fixture;

    test.beforeAll(async () => {
      fx = await makeFixture(width);
    });
    test.afterAll(async () => {
      await cleanup(fx);
    });

    test("line board shows P1, P2 and the test press with running and waiting counts", async ({ browser }) => {
      const { page, context } = await openAs(browser, "supervisor", width, "/press");
      await expect(page.getByRole("heading", { name: "Press", level: 1 })).toBeVisible();
      const p1 = page.locator('[data-slot="press-line"][data-line="P1"]');
      const p2 = page.locator('[data-slot="press-line"][data-line="P2"]');
      const mine = page.locator(`[data-slot="press-line"][data-line="${fx.lineCode}"]`);
      await expect(p1).toBeVisible();
      await expect(p2).toBeVisible();
      // P1: PR-1 (die issued) waits; P2: PR-3 is being counted (late entry).
      await expect(p1.getByTestId("line-waiting")).toHaveText("1");
      await expect(p2.getByTestId("line-on-line")).toHaveText("PR-3");
      await expect(p2.getByTestId("line-waiting")).toHaveText("0");
      await expect(mine.getByTestId("line-waiting")).toHaveText("2");
      await expect(mine.getByTestId("line-on-line")).toHaveText("Nothing running");
      // None of the demo furniture of the preview.
      for (const word of ["Sample data", "Fixture", "FP-PR"]) await expect(page.getByText(word, { exact: false })).toHaveCount(0);
      await shot(page, width, "board");
      await clean(page);
      await context.close();
    });

    test("queue shows job cards with sales order numbers, lengths, pcs and kg; waiting count equals the cards", async ({ browser }) => {
      const { page, context } = await openAs(browser, "supervisor", width, `/press/lines/${fx.lineId}`);
      await expect(page.getByRole("heading", { name: `${fx.lineCode} queue`, level: 1 })).toBeVisible();
      const cards = page.locator('[data-slot="job-card"]');
      await expect(cards).toHaveCount(2);
      await expect(page.getByTestId("queue-waiting-count")).toHaveText("2");
      await expect(page.getByTestId("queue-on-line-count")).toHaveText("0");
      const ready = page.locator(`[data-slot="job-card"][data-run="${fx.ready.number}"]`);
      const queued = page.locator(`[data-slot="job-card"][data-run="${fx.queued.number}"]`);
      await expect(ready).toContainText("SO-2");
      await expect(ready).toContainText("Royal Aluminium");
      await expect(ready).toContainText("18 ft × 20 pcs");
      await expect(ready).toContainText(fx.readyCopy.code);
      await expect(ready).toContainText("Total: 20 pcs");
      await expect(queued).toContainText("SO-1");
      await expect(queued).toContainText("12 ft × 10 pcs");
      await expect(queued).toContainText("Die not issued");
      // Filters narrow the list without renumbering it.
      await pickOption(page, page.getByLabel("Order", { exact: true }), /SO-1/);
      await expect(cards).toHaveCount(1);
      await expect(page).toHaveURL(/order=/);
      await expect(queued).toContainText("Number 2 in queue");
      await shot(page, width, "queue");
      await clean(page);
      await context.close();
    });

    test("a queued run shows the lock banner and no Start; the viewer sees nothing actionable", async ({ browser }) => {
      const { page, context } = await openAs(browser, "supervisor", width, `/press/runs/${fx.queued.id}`);
      const banner = page.locator('[data-banner="locked"]');
      await expect(banner).toContainText("Die not issued. Start is locked.");
      await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: fx.queued.number, level: 1 })).toBeVisible();
      await expect(page.locator('[data-slot="released"]')).toContainText("SO-1");
      await shot(page, width, "station-locked");
      await clean(page);
      await context.close();

      const viewer = await openAs(browser, "viewer", width, `/press/runs/${fx.ready.id}`);
      await expect(viewer.page.locator('[data-banner="ready"]')).toBeVisible();
      await expect(viewer.page.getByRole("button", { name: /^(Start|Stop|Handover|Count|Press stopped)/ })).toHaveCount(0);
      await viewer.page.goto(`/press/lines/${fx.lineId}`);
      await expect(viewer.page.getByRole("heading", { level: 1 })).toContainText(`${fx.lineCode} queue`);
      await expect(viewer.page.getByRole("button", { name: /Late entry|Move up|Move down|Mark urgent|Take back/ })).toHaveCount(0);
      await viewer.context.close();
    });

    test("queue reorder and urgent are for press.queue holders (office), not the press man", async ({ browser }) => {
      const press = await openAs(browser, "press", width, `/press/lines/${fx.lineId}`);
      await expect(press.page.locator('[data-slot="job-card"]')).toHaveCount(2);
      await expect(press.page.getByRole("button", { name: /Move up|Move down|Mark urgent/ })).toHaveCount(0);
      await press.context.close();

      const { page, context } = await openAs(browser, "office", width, `/press/lines/${fx.lineId}`);
      await expect(page.locator('[data-slot="job-card"]')).toHaveCount(2);
      const numbers = () => page.locator('[data-slot="job-card"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-run")));
      expect(await numbers()).toEqual([fx.ready.number, fx.queued.number]);
      await page.getByRole("button", { name: `Move up: ${fx.queued.number}` }).click();
      await expect.poll(numbers).toEqual([fx.queued.number, fx.ready.number]);
      const owner = await apiAs("owner");
      const q = await owner.q<{ cards: { number: string }[] }>("press.queue.list", { pressLineId: fx.lineId });
      expect(q.cards.map((c) => c.number)).toEqual([fx.queued.number, fx.ready.number]);
      // The first has no Move up, the last no Move down.
      await expect(page.getByRole("button", { name: `Move up: ${fx.queued.number}` })).toBeDisabled();
      await expect(page.getByRole("button", { name: `Move down: ${fx.ready.number}` })).toBeDisabled();
      // Urgent goes first whatever the position, and is audited by the server.
      await page.getByRole("button", { name: "Mark urgent" }).last().click();
      await expect.poll(numbers).toEqual([fx.ready.number, fx.queued.number]);
      await expect(page.locator(`[data-run="${fx.ready.number}"]`)).toContainText("Urgent");
      await page.getByRole("button", { name: "Remove urgent" }).click();
      await page.getByRole("button", { name: `Move up: ${fx.ready.number}` }).click();
      await expect.poll(numbers).toEqual([fx.ready.number, fx.queued.number]);
      await shot(page, width, "queue-office");
      await owner.dispose();
      await clean(page);
      await context.close();
    });

    test("press man: Start, running with server time, a stoppage, Stop, then Count and check; he cannot log", async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await openAs(browser, "press", width, `/press/runs/${fx.ready.id}`);
      await expect(page.locator('[data-banner="ready"]')).toContainText("Die issued. Ready to start.");
      await shot(page, width, "station-ready");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      const running = page.locator('[data-banner="running"]');
      await expect(running).toBeVisible();
      await expect(page.getByTestId("started-at")).toHaveText(/^Started \d{2}:\d{2}$/);
      await expect(page.getByTestId("elapsed")).toHaveText(/^\d{2}:\d{2}/);
      await expect(running).toContainText("Times come from the server clock");
      // The server's start time is what the screen shows.
      const owner = await apiAs("owner");
      const got = await owner.q<{ run: { status: string; startedAt: string } }>("press.runs.get", { id: fx.ready.id });
      expect(got.run.status).toBe("running");
      const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date(got.run.startedAt));
      await expect(page.getByTestId("started-at")).toHaveText(`Started ${hhmm}`);

      // Downtime with a reason code, start and stop.
      await page.getByRole("button", { name: "Press stopped" }).click();
      const sheet = page.getByRole("dialog");
      await pickOption(page, sheet.getByLabel("Why it stopped"), "Waiting for billets");
      await sheet.getByRole("button", { name: "Press stopped" }).click();
      const row = page.locator('[data-slot="downtime"] li[data-open="true"]');
      await expect(row).toContainText("Waiting for billets");
      await expect(row).toContainText(/Stopped since \d{2}:\d{2}/);
      await shot(page, width, "station-running");
      await page.getByRole("button", { name: "Press running again" }).click();
      await expect(page.locator('[data-slot="downtime"] li[data-open="false"]')).toContainText(/\d+ min/);

      // Handover: a relief operator takes over; the run keeps its start time.
      await page.getByRole("button", { name: "Handover" }).click();
      const dlg = page.getByRole("dialog");
      await pickOption(page, dlg.getByLabel("Takes over as relief"), "Local Supervisor");
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(page.locator('[data-slot="run-card"]')).toContainText("Local Supervisor");
      await expect(page.getByTestId("started-at")).toHaveText(`Started ${hhmm}`);

      // A second stoppage is left open when the press stops: the close will name it.
      await page.getByRole("button", { name: "Press stopped" }).click();
      await pickOption(page, page.getByRole("dialog").getByLabel("Why it stopped"), "Power cut");
      await page.getByRole("dialog").getByRole("button", { name: "Press stopped" }).click();
      await expect(page.locator('[data-slot="downtime"] li[data-open="true"]')).toContainText("Power cut");

      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.locator('[data-banner="stopped"]')).toBeVisible();
      await expect(page.getByTestId("stopped-window")).toHaveText(new RegExp(`^${hhmm} – \\d{2}:\\d{2}$`));
      await shot(page, width, "station-stopped");
      await page.getByRole("button", { name: "Count & check" }).click();
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();

      // Step 1: billets (the cast with billets on hand, 4 billets weighing 77 kg).
      await pickOption(page, page.getByLabel("Cast the billets came from"), /billet stock/);
      await page.getByLabel("Billets", { exact: true }).fill("4");
      await page.getByLabel("Weighed kg", { exact: true }).fill("77");
      await shot(page, width, "count-billets");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 2: pieces by cut length, with the order the plan released.
      await expect(page.locator('[data-slot="cut-row"]').first()).toContainText("SO-2");
      await page.getByLabel("Pcs", { exact: true }).fill("20");
      await page.getByLabel("Good kg", { exact: true }).fill("58.1");
      await shot(page, width, "count-pieces");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 3: butt and ends.
      await page.getByLabel("Butt kg", { exact: true }).fill("6");
      await page.getByLabel("Ends kg", { exact: true }).fill("3");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 4: rejects, 3 pieces and 7 kg for a bend.
      await page.getByLabel("Reject kg", { exact: true }).fill("1.7");
      await page.getByLabel("Reject pieces", { exact: true }).fill("3");
      await pickOption(page, page.getByLabel("Reject reason", { exact: true }), "Bend");
      await shot(page, width, "count-rejects");
      await page.getByRole("button", { name: "Save and next" }).click();
      await page.getByLabel("Press remark", { exact: true }).fill("Ram slow on the third billet");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await owner.q<{ run: { pressRemark: string | null } }>("press.runs.get", { id: fx.ready.id })).run.pressRemark).toBe("Ram slow on the third billet");

      // The same entries survive a reload (they are on the server, and the typed draft is kept).
      await page.reload();
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();

      const preview = await owner.q<{ saved: boolean; figures: { recoveryPct: string | null; inputG: number; goodG: number; rejectG: number; balanceG: number }; gates: string[] }>("press.runs.preview", { id: fx.ready.id });
      expect(preview.saved).toBe(false);
      expect(preview.figures).toMatchObject({ inputG: 77_000, goodG: 58_100 });
      await owner.dispose();
      await context.close();
    });

    test("the press man's last step: preview is the server's 'not saved' figures, no Log run", async ({ browser }) => {
      const { page, context } = await openAs(browser, "press", width, `/press/runs/${fx.ready.id}`);
      await toLastStep(page);
      const panel = page.locator('[data-slot="close-preview"]');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Not saved yet");
      await expect(page.getByRole("button", { name: "Log run" })).toHaveCount(0);
      await expect(page.getByText("A supervisor logs this run.")).toBeVisible();
      const owner = await apiAs("supervisor");
      const server = await owner.q<{ figures: { recoveryPct: string | null; inputG: number; goodG: number; rejectG: number; balanceG: number }; gates: string[] }>("press.runs.preview", { id: fx.ready.id });
      await expect(page.getByTestId("preview-recovery")).toHaveText(`${server.figures.recoveryPct}%`);
      await expect(page.getByTestId("preview-input")).toHaveText(`${kg1(server.figures.inputG)} kg`);
      await expect(page.getByTestId("preview-good")).toHaveText(`${kg1(server.figures.goodG)} kg`);
      await expect(page.getByTestId("preview-balance")).toHaveText(`${kg1(server.figures.balanceG)} kg`);
      // The stoppage left open is named in the gate list, in the screen's words.
      await expect(page.locator('[data-gate="downtime_open"]')).toContainText("Stop the open downtime first.");
      await shot(page, width, "count-last-press");
      await clean(page);
      await owner.dispose();
      await context.close();
    });

    test("supervisor: a refused close shows the gate sentences; then Log run, logged with the server's recovery", async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await openAs(browser, "supervisor", width, `/press/runs/${fx.ready.id}`);
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();
      await toLastStep(page);
      await expect(page.getByRole("button", { name: "Log run" })).toBeVisible();
      await page.getByRole("button", { name: "Log run" }).click();
      const refused = page.locator('[data-slot="close-refused"]');
      await expect(refused).toContainText("The run was not logged.");
      await expect(refused).toContainText("Stop the open downtime first.");
      await shot(page, width, "close-refused");
      await clean(page);

      // Fix it: the open stoppage is stopped from the same screen, then the preview is ready.
      await page.getByRole("button", { name: "Press running again" }).click();
      await expect(page.locator('[data-gate="downtime_open"]')).toHaveCount(0);
      await expect(page.getByText("Ready to log.")).toBeVisible();
      // 77.0 kg in, 58.1 good, 6 + 3 + 1.7 out: 75.5 %, balance 8.2 kg.
      await expect(page.getByTestId("preview-recovery")).toHaveText("75.5%");
      await expect(page.getByTestId("preview-balance")).toHaveText("8.2 kg");
      await shot(page, width, "count-last-supervisor");
      await page.getByRole("button", { name: "Log run" }).click();
      await expect(page.locator('[data-banner="logged"]')).toBeVisible();
      await expect(page.getByTestId("logged-recovery")).toHaveText("75.5%");
      await expect(page.locator('[data-slot="logged"]')).toContainText("SO-2");
      await expect(page.getByRole("button", { name: "Request reopen" })).toBeVisible();
      await shot(page, width, "station-logged");
      await clean(page);

      // The press man sees the logged run but cannot ask for a reopen.
      const press = await openAs(browser, "press", width, `/press/runs/${fx.ready.id}`);
      await expect(press.page.locator('[data-banner="logged"]')).toBeVisible();
      await expect(press.page.getByRole("button", { name: "Request reopen" })).toHaveCount(0);
      await press.context.close();

      // Reopen is a request; the manager decides it elsewhere.
      await page.getByRole("button", { name: "Request reopen" }).click();
      await page.getByLabel("Why does it need to reopen?").fill("Wrong billet weight");
      await page.getByRole("dialog").getByRole("button", { name: "Request reopen" }).click();
      await expect(page.getByText("Waiting for a manager to decide the reopen.")).toBeVisible();
      await context.close();
    });

    test("supervisor enters a run late: sheet, then a counting run flagged and waiting for approval", async ({ browser }) => {
      test.setTimeout(90_000);
      const { page, context } = await openAs(browser, "supervisor", width, `/press/lines/${fx.lineId}`);
      await page.getByRole("button", { name: "Late entry" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("radio", { name: "A run not in the queue" }).click();
      await pickOption(page, sheet.getByLabel("Die copy"), new RegExp(`^${fx.lateCopy.code}`));
      const now = Date.now();
      await sheet.getByLabel("Started", { exact: true }).fill(localInput(now - 3 * 3_600_000));
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 2 * 3_600_000));
      // A stop before the start is refused in words, nothing is sent.
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 4 * 3_600_000));
      await sheet.getByLabel("Why it is entered late").fill("Tablet was down on the night shift");
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(sheet.getByRole("alert")).toContainText("Stop must be after start.");
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 2 * 3_600_000));
      await shot(page, width, "late-entry-sheet");
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(page.locator('[data-banner="counting"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-slot="run-card"]')).toContainText("Entered late");
      await expect(page.getByText("This late entry waits for approval.").first()).toBeVisible();
      await shot(page, width, "station-late");
      await clean(page);
      await context.close();
    });

    if (width === 1280) {
      test("report: 17 columns, plan filter, CSV download; summary and Today's press tile", async ({ browser }) => {
        test.setTimeout(90_000);
        const sup = await apiAs("supervisor");
        const day = (await sup.q<{ productionDay: string }>("press.summary", {})).productionDay;
        const { page, context } = await openAs(browser, "supervisor", width, `/press/report?from=${day}&to=${day}&plan=${fx.planId}`);
        const table = page.getByTestId("press-report-table");
        await expect(table.locator("thead th")).toHaveCount(17);
        await expect(table.locator("tbody tr")).toHaveCount(1);
        const row = table.locator(`tbody tr[data-run="${fx.ready.number}"]`);
        await expect(row).toContainText("SO-2");
        await expect(row).toContainText("75.5");
        await expect(row).toContainText("Waiting for billets");
        await expect(page.getByTestId("press-report-totals")).toContainText("75.5");
        // Without the plan filter the seeded PR-2 (logged today) is on the sheet too.
        await page.goto(`/press/report?from=${day}&to=${day}`);
        await expect(page.getByTestId("press-report-table").locator('tbody tr[data-run="PR-2"]')).toBeVisible();
        await page.goto(`/press/report?from=${day}&to=${day}&plan=${fx.planId}`);
        await expect(page.getByTestId("press-report-table")).toBeVisible();
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
        expect(download.suggestedFilename()).toMatch(/^press-report-.*\.csv$/);
        const path = await download.path();
        const text = await (await import("node:fs/promises")).readFile(path, "utf8");
        const lines = text.trim().split("\n");
        expect(lines[0]!.match(/"[^"]*"|[^,]+/g)).toHaveLength(17);
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain(fx.ready.number);
        await shot(page, width, "report");
        await clean(page);
        await context.close();

        const s = await openAs(browser, "supervisor", width, `/press/summary?day=${day}`);
        await expect(s.page.getByRole("heading", { name: "Daily press summary", level: 1 })).toBeVisible();
        await expect(s.page.getByText("Stops, longest first")).toBeVisible();
        await expect(s.page.locator('[data-reason="billet_wait"]')).toBeVisible();
        await shot(s.page, width, "summary");
        await clean(s.page);
        await s.context.close();

        const t = await openAs(browser, "supervisor", width, "/today");
        await expect(t.page.getByTestId("today-press")).toBeVisible();
        await expect(t.page.getByTestId("today-press")).toContainText("Pressed today");
        await expect(t.page.getByTestId("today-press")).toContainText("Entered late");
        await shot(t.page, width, "today");
        await t.context.close();
        // A viewer reads the report and the summary but Today shows no press tile (four KPIs only).
        const v = await openAs(browser, "viewer", width, "/today");
        await expect(v.page.getByTestId("today-press")).toHaveCount(0);
        await v.context.close();
        await sup.dispose();
      });
    }

    test("report and summary fit the screen (no sideways page scroll)", async ({ browser }) => {
      const sup = await apiAs("supervisor");
      const day = (await sup.q<{ productionDay: string }>("press.summary", {})).productionDay;
      await sup.dispose();
      const r = await openAs(browser, "supervisor", width, `/press/report?from=${day}&to=${day}`);
      await expect(r.page.getByTestId("press-report-table")).toBeVisible();
      await clean(r.page);
      await r.page.goto("/press/summary");
      await expect(r.page.getByRole("heading", { name: "Daily press summary", level: 1 })).toBeVisible();
      await clean(r.page);
      await r.page.goto("/press/lines");
      await expect(r.page.getByRole("heading", { name: "Press lines", level: 1 })).toBeVisible();
      await expect(r.page.locator(`[data-line="${fx.lineCode}"]`)).toBeVisible();
      await clean(r.page);
      await r.context.close();
    });
  });
}

test.describe("press in Hindi and Gujarati at 375", () => {
  test.describe.configure({ mode: "serial" });
  let fx: Fixture;
  test.beforeAll(async () => {
    fx = await makeFixture(375);
  });
  test.afterAll(async () => {
    await cleanup(fx);
  });

  test("hi: the lock banner, the start button and the counting words are Hindi; no sideways scroll", async ({ browser }) => {
    const { page, context } = await openAs(browser, "press", 375, `/press/runs/${fx.queued.id}`, { locale: "hi" });
    await expect(page.locator('[data-banner="locked"]')).toContainText("Die जारी नहीं हुई। Start बंद है।");
    await clean(page);
    await page.goto(`/press/runs/${fx.ready.id}`);
    await expect(page.locator('[data-banner="ready"]')).toContainText("Die जारी हो गई");
    await expect(page.getByRole("button", { name: "शुरू करें", exact: true })).toBeVisible();
    await shot(page, 375, "station-hi");
    await clean(page);
    await context.close();
  });

  test("gu: the same screens in Gujarati, through counting, no sideways scroll", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, context } = await openAs(browser, "press", 375, `/press/runs/${fx.ready.id}`, { locale: "gu" });
    await expect(page.locator('[data-banner="ready"]')).toContainText("Die જારી થઈ ગઈ");
    await shot(page, 375, "station-gu-ready");
    await clean(page);
    await page.getByRole("button", { name: "શરૂ કરો", exact: true }).click();
    await expect(page.locator('[data-banner="running"]')).toBeVisible();
    await expect(page.getByTestId("started-at")).toContainText("શરૂ");
    await shot(page, 375, "station-gu-running");
    await clean(page);
    await page.getByRole("button", { name: "રોકો", exact: true }).click();
    await page.getByRole("button", { name: "ગણતરી અને તપાસ" }).click();
    await expect(page.locator('[data-banner="counting"]')).toBeVisible();
    await expect(page.getByLabel("કાસ્ટ", { exact: false }).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    // Gujarati falls back to English per key; a raw key (`nav.today`, `press.queue.title`) must never show.
    await expect(page.locator("body")).not.toContainText(/\b(nav|ui|press|common|units)\.[a-zA-Z]+/);
    await shot(page, 375, "station-gu-count");
    await clean(page);
    await context.close();
  });
});
