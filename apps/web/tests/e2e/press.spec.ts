import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { signInViaApi, localPassword, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Press (W2-PR-W): `/press`, `/press/lines`, `/press/lines/$id`, `/press/runs/$id`, `/press/report`,
 * `/press/summary` and Today's press tile against the local seed (PR-1 die_issued on P1, PR-8 logged
 * today, PR-9 a late entry waiting for approval on P2, queued and trial runs on P1).
 *
 * Each width gets its own press line, die copies, party, two orders and plan, created through the
 * API in `beforeAll` (the first run's one-running-per-press rule and the three widths running in
 * parallel must not meet; BACKLOG 42: no fixture plans a seeded order line, so orders.spec and the
 * other describes never share a line's baki, and the dies are Tee 13090 and Patti 14701, which no
 * spec gives an owner), and removes them afterwards (`cleanup`: every open run is finished or voided,
 * approvals it left are decided, the orders are closed, the press and the die copies are retired; it
 * runs from afterAll, so a failed test still cleans up, and it throws when something could not be
 * undone). Roles: press (press.run),
 * supervisor (press.run + press.close + press.queue), office (press.queue and void), viewer (reads),
 * and a manager (press.close without press.run), made by re-roling the unused `operator` seed
 * member for the manager describe only and restored afterwards.
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
  /** A second copy of the queued run's die (Patti 14701): the one a late entry of that run names (BACKLOG 50). */
  queueCopy: { id: string; code: string };
  /** The party both orders are for. */
  party: string;
  /** The ready run's order (Tee 13090, 18 ft × 20 pcs) and the queued run's (Patti 14701, 12 ft × 10 pcs). */
  readyOrder: string;
  queuedOrder: string;
};
/** What a describe has created so far, filled as it goes so a half-built fixture is still cleaned. */
type Created = { lines: string[]; copies: string[]; orders: string[] };
const newCreated = (): Created => ({ lines: [], copies: [], orders: [] });

/** An order number, exactly: "SO-4" never matches "SO-41". */
const orderNo = (n: string) => new RegExp(`${n}(?!\\d)`);

/** A confirmed order of one pcs line for `customerId`; returns its number and line id. */
async function ownOrder(owner: Api, created: Created, customerId: string, line: { sectionId: string; cutLengthMm: number; pcs: number }) {
  const made = await owner.m<{ id: string; number: string }>("orders.create", {
    customerId,
    poNumber: `PR-E2E-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{ ...line, qtyBasis: "pcs", tierRank: 1 }],
  });
  created.orders.push(made.id);
  const got = await owner.q<{ order: { serverSeq: number }; lines: { lineId: string }[] }>("orders.get", { id: made.id });
  await owner.m("orders.confirm", { id: made.id, serverSeq: got.order.serverSeq });
  return { number: made.number, lineId: got.lines[0]!.lineId };
}

async function makeFixture(width: number, created: Created): Promise<Fixture> {
  const owner = await apiAs("owner");
  try {
    const lineCode = `E${width}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const line = await owner.m<{ id: string }>("press.lines.create", { code: lineCode, name: `E2E ${width}` });
    created.lines.push(line.id);
    const readyCopy = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-13090", status: "available" });
    created.copies.push(readyCopy.id);
    const lateCopy = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-14701", status: "available" });
    created.copies.push(lateCopy.id);
    const queueCopy = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-14701", status: "available" });
    created.copies.push(queueCopy.id);
    await owner.m("dieInstance.addReading", { dieInstanceId: readyCopy.id, kgPer12ftMilli: 2700 });
    // BACKLOG 42: the fixture's own party and orders, never a seeded order line.
    const tag = Math.random().toString(36).slice(2, 7);
    const party = `Press ${width} Traders ${tag}`;
    const customer = await owner.m<{ id: string }>("customer.create", {
      name: party,
      phone: null,
      billingAddress: { line1: "Plot 1", city: `Presspur ${tag}`, state: "Gujarat", postalCode: "380001", country: "India" },
    });
    const readyOrder = await ownOrder(owner, created, customer.id, { sectionId: "dev-die-13090", cutLengthMm: 5486, pcs: 20 });
    const queuedOrder = await ownOrder(owner, created, customer.id, { sectionId: "dev-die-14701", cutLengthMm: 3658, pcs: 10 });
    const now = Date.now();
    const plan = await owner.m<{ id: string }>("plans.create", {
      windowStart: now,
      windowEnd: now + 8 * 3_600_000,
      pressLineId: line.id,
      dies: [
        { sectionId: "dev-die-13090", lines: [{ salesOrderLineId: readyOrder.lineId, pcs: 20 }] },
        { sectionId: "dev-die-14701", lines: [{ salesOrderLineId: queuedOrder.lineId, pcs: 10 }] },
      ],
    });
    const rel = await owner.m<{ runs: Run[] }>("plans.release", { id: plan.id });
    const [ready, queued] = rel.runs as [Run, Run];
    await owner.m("dieInstance.issues.issue", { dieInstanceId: readyCopy.id, pressLineId: line.id, pressRunId: ready.id });
    return { lineId: line.id, lineCode, planId: plan.id, ready, queued, readyCopy, lateCopy, queueCopy, party, readyOrder: readyOrder.number, queuedOrder: queuedOrder.number };
  } finally {
    await owner.dispose();
  }
}

type RunGet = {
  run: { id: string; number: string; status: string; castId: string | null };
  planLines: { id: string; cutLengthMm: number }[];
  downtime: { id: string; stoppedAt: string | null }[];
  approvals: { id: string; kind: string; status: string }[];
  copy: { id: string } | null;
};

/** Bring one run to a final state through the API: void it before it starts, otherwise count and log it. */
async function settleRun(owner: Api, runId: string): Promise<string[]> {
  const notes: string[] = [];
  const get = () => owner.q<RunGet>("press.runs.get", { id: runId });
  let got = await get();
  if (got.run.status === "logged" || got.run.status === "voided") {
    // A reopen the test asked for stays a request: reject it so the run stays logged.
    for (const a of got.approvals.filter((x) => x.kind === "press_reopen" && x.status === "pending")) await owner.m("approval.decide", { id: a.id, decision: "rejected", note: "e2e cleanup" });
    return notes;
  }
  if (got.run.status === "queued" || got.run.status === "die_issued") {
    const reasons = await owner.q<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
    await owner.m("press.runs.void", { id: runId, reasonCodeId: (reasons.find((r) => r.code === "other") ?? reasons[0]!).id, note: "e2e cleanup" });
    return notes;
  }
  if (got.run.status === "running") await owner.m("press.runs.stop", { id: runId });
  got = await get();
  if (got.run.status === "stopped") await owner.m("press.runs.count", { id: runId });
  got = await get();
  for (const d of got.downtime.filter((x) => !x.stoppedAt)) await owner.m("press.downtime.stop", { id: d.id });
  for (const a of got.approvals.filter((x) => x.status === "pending" && (x.kind === "press_late_entry" || x.kind === "press_time"))) {
    await owner.m("approval.decide", { id: a.id, decision: "approved", note: "e2e cleanup" });
  }
  // Whoever opened the run (a late entry's supervisor) is its supervisor and the only one who may log it.
  await owner.m("press.runs.handover", { id: runId, supervisorId: null });
  // The smallest honest entries: one billet of the cast with most stock, one piece per released line.
  const casts = await owner.q<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
  const cast = [...casts.items].sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)[0]!;
  await owner.m("press.runs.billets", { id: runId, castId: got.run.castId ?? cast.id, rows: [{ lengthMm: 600, count: 1, kgG: 10_000 }] });
  const rows = got.planLines.length > 0 ? got.planLines.map((p) => ({ cutLengthMm: p.cutLengthMm, pcs: 1, goodG: 1000, pressPlanLineId: p.id })) : [{ cutLengthMm: 3658, pcs: 1, goodG: 1000 }];
  await owner.m("press.runs.lines", { id: runId, rows });
  await owner.m("press.runs.qc", { id: runId, rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: null }] });
  await owner.m("press.runs.close", { id: runId });
  notes.push(`${got.run.number} finished`);
  return notes;
}

/**
 * Leave the plant as it was: finish or void every run on the lines this describe made, retire the
 * lines and the die copies. Collects what fails and throws it, so a leftover is never silent.
 */
async function cleanup(created: Created) {
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
    for (const lineId of created.lines) {
      const runs = await owner.q<{ items: { id: string; number: string }[] }>("press.runs.list", { pressLineId: lineId, limit: 100 });
      for (const r of runs.items) await attempt(`settle ${r.number}`, () => settleRun(owner, r.id));
      await attempt(`retire line ${lineId}`, () => owner.m("press.lines.retire", { id: lineId }));
    }
    for (const copyId of created.copies) await attempt(`retire copy ${copyId}`, () => owner.m("dieInstance.update", { id: copyId, status: "retired" }));
    for (const orderId of created.orders) await attempt(`close order ${orderId}`, () => owner.m("orders.close", { id: orderId, reason: "e2e cleanup" }));
  } finally {
    await owner.dispose();
  }
  if (problems.length > 0) throw new Error(`e2e cleanup left things behind:\n${problems.join("\n")}`);
}

for (const width of WIDTHS) {
  test.describe(`press at ${width}`, () => {
    test.describe.configure({ mode: "serial" });
    let fx: Fixture;
    const created = newCreated();

    test.beforeAll(async () => {
      fx = await makeFixture(width, created);
    });
    test.afterAll(async () => {
      await cleanup(created);
    });

    test("line board shows P1, P2 and the test press with running and waiting counts", async ({ browser }) => {
      const { page, context } = await openAs(browser, "supervisor", width, "/press");
      await expect(page.getByRole("heading", { name: "Press", level: 1 })).toBeVisible();
      const p1 = page.locator('[data-slot="press-line"][data-line="P1"]');
      const p2 = page.locator('[data-slot="press-line"][data-line="P2"]');
      const mine = page.locator(`[data-slot="press-line"][data-line="${fx.lineCode}"]`);
      await expect(p1).toBeVisible();
      await expect(p2).toBeVisible();
      // P1 and P2 wait with the seeded queued runs (the counts are the server's); P2 has PR-10 running now
      // (PR-9, a late entry, is being counted behind it). P1 is shared with other specs that release plans on it
      // (orders, die-room-w2), so the server's cards are read again with each attempt (BACKLOG 49): the board
      // and the API are compared at the same moment, never one stale snapshot against a moving queue.
      const owner = await apiAs("owner");
      const cardsOf = async (pressLineId: string) =>
        (await owner.q<{ cards: { number: string; status: string }[] }>("press.queue.list", { pressLineId })).cards;
      const waiting = (cards: { status: string }[]) => cards.filter((c) => c.status === "queued" || c.status === "die_issued").length;
      await expect(async () => {
        const p1Cards = await cardsOf("dev-press-line-1");
        await expect(p1.getByTestId("line-waiting")).toHaveText(String(waiting(p1Cards)), { timeout: 1_500 });
      }).toPass({ timeout: 20_000 });
      const p2Cards = await cardsOf("dev-press-line-2");
      await owner.dispose();
      // The board leads with the RUNNING run (PR-10) even though the counting PR-9 comes before it in queue order.
      expect(p2Cards.map((c) => c.number)).toEqual(expect.arrayContaining(["PR-9", "PR-10"]));
      // BACKLOG 82: on the line = the one running run; counting / stopped runs are closing, on the card and in the queue header.
      const running = p2Cards.filter((c) => c.status === "running");
      const closing = p2Cards.filter((c) => c.status === "counting" || c.status === "stopped");
      expect(running).toHaveLength(1);
      await expect(p2.getByTestId("line-on-line")).toHaveText(running[0]!.number);
      await expect(p2.getByTestId("line-closing")).toContainText(closing.map((c) => c.number).join(", "));
      await expect(p2.getByTestId("line-waiting")).toHaveText(String(waiting(p2Cards)));
      await expect(mine.getByTestId("line-waiting")).toHaveText("2");
      await expect(mine.getByTestId("line-on-line")).toHaveText("Nothing running");
      // None of the demo furniture of the preview.
      for (const word of ["Sample data", "Fixture", "FP-PR"]) await expect(page.getByText(word, { exact: false })).toHaveCount(0);
      await shot(page, width, "board");
      await clean(page);
      // The P2 queue header counts the same split: one on the line (PR-10), the counting run closing.
      await page.goto("/press/lines/dev-press-line-2");
      await expect(page.getByTestId("queue-on-line-count")).toHaveText(String(running.length));
      await expect(page.getByTestId("queue-closing-count")).toHaveText(String(closing.length));
      await context.close();
    });

    test("queue shows job cards with sales order numbers, lengths, pcs and kg; waiting count equals the cards", async ({ browser }) => {
      const { page, context } = await openAs(browser, "supervisor", width, `/press/lines/${fx.lineId}`);
      await expect(page.getByRole("heading", { name: `${fx.lineCode} queue`, level: 1 })).toBeVisible();
      const cards = page.locator('[data-slot="job-card"]');
      await expect(cards).toHaveCount(2);
      await expect(page.getByTestId("queue-waiting-count")).toHaveText("2");
      await expect(page.getByTestId("queue-on-line-count")).toHaveText("0");
      await expect(page.getByTestId("queue-closing-count")).toHaveText("0");
      const ready = page.locator(`[data-slot="job-card"][data-run="${fx.ready.number}"]`);
      const queued = page.locator(`[data-slot="job-card"][data-run="${fx.queued.number}"]`);
      await expect(ready).toContainText(fx.readyOrder);
      await expect(ready).toContainText(fx.party);
      await expect(ready).toContainText("18 ft × 20 pcs");
      await expect(ready).toContainText(fx.readyCopy.code);
      await expect(ready).toContainText("Total: 20 pcs");
      await expect(queued).toContainText(fx.queuedOrder);
      await expect(queued).toContainText("12 ft × 10 pcs");
      await expect(queued).toContainText("Die not issued");
      // Filters narrow the list without renumbering it.
      await pickOption(page, page.getByLabel("Order", { exact: true }), orderNo(fx.queuedOrder));
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
      await expect(page.locator('[data-slot="released"]')).toContainText(fx.queuedOrder);
      // The line rows say "pcs" like the total does (units.pcs), never the column label "Pcs".
      await expect(page.locator('[data-slot="released"] li').first()).toContainText(/× 10 pcs · /);
      await expect(page.locator('[data-slot="released"]')).not.toContainText("Pcs");
      await expect(page.getByRole("button", { name: "Void run" })).toBeVisible();
      await shot(page, width, "station-locked");
      await clean(page);
      await context.close();

      // Void is offered to the office too (order.plan, as the server allows), not to the press man.
      const office = await openAs(browser, "office", width, `/press/runs/${fx.queued.id}`);
      await expect(office.page.getByRole("button", { name: "Void run" })).toBeVisible();
      await office.context.close();
      const pressMan = await openAs(browser, "press", width, `/press/runs/${fx.queued.id}`);
      await expect(pressMan.page.locator('[data-banner="locked"]')).toBeVisible();
      await expect(pressMan.page.getByRole("button", { name: "Void run" })).toHaveCount(0);
      await pressMan.context.close();

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
      // The shift fact keeps its date on one line ("2026-10-24" never breaks at a hyphen).
      const day = page.locator('[data-slot="run-card"] dd span.whitespace-nowrap').first();
      await expect(day).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
      expect((await day.boundingBox())!.height).toBeLessThan(30);
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
      await expect(page.locator('[data-slot="cut-row"]').first()).toContainText(fx.readyOrder);
      await page.getByLabel("Pcs", { exact: true }).fill("20");
      await page.getByLabel("Good kg", { exact: true }).fill("58.1");
      await shot(page, width, "count-pieces");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 3: butt and ends.
      await page.getByLabel("Butt kg", { exact: true }).fill("6");
      await page.getByLabel("Ends kg", { exact: true }).fill("3");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 4: rejects, 3 pieces weighing 1.7 kg for a bend.
      await page.getByLabel("Reject kg", { exact: true }).fill("1.7");
      await page.getByLabel("Reject pieces", { exact: true }).fill("3");
      await pickOption(page, page.getByLabel("Reject reason", { exact: true }), "Bend");
      await shot(page, width, "count-rejects");
      await page.getByRole("button", { name: "Save and next" }).click();
      await page.getByLabel("Press remark", { exact: true }).fill("Ram slow on the third billet");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await owner.q<{ run: { pressRemark: string | null } }>("press.runs.get", { id: fx.ready.id })).run.pressRemark).toBe("Ram slow on the third billet");

      // The same entries survive a reload: the typed draft is kept on this tablet (same step, same text)
      // and what was saved is on the server.
      await page.reload();
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();
      await expect(page.locator('[data-slot="counting"]')).toHaveAttribute("data-step", "4");
      await expect(page.getByLabel("Press remark", { exact: true })).toHaveValue("Ram slow on the third billet");
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByLabel("Weighed kg", { exact: true })).toHaveValue("77");
      await expect(page.getByLabel("Billets", { exact: true })).toHaveValue("4");
      // Nothing says another device changed the figures: this tablet saved them itself. The notice appears only
      // once the run query answers, and toHaveCount(0) passes at once, so let the network go idle first.
      await page.waitForLoadState("networkidle");
      await expect(page.locator('[data-slot="draft-stale"]')).toHaveCount(0);

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
      await expect(page.locator('[data-gate="downtime_open"]')).toContainText("Stop the open downtime first");
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
      await expect(refused).toContainText("Stop the open downtime first");
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
      // The connection drops on the first Log run: what was typed stays, and Try again sends the SAME
      // clientMutationId (a replay, never a second log).
      const sent: string[] = [];
      let drop = true;
      await page.route(/\/trpc\/press\.runs\.close/, async (route) => {
        sent.push(/"clientMutationId":"([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
        if (drop) {
          drop = false;
          return route.abort("failed");
        }
        return route.continue();
      });
      await page.getByRole("button", { name: "Log run" }).click();
      await expect(page.locator('[data-slot="save-error"]')).toContainText("Could not save. What you typed is still here.");
      await expect(page.getByLabel("Press remark", { exact: true })).toHaveValue("Ram slow on the third billet");
      await expect(page.getByTestId("preview-recovery")).toHaveText("75.5%");
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator('[data-banner="logged"]')).toBeVisible();
      expect(sent).toHaveLength(2);
      expect(sent[0]).toMatch(/\S{8,}/);
      expect(sent[1]).toBe(sent[0]);
      await page.unroute(/\/trpc\/press\.runs\.close/);
      await expect(page.getByTestId("logged-recovery")).toHaveText("75.5%");
      await expect(page.locator('[data-slot="logged"]')).toContainText(fx.readyOrder);
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
      // The 7-day rule is stated before anything is typed, and the pickers stop at its edges.
      await expect(sheet.locator('[data-slot="late-window"]')).toContainText("last 7 days");
      const minStart = await sheet.getByLabel("Started", { exact: true }).getAttribute("min");
      expect(Number(new Date(minStart!))).toBeGreaterThan(Date.now() - 7.1 * 86_400_000);
      expect(Number(new Date(minStart!))).toBeLessThan(Date.now() - 6.9 * 86_400_000);
      await sheet.getByRole("radio", { name: "A run not in the queue" }).click();
      await pickOption(page, sheet.getByLabel("Die copy"), new RegExp(`^${fx.lateCopy.code}`));
      const now = Date.now();
      await sheet.getByLabel("Started", { exact: true }).fill(localInput(now - 3 * 3_600_000));
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 2 * 3_600_000));
      // A stop before the start, and a start older than 7 days, are refused in words; nothing is sent.
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 4 * 3_600_000));
      await sheet.getByLabel("Why it is entered late").fill("Tablet was down on the night shift");
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(sheet.getByRole("alert")).toContainText("Stop must be after start.");
      await sheet.getByLabel("Started", { exact: true }).fill(localInput(now - 8 * 86_400_000));
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 8 * 86_400_000 + 3_600_000));
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(sheet.getByRole("alert")).toContainText("more than 7 days ago");
      await sheet.getByLabel("Started", { exact: true }).fill(localInput(now - 3 * 3_600_000));
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
        await expect(row).toContainText(fx.readyOrder);
        await expect(row).toContainText("75.5");
        await expect(row).toContainText("Waiting for billets");
        await expect(page.getByTestId("press-report-totals")).toContainText("75.5");
        // Without the plan filter the seeded PR-8 (logged today) is on the sheet too.
        await page.goto(`/press/report?from=${day}&to=${day}`);
        await expect(page.getByTestId("press-report-table").locator('tbody tr[data-run="PR-8"]')).toBeVisible();
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

    test("late entry of a queued run whose die was never issued: pick the copy of its die, then counting (BACKLOG 50)", async ({ browser }) => {
      test.setTimeout(90_000);
      const { page, context } = await openAs(browser, "supervisor", width, `/press/lines/${fx.lineId}`);
      await page.getByRole("button", { name: "Late entry" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("radio", { name: "A run from the queue" }).click();
      await pickOption(page, sheet.getByLabel("Queued run"), new RegExp(`^${fx.queued.number} `));
      // The run has no copy issued: the sheet asks for one (searchable), and only copies of its die.
      const copy = sheet.getByRole("combobox", { name: "Die copy", exact: true });
      await expect(copy).toBeVisible();
      await expect(sheet.locator('[data-slot="late-copy"]')).toContainText("Copies of 14701 on the rack.");
      const now = Date.now();
      await sheet.getByLabel("Started", { exact: true }).fill(localInput(now - 5 * 3_600_000));
      await sheet.getByLabel("Stopped", { exact: true }).fill(localInput(now - 4 * 3_600_000));
      await sheet.getByLabel("Why it is entered late").fill("Run pressed while the tablet was off");
      // Without a copy nothing is sent, and the sheet says what is missing (no server error).
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(sheet.getByRole("alert")).toContainText("Pick the die copy that was used.");
      // A copy of another die (Tee 13090) is not offered.
      await copy.click();
      await copy.fill(fx.readyCopy.code);
      await expect(page.getByText(`Nothing matches "${fx.readyCopy.code}"`).first()).toBeAttached();
      await copy.fill(fx.queueCopy.code);
      await page.getByRole("option", { name: fx.queueCopy.code, exact: true }).click();
      await expect(copy).toHaveValue(fx.queueCopy.code);
      await shot(page, width, "late-entry-queued");
      await sheet.getByRole("button", { name: "Enter the run" }).click();
      await expect(page).toHaveURL(new RegExp(`/press/runs/${fx.queued.id}$`), { timeout: 20_000 });
      await expect(page.locator('[data-banner="counting"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-slot="run-card"]')).toContainText("Entered late");
      await expect(page.locator('[data-slot="run-card"]')).toContainText(fx.queueCopy.code);
      const owner = await apiAs("owner");
      const got = await owner.q<RunGet>("press.runs.get", { id: fx.queued.id });
      await owner.dispose();
      expect(got.run.status).toBe("counting");
      expect(got.copy?.id).toBe(fx.queueCopy.id);
      expect(got.approvals.some((a) => a.kind === "press_late_entry" && a.status === "pending")).toBe(true);
      await clean(page);
      await context.close();
    });

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
  const created = newCreated();
  test.beforeAll(async () => {
    fx = await makeFixture(375, created);
  });
  test.afterAll(async () => {
    await cleanup(created);
  });

  test("hi: the lock banner, the ready banner and the Start button are Hindi, and the banners name the button by its Hindi word", async ({ browser }) => {
    const { page, context } = await openAs(browser, "press", 375, `/press/runs/${fx.queued.id}`, { locale: "hi" });
    await expect(page.locator('[data-banner="locked"]')).toContainText("Die जारी नहीं हुई। शुरू करना बंद है।");
    // The body names the button as the button reads ("शुरू करें"), not the Latin word.
    await expect(page.locator('[data-banner="locked"]')).toContainText("शुरू करें");
    await expect(page.locator('[data-banner="locked"]')).not.toContainText("Start");
    await clean(page);
    await page.goto(`/press/runs/${fx.ready.id}`);
    await expect(page.locator('[data-banner="ready"]')).toContainText("Die जारी हो गई");
    await expect(page.locator('[data-banner="ready"]')).toContainText("शुरू करें");
    await expect(page.locator('[data-banner="ready"]')).not.toContainText("Start");
    await expect(page.getByRole("button", { name: "शुरू करें", exact: true })).toBeVisible();
    await shot(page, 375, "station-hi");
    await clean(page);
    await context.close();
  });

  test("gu: the same screens in Gujarati, through counting, no sideways scroll", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, context } = await openAs(browser, "press", 375, `/press/runs/${fx.ready.id}`, { locale: "gu" });
    await expect(page.locator('[data-banner="ready"]')).toContainText("Die જારી થઈ ગઈ");
    await expect(page.locator('[data-banner="ready"]')).toContainText("શરૂ કરો");
    await expect(page.locator('[data-banner="ready"]')).not.toContainText("Start");
    await shot(page, 375, "station-gu-ready");
    await clean(page);
    await page.getByRole("button", { name: "શરૂ કરો", exact: true }).click();
    await expect(page.locator('[data-banner="running"]')).toBeVisible();
    await expect(page.getByTestId("started-at")).toContainText("શરૂ");
    await shot(page, 375, "station-gu-running");
    await clean(page);
    // Review I-2: a standard stop reason reads Gujarati in the picker AND in the downtime list
    // (the list must carry the `standard` flag, or the row falls back to the English wording).
    await page.getByRole("button", { name: "પ્રેસ બંધ થયું", exact: true }).click();
    const stopSheet = page.getByRole("dialog");
    await pickOption(page, stopSheet.getByLabel("કેમ અટક્યું"), "બિલેટની રાહ");
    await stopSheet.getByRole("button", { name: "પ્રેસ બંધ થયું" }).click();
    const openStop = page.locator('[data-slot="downtime"] li[data-open="true"]');
    await expect(openStop).toContainText("બિલેટની રાહ");
    await expect(openStop).not.toContainText("Waiting for billets");
    await page.getByRole("button", { name: "પ્રેસ ફરી ચાલુ" }).click();
    await expect(page.locator('[data-slot="downtime"] li[data-open="false"]')).toContainText("બિલેટની રાહ");
    await page.getByRole("button", { name: "રોકો", exact: true }).click();
    await page.getByRole("button", { name: "ગણતરી અને તપાસ" }).click();
    await expect(page.locator('[data-banner="counting"]')).toBeVisible();
    // The first counting step in Gujarati: the cast picker and the step names are the screen's words.
    await expect(page.getByLabel("બિલેટ કઈ cast ના છે")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-slot="counting"]')).toContainText("બિલેટ");
    // Gujarati falls back to English per key; a raw key (`nav.today`, `press.queue.title`) must never show.
    await expect(page.locator("body")).not.toContainText(/\b(nav|ui|press|common|units)\.[a-zA-Z]+/);
    await shot(page, 375, "station-gu-count");
    await clean(page);
    await context.close();
  });

  test("gu: Today's press tile is Gujarati, not the English fallback (BACKLOG 54)", async ({ browser }) => {
    const { page, context } = await openAs(browser, "supervisor", 375, "/today", { locale: "gu" });
    const tile = page.getByTestId("today-press");
    await expect(tile).toBeVisible();
    for (const gu of ["પ્રેસ", "પ્રેસનો સારાંશ ખોલો", "આજે પ્રેસ થયું", "રિકવરી", "બંધ સમય", "પછીથી ભરેલા"]) await expect(tile).toContainText(gu);
    for (const en of ["Open the press summary", "Pressed today", "Downtime", "Entered late", "Recovery"]) await expect(tile).not.toContainText(en);
    await expect(tile).not.toContainText(/\b(today|press|units)\.[a-zA-Z]+/);
    await shot(page, 375, "today-press-gu");
    await clean(page);
    await context.close();
  });

  test("hi: the counting stepper and a refused close read Hindi; no server English reaches the screen", async ({ browser }) => {
    test.setTimeout(90_000);
    // The figures are in (as the press man would have saved them); one stoppage is left open.
    const owner = await apiAs("owner");
    try {
      const casts = await owner.q<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
      const cast = [...casts.items].sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)[0]!;
      const got = await owner.q<RunGet>("press.runs.get", { id: fx.ready.id });
      await owner.m("press.runs.billets", { id: fx.ready.id, castId: cast.id, rows: [{ lengthMm: 600, count: 1, kgG: 10_000 }] });
      await owner.m("press.runs.lines", { id: fx.ready.id, rows: got.planLines.map((p) => ({ cutLengthMm: p.cutLengthMm, pcs: 1, goodG: 1000, pressPlanLineId: p.id })) });
      await owner.m("press.runs.qc", { id: fx.ready.id, rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: null }] });
      const reasons = await owner.q<{ id: string; code: string }[]>("press.reasons", { kind: "downtime" });
      await owner.m("press.downtime.start", { pressLineId: fx.lineId, pressRunId: fx.ready.id, reasonCodeId: reasons.find((r) => r.code !== "other")!.id });
    } finally {
      await owner.dispose();
    }
    const { page, context } = await openAs(browser, "supervisor", 375, `/press/runs/${fx.ready.id}`, { locale: "hi" });
    await expect(page.locator('[data-banner="counting"]')).toBeVisible();
    await toLastStep(page, { next: "सेव करें और आगे", remark: "प्रेस टिप्पणी" });
    // The press was left with a stoppage open, so the close is refused; the sentences are Hindi.
    await page.getByRole("button", { name: "रन दर्ज करें" }).click();
    const refused = page.locator('[data-slot="close-refused"]');
    await expect(refused).toContainText("रन दर्ज नहीं हुआ।");
    await expect(refused).toContainText("पहले खुली रुकावट बंद करें");
    await expect(refused.locator('[data-slot="error-detail"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="counting"]')).not.toContainText(/Stop the open downtime|The run was not logged|Only a supervisor/);
    await shot(page, 375, "close-refused-hi");
    await clean(page);
    await context.close();
  });
});

test.describe("press as a manager (press.close without press.run) at 820", () => {
  test.describe.configure({ mode: "serial" });
  const MEMBERSHIP = "dev-membership-operator";
  let fx: Fixture;
  const created = newCreated();
  const setRole = async (role: "manager" | "operator") => {
    const owner = await apiAs("owner");
    try {
      await owner.m("company.membersUpdateRole", { membershipId: MEMBERSHIP, role });
    } finally {
      await owner.dispose();
    }
  };

  test.beforeAll(async () => {
    // The seed has no manager: re-role the unused `operator` member until afterAll puts it back.
    await setRole("manager");
    fx = await makeFixture(820, created);
    // The press man runs the press and enters every figure; the manager only reads and logs.
    const press = await apiAs("press");
    try {
      await press.m("press.runs.start", { id: fx.ready.id });
      await press.m("press.runs.stop", { id: fx.ready.id });
      await press.m("press.runs.count", { id: fx.ready.id });
      const casts = await press.q<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
      const cast = [...casts.items].sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)[0]!;
      const got = await press.q<RunGet>("press.runs.get", { id: fx.ready.id });
      await press.m("press.runs.billets", { id: fx.ready.id, castId: cast.id, rows: [{ lengthMm: 600, count: 4, kgG: 77_000 }] });
      await press.m("press.runs.lines", { id: fx.ready.id, rows: got.planLines.map((p) => ({ cutLengthMm: p.cutLengthMm, pcs: 20, goodG: 58_100, pressPlanLineId: p.id })) });
      await press.m("press.runs.scrap", { id: fx.ready.id, discardG: 6000, endsG: 3000 });
      await press.m("press.runs.qc", { id: fx.ready.id, rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: null }] });
    } finally {
      await press.dispose();
    }
  });
  test.afterAll(async () => {
    try {
      await cleanup(created);
    } finally {
      await setRole("operator");
    }
  });

  test("a manager sees the counting panel read-only, can Log run, and has no Start, Save or Handover", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, context } = await openAs(browser, "operator", 820, `/press/runs/${fx.ready.id}`);
    await expect(page.locator('[data-banner="counting"]')).toBeVisible();
    const counting = page.locator('[data-slot="counting"]');
    await expect(counting).toBeVisible();
    // Read-only: the figures the press man saved are there, but cannot be edited by this role.
    await expect(page.getByLabel("Weighed kg", { exact: true })).toHaveValue("77");
    await expect(page.getByLabel("Weighed kg", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save and next" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Handover" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
    await toLastStep(page, { next: "Next", remark: "Press remark" });
    await expect(page.getByLabel("Press remark", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(page.getByText("A supervisor logs this run.")).toHaveCount(0);
    await expect(page.getByTestId("preview-recovery")).toHaveText("75.5%");
    await expect(page.getByText("Ready to log.")).toBeVisible();
    await shot(page, 820, "count-last-manager");
    await clean(page);
    await page.getByRole("button", { name: "Log run" }).click();
    await expect(page.locator('[data-banner="logged"]')).toBeVisible();
    await expect(page.getByTestId("logged-recovery")).toHaveText("75.5%");
    await expect(page.getByRole("button", { name: "Request reopen" })).toBeVisible();
    await clean(page);
    await context.close();
  });
});
