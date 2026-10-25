import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { localPassword, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * The whole chain, end to end (MISSION §9 Definition of Done): order → plan → die issue → press →
 * [ageing] → pack → hold → dispatch → packing list → party portal, with the ledger balanced.
 *
 * One serial chain per width (375 phone, 820 the press-station tablet, 1280 desk). Each chain owns
 * everything it touches, made through the owner's API in `beforeAll` and undone in `afterAll` (which
 * runs when a step fails too): its own section CHAIN/CH… with a 11.500–12.500 kg/12 ft band and three
 * die copies (A presses; B is the next run's preheating copy; C is the third copy D29 refuses), its own
 * party (lifelong party numbers) and a second party with one bundle of the section, its own press line
 * with the production run and two sample runs, and its own cast with 400 kg of billets from one melt.
 *
 * The figures the chain sets up and asserts exactly:
 * - Order: 8,000 kg of the section at 12 ft; the server's quote on the band start 11.500 kg/12 ft is
 *   696 pcs weighing 8,004.000 kg.
 * - Press (specs §E3 worked example): 310.4 kg of billets in, 234.2 kg good (20 pcs), butt 30.0, ends
 *   14.8, no rejects: recovery 7545 bp = 75.5 %, balance 31.4 kg.
 * - Pack: three bundles of 6 pcs at 12 ft: 69.60 kg (11.599 kg/12 ft → Range/12' 11.6), 69.50 kg
 *   (11.582 → 11.5, where plain rounding would print 11.6) and 69.04 kg (11.505 → 11.5): 208.14 kg; one
 *   reject row of 2 pcs, 1.5 kg (bend).
 * - Hold: the 69.04 kg bundle for the line. Dispatch: the other two, 139.10 kg.
 * - Ledger: BILLET for the cast +400.0 (melt) −310.4 (press) = 89.6 kg; PLANT-SCRAP +30.0 (DISCARD) +14.8
 *   (PLANT-SCRAP) from the press and +1.5 from the pack reject; the yard holds 208.14 − 139.10 = 69.04 kg
 *   of the chain's bundles. Strip: ordered 8,000, pressed 234.2 at log (26.06 after packing, §E2:
 *   logged − aged − produced), produced 208.14, dispatched 139.10, held 69.04 (1 bundle), baki 7,860.90.
 *
 * Ageing is paused on the satellite: that step is a visible skip.
 *
 * Global setting touched: `requireCastOnBundle` is set Off before the melt is locked (as portal.spec does),
 * because the seed's "automatic" rule would otherwise turn on for every spec packing without a cast.
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const WIDTHS = [375, 820, 1280] as const;
const SHOTS = process.env.CHAIN_SHOTS_DIR;

const FT12_MM = 3658;
const ORDER_KG_G = 8_000_000;
const BAND = { minG: 11_500, maxG: 12_500 };
/** The three bundles, in the order they are packed. */
const BUNDLES = [
  { kg: "69.60", g: 69_600, range: "11.6", k12: "11.599" },
  { kg: "69.50", g: 69_500, range: "11.5", k12: "11.582" },
  { kg: "69.04", g: 69_040, range: "11.5", k12: "11.505" },
] as const;
const PCS_PER_BUNDLE = 6;
const PACKED_G = 69_600 + 69_500 + 69_040; // 208,140
const DISPATCHED_G = 69_600 + 69_500; // 139,100
const HELD_G = 69_040;
const PRESS = { inputG: 310_400, goodG: 234_200, pcs: 20, buttG: 30_000, endsG: 14_800, billets: 6 };
const MELT = { inG: 410_000, logsG: 400_000 };
const REJECT = { pcs: 2, g: 1_500 };

type Api = {
  q<T>(path: string, input?: unknown): Promise<T>;
  m<T>(path: string, input?: unknown): Promise<T>;
  /** A call expected to be refused: status and the server's sentence. */
  refused(path: string, input: unknown): Promise<{ status: number; message: string }>;
  dispose(): Promise<void>;
};

async function apiAs(role: LocalRole | { email: string; password: string }): Promise<Api> {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
  const creds = typeof role === "string" ? { email: `${role}@orrn.local`, password: localPassword() } : role;
  const login = await ctx.post(`${API}/api/auth/sign-in/email`, { data: creds });
  expect(login.ok(), `sign-in as ${creds.email} returned ${login.status()}`).toBe(true);
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
    async refused(path: string, input: unknown) {
      const res = await ctx.post(`${API}/trpc/${path}`, { data: input });
      const body = (await res.json()) as { error?: { message?: string } };
      return { status: res.status(), message: body.error?.message ?? "" };
    },
    dispose: () => ctx.dispose(),
  };
}

/** Runs `work` with a fresh API context of `role`, then closes it. */
async function withApi<T>(role: LocalRole, work: (api: Api) => Promise<T>): Promise<T> {
  const api = await apiAs(role);
  try {
    return await work(api);
  } finally {
    await api.dispose();
  }
}

/** A fresh browser context signed in as `role` (or a party login), at `width`, on `path`. */
async function openAs(browser: Browser, role: LocalRole, width: number, path: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  const res = await page.context().request.post(`${API}/api/auth/sign-in/email`, {
    headers: { origin: ORIGIN },
    data: { email: `${role}@orrn.local`, password: localPassword() },
  });
  expect(res.ok(), `sign-in as ${role} returned ${res.status()}`).toBe(true);
  await page.goto(path);
  // A cold Vite on a loaded machine can take longer than the 5 s default to paint.
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  return { page, context };
}

async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

async function shot(page: Page, width: number, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
}

async function pickOption(page: Page, trigger: ReturnType<Page["getByLabel"]>, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
}

/** "8,000.000" — kg with three decimals, Indian grouping, as the order screens print it. */
const kg3 = (g: number) => (g / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The plant's Range/12' (memory §2, AGENTS.md): floor((kg/12ft + 0.01) × 10) / 10 on the RAW kg per
 * 12 ft = weightG × 3657.6 / (1000 × pcs × lengthMm), evaluated on integers so no float edge decides it.
 */
function rangeOf(weightG: number, pcs: number, lengthMm: number): string {
  const tenths = Math.floor((weightG * 36_576 + 100 * pcs * lengthMm) / (1000 * pcs * lengthMm));
  return (tenths / 10).toFixed(1);
}

type Strip = {
  orderedG: number;
  orderedPcs: number | null;
  producedG: number;
  dispatchedG: number;
  bakiG: number;
  plannedG: number;
  pressedG: number;
  agedG: number;
  packedG: number;
  inStockG: number;
  heldG: number;
  heldBundles: number;
  overG: number;
  planableG: number;
};

type Balance = { items: { itemKind: string; itemRef: string; locationId: string | null; qtyG: number | null }[] };
const sumG = (b: Balance) => b.items.reduce((s, i) => s + (i.qtyG ?? 0), 0);

type Chain = {
  tag: string;
  sectionId: string;
  sectionCode: string;
  copies: { a: { id: string; code: string }; b: { id: string; code: string }; c: { id: string; code: string } };
  party: { id: string; name: string };
  other: { id: string; name: string; orderId: string; bundleSerial: string };
  lineId: string;
  lineCode: string;
  lineName: string;
  cast: { id: string; number: string; meltAt: number };
  streams: { plantScrap: string; discard: string };
  yardId: string;
  /** Filled as the chain goes. */
  order?: { id: string; number: string; po: string; lineId: string };
  run?: { id: string; number: string };
  sampleRuns: { id: string; number: string }[];
  loggedAt?: number;
  bundles?: { id: string; serial: string; partyNo: string | null; weightG: number }[];
  packedAt?: number;
  dispatch?: { id: string; code: string };
  otherDispatchId?: string;
  portal?: { email: string; password: string; portalUserId: string };
};

/** What a chain has made, filled as it goes, so a half-built chain is still cleaned. */
type Created = {
  sections: string[];
  copies: string[];
  lines: string[];
  orders: string[];
  casts: string[];
  dispatches: string[];
  bundles: { id: string; serial: string }[];
  portalUsers: string[];
};
const newCreated = (): Created => ({ sections: [], copies: [], lines: [], orders: [], casts: [], dispatches: [], bundles: [], portalUsers: [] });

async function makeChain(width: number, created: Created): Promise<Chain> {
  return withApi("owner", async (owner) => {
    const tag = `${width}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    // The section of this chain, with the band the order quotes on and three copies.
    const sectionCode = `CH${tag}`;
    const section = await owner.m<{ id: string }>("die.create", {
      series: "CHAIN",
      sectionCode,
      name: `Chain e2e ${width}`,
      weightMinG: BAND.minG,
      weightMaxG: BAND.maxG,
      profileKind: "solid",
      alloy: "6063",
      temper: "T5",
    });
    created.sections.push(section.id);
    const copy = async () => {
      const c = await owner.m<{ id: string; code: string }>("dieInstance.create", { sectionId: section.id, status: "available" });
      created.copies.push(c.id);
      return c;
    };
    const copies = { a: await copy(), b: await copy(), c: await copy() };

    // The party, with its own (lifelong) bundle numbers, and another party with one bundle of the section.
    const party = { name: `Chain ${tag} Traders`, id: "" };
    party.id = (
      await owner.m<{ id: string }>("customer.create", {
        name: party.name,
        phone: null,
        billingAddress: { line1: "Plot 7", city: `Chainpur ${tag}`, state: "Gujarat", postalCode: "395003", country: "India" },
      })
    ).id;
    await owner.m("customer.update", { id: party.id, name: party.name, bundleNumberPolicy: "lifelong" });
    const otherName = `Other ${tag} Metals`;
    const otherId = (await owner.m<{ id: string }>("customer.create", { name: otherName, phone: null })).id;
    const otherOrder = await owner.m<{ id: string }>("orders.create", {
      customerId: otherId,
      poNumber: `OTH-${tag}`,
      lines: [{ sectionId: section.id, cutLengthMm: FT12_MM, qtyBasis: "pcs", pcs: 10, tierRank: 1 }],
    });
    created.orders.push(otherOrder.id);
    const otherLine = (await owner.q<{ lines: { lineId: string }[] }>("orders.get", { id: otherOrder.id })).lines[0]!.lineId;

    // The press line of this chain.
    const lineCode = `CH${tag}`.slice(0, 12);
    const lineName = `Chain press ${width}`;
    const line = await owner.m<{ id: string }>("press.lines.create", { code: lineCode, name: lineName, sortOrder: 950 });
    created.lines.push(line.id);

    // The cast and its billets: one locked melt of 410 kg of ingot giving 400 kg of logs (2.4 % loss).
    // The cast rule goes Off first (the seed's "automatic" turns on with any locked melt; portal.spec does the same).
    await owner.m("company.updateSettings", { requireCastOnBundle: false });
    const cast = await owner.m<{ id: string; number: string }>("foundry.casts.open", { alloy: "6063" });
    created.casts.push(cast.id);
    const streams = await owner.q<{ items: { id: string; code: string }[] }>("foundry.returnStreams.list");
    const byCode = (code: string) => streams.items.find((s) => s.code === code)!.id;
    const t = Date.now();
    const min = 60_000;
    await owner.m("foundry.melts.create", {
      castId: cast.id,
      timestamps: { preheatStart: t - 300 * min, chargingStart: t - 240 * min, chargingEnd: t - 200 * min, castingStart: t - 150 * min, castingEnd: t - 60 * min },
      ldoTenthIn: { start: 300, end: 250 },
      inputs: [{ kind: "return_stream", ref: byCode("INGOT"), kgG: MELT.inG }],
      outputs: { logs: { pcs: 8, lengthMm: 600, kgG: MELT.logsG }, drossG: 0, feG: 0, returns: [] },
    });
    const melt = await owner.q<{ items: { id: string; billetsOnHandG: number; number: string }[] }>("foundry.casts.list", { limit: 200 });
    expect(melt.items.find((c) => c.id === cast.id)?.billetsOnHandG).toBe(MELT.logsG);

    const locations = await owner.q<{ items: { id: string; code: string }[] }>("stock.locations.list", {});
    const yardId = locations.items.find((l) => l.code === "Y2")!.id;
    // The other party's bundle (packed for its own order) that the chain's dispatch must refuse.
    const otherPack = await owner.m<{ bundles: { id: string; serial: string }[] }>("bundle.createReceipt", {
      dieId: section.id,
      unit: "inch",
      locationId: yardId,
      salesOrderLineId: otherLine,
      castId: cast.id,
      rows: [{ quantity: 6, weightG: 69_300, lengthMm: FT12_MM }],
    });
    created.bundles.push(otherPack.bundles[0]!);

    return {
      tag,
      sectionId: section.id,
      sectionCode,
      copies,
      party,
      other: { id: otherId, name: otherName, orderId: otherOrder.id, bundleSerial: otherPack.bundles[0]!.serial },
      lineId: line.id,
      lineCode,
      lineName,
      cast: { id: cast.id, number: cast.number, meltAt: t },
      streams: { plantScrap: byCode("PLANT-SCRAP"), discard: byCode("DISCARD") },
      yardId,
      sampleRuns: [],
    };
  });
}

/**
 * Leave the plant as it was: every run of the chain's press finished or voided, the press and the die
 * copies retired, the section archived, the orders closed (releasing the hold), open dispatches cancelled,
 * stray bundles voided, the party's login turned off and the cast closed. Collects what fails and throws it.
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
    const voidReasons = await owner.q<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
    const runVoid = (voidReasons.find((r) => r.code === "other") ?? voidReasons[0])!.id;
    for (const lineId of created.lines) {
      const runs = await owner.q<{ items: { id: string; number: string; status: string }[] }>("press.runs.list", { pressLineId: lineId, limit: 100 });
      for (const r of runs.items) {
        if (r.status === "queued" || r.status === "die_issued") {
          await attempt(`void ${r.number}`, () => owner.m("press.runs.void", { id: r.id, reasonCodeId: runVoid, note: "e2e cleanup" }));
        } else if (r.status !== "logged" && r.status !== "voided") {
          problems.push(`${r.number} left ${r.status}`);
        }
      }
      await attempt(`retire line ${lineId}`, () => owner.m("press.lines.retire", { id: lineId }));
    }
    for (const id of created.dispatches) {
      const d = await owner.q<{ dispatch: { status: string } }>("dispatch.getDispatch", { id }).catch(() => null);
      if (d && d.dispatch.status !== "completed" && d.dispatch.status !== "cancelled") await attempt(`cancel dispatch ${id}`, () => owner.m("dispatch.cancel", { id }));
    }
    for (const id of created.orders) await attempt(`close order ${id}`, () => owner.m("orders.close", { id, reason: "e2e cleanup" }).catch((e) => (String(e).includes("closed") ? null : Promise.reject(e))));
    // Bundles the chain leaves in the yard (the held one, the other party's) are voided: no test stock stays behind.
    for (const b of created.bundles) {
      await attempt(`void bundle ${b.serial}`, async () => {
        const got = await owner.q<{ bundle: { status: string } }>("bundle.getBySerial", { serial: b.serial });
        if (got.bundle.status === "available") await owner.m("bundle.transitionStatus", { id: b.id, toStatus: "void", reason: "e2e cleanup" });
      });
    }
    for (const id of created.portalUsers) await attempt(`revoke portal login ${id}`, () => owner.m("portal.users.revoke", { id }));
    for (const id of created.copies) await attempt(`retire copy ${id}`, () => owner.m("dieInstance.update", { id, status: "retired" }));
    for (const id of created.sections) {
      await attempt(`archive section ${id}`, async () => {
        const got = await owner.q<{ items: { id: string; series: string; sectionCode: string; weightMinG: number; weightMaxG: number }[] }>("die.list", { search: "CHAIN", limit: 100 });
        const s = got.items.find((x) => x.id === id);
        if (s) await owner.m("die.update", { id, series: s.series, sectionCode: s.sectionCode, weightMinG: s.weightMinG, weightMaxG: s.weightMaxG, status: "archived" });
      });
    }
    // The cast stays open, as portal.spec's do: its close-out would ask for a reason today (see the report's
    // findings: `foundry.casts.close` does not credit the billets the press consumed), and a reason opens an
    // approval in the plant's inbox.
  } finally {
    await owner.dispose();
  }
  if (problems.length > 0) throw new Error(`chain cleanup left things behind:\n${problems.join("\n")}`);
}

for (const width of WIDTHS) {
  test.describe(`chain at ${width}`, () => {
    test.describe.configure({ mode: "serial", timeout: 120_000 });
    let fx: Chain;
    const created = newCreated();

    test.beforeAll(async () => {
      test.setTimeout(90_000);
      fx = await makeChain(width, created);
    });
    test.afterAll(async () => {
      test.setTimeout(90_000);
      await cleanup(created);
    });

    test("office books 8 t at 12 ft: typing kg quotes the pieces from the band start, then confirms with the PO", async ({ browser }) => {
      const { page, context } = await openAs(browser, "office", width, "/orders/new");
      const po = `CHAIN-${fx.tag}`;
      await page.getByRole("combobox", { name: "Customer" }).fill(fx.party.name.slice(0, 14));
      await page.getByRole("option", { name: new RegExp(escape(fx.party.name)) }).first().click();
      await page.getByRole("textbox", { name: "PO number" }).fill(po);
      await page.getByRole("combobox", { name: "Die", exact: true }).fill(fx.sectionCode);
      await page.getByRole("option", { name: new RegExp(escape(fx.sectionCode)) }).first().click();
      await page.getByLabel("Die copy").selectOption({ label: "Tier 1 or better" });
      await page.getByRole("button", { name: "12 ft" }).click();
      await page.getByRole("textbox", { name: "kg", exact: true }).fill("8000");
      // The server's quote on the band start (no reading yet): 8,000 kg at 11.500 kg/12 ft = 696 pcs, 8,004 kg.
      await expect(page.getByRole("textbox", { name: "Pieces" })).toHaveValue("696");
      await expect(page.locator("[data-quote]")).toContainText("696 pcs weigh 8,004.000 kg. You typed 8,000.000 kg.");
      await expect(page.locator("[data-quote]")).toContainText("11.500 kg/12ft");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "order-new");
      await page.getByRole("button", { name: "Book order" }).click();
      await expect(page).toHaveURL(/\/orders\/(?!new)[^/]+$/);
      const id = new URL(page.url()).pathname.split("/").pop()!;
      created.orders.push(id);
      await expect(page.getByText("Booking", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Confirm order" }).click();
      await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
      const got = await withApi("owner", (o) =>
        o.q<{ order: { number: string; status: string; poNumber: string }; lines: { lineId: string }[]; lineDetails: { qtyBasis: string; impliedG: number; strip: Strip }[] }>("orders.get", { id }),
      );
      expect(got.order).toMatchObject({ status: "confirmed", poNumber: po });
      expect(got.lineDetails[0]).toMatchObject({ qtyBasis: "kg", impliedG: 8_004_000 });
      expect(got.lineDetails[0]!.strip).toMatchObject({ orderedG: ORDER_KG_G, orderedPcs: 696, plannedG: 0, bakiG: ORDER_KG_G, planableG: ORDER_KG_G });
      fx.order = { id, number: got.order.number, po, lineId: got.lines[0]!.lineId };
      await expect(page.locator("[data-order-line='1'] [data-strip='orderedG']")).toContainText("8,000.000 kg");
      await expect(page.locator("[data-order-line='1'] [data-strip='orderedG']")).toContainText("696 pcs");
      await shot(page, width, "order-confirmed");
      await context.close();
    });

    test("the office plans the line on the chain's press and releases it: one queued run", async ({ browser }) => {
      const order = fx.order!;
      let planId: string;
      if (width === 375) {
        // A phone gets a note instead of the board; the plan is made from a bigger screen (here, the API).
        const { page, context } = await openAs(browser, "office", width, "/orders/plan");
        await expect(page.locator("[data-bigger-screen]")).toContainText("Use a bigger screen");
        await expectNoHorizontalScroll(page);
        await context.close();
        planId = await withApi("office", async (office) => {
          const now = Date.now();
          const plan = await office.m<{ id: string }>("plans.create", {
            windowStart: now,
            windowEnd: now + 8 * 3_600_000,
            pressLineId: fx.lineId,
            dies: [{ sectionId: fx.sectionId, lines: [{ salesOrderLineId: order.lineId }] }],
          });
          await office.m("plans.release", { id: plan.id });
          return plan.id;
        });
      } else {
        const { page, context } = await openAs(browser, "office", width, "/orders/plan");
        await settled(page);
        await page.getByRole("textbox", { name: "Search open lines" }).fill(order.po);
        const candidate = page.locator(`[data-candidate='${order.number}']`);
        await expect(candidate).toContainText(fx.party.name);
        await candidate.getByRole("button", { name: "Add" }).click();
        await expect(page.locator("[data-draft-die]")).toHaveCount(1);
        await page.getByRole("combobox", { name: "Press", exact: true }).selectOption({ label: `${fx.lineCode} · ${fx.lineName}` });
        await page.getByRole("button", { name: "Save draft plan" }).click();
        await expect(page).toHaveURL(/\/orders\/plan\/[^/]+$/);
        planId = new URL(page.url()).pathname.split("/").pop()!;
        await page.getByRole("button", { name: "Release to press" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Release to press" }).click();
        await expect(page.locator("[data-plan-status='released']")).toBeVisible();
        await expect(page.locator("[data-run]")).toContainText(/PR-\d+ · Queued/);
        await expectNoHorizontalScroll(page);
        await shot(page, width, "plan-released");
        await context.close();
      }
      const plan = await withApi("owner", (o) => o.q<{ plan: { status: string }; runs: { id: string; status: string; number: string }[] }>("plans.get", { id: planId }));
      expect(plan.plan.status).toBe("released");
      expect(plan.runs).toHaveLength(1);
      expect(plan.runs[0]).toMatchObject({ status: "queued" });
      fx.run = { id: plan.runs[0]!.id, number: plan.runs[0]!.number };
      const strip = await withApi("owner", (o) => o.q<{ lineDetails: { strip: Strip }[] }>("orders.get", { id: order.id }));
      expect(strip.lineDetails[0]!.strip).toMatchObject({ plannedG: ORDER_KG_G, planableG: 0, pressedG: 0 });
    });

    test("die room issues copy A to the run; copy B may preheat for the next run; a third copy is refused (D29)", async ({ browser }) => {
      const run = fx.run!;
      // Two more runs of the section on the chain's press (sample plans need no order line).
      await withApi("owner", async (owner) => {
        for (let i = 0; i < 2; i += 1) {
          const start = Date.now();
          const p = await owner.m<{ id: string }>("plans.create", {
            pressLineId: fx.lineId,
            windowStart: start,
            windowEnd: start + 3_600_000,
            purpose: "sample",
            dies: [{ sectionId: fx.sectionId, lines: [] }],
          });
          const rel = await owner.m<{ runs: { id: string; number: string }[] }>("plans.release", { id: p.id });
          fx.sampleRuns.push({ id: rel.runs[0]!.id, number: rel.runs[0]!.number });
        }
      });

      // Before the issue the press man's station is locked.
      const press = await openAs(browser, "press", width, `/press/runs/${run.id}`);
      await expect(press.page.locator('[data-banner="locked"]')).toContainText("Die not issued. Start is locked.");
      await expect(press.page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);

      const { page, context } = await openAs(browser, "dieroom", width, "/dies/issues");
      const form = page.getByTestId("issue-form");
      const copyBox = form.getByRole("combobox", { name: "Copy", exact: true });
      await copyBox.click();
      await copyBox.fill(fx.copies.a.code);
      await page.getByRole("option", { name: new RegExp(`^${escape(fx.copies.a.code)}\\b`) }).first().click();
      await form.getByRole("combobox", { name: "Press run" }).click();
      await page.getByRole("option", { name: new RegExp(`^${escape(run.number)} `) }).click();
      await expect(form.getByRole("combobox", { name: "Press line" })).toContainText(fx.lineCode);
      await form.getByRole("button", { name: "Issue", exact: true }).click();
      const mine = page.getByTestId("open-issues").getByTestId(`issue-${fx.copies.a.code}`);
      await expect(mine).toContainText(`Issued to ${fx.lineCode}`);
      await expect(mine).toContainText(run.number);
      await expectNoHorizontalScroll(page);
      await shot(page, width, "die-issued");
      await context.close();

      await withApi("dieroom", async (dr) => {
        const [next, third] = fx.sampleRuns;
        // B preheats for the next run: allowed.
        await dr.m("dieInstance.issues.issue", { dieInstanceId: fx.copies.b.id, pressLineId: fx.lineId, pressRunId: next!.id });
        // A third copy on the same press is refused, naming both.
        const refused = await dr.refused("dieInstance.issues.issue", { dieInstanceId: fx.copies.c.id, pressLineId: fx.lineId, pressRunId: third!.id });
        expect(refused.status).toBe(409);
        expect(refused.message).toBe(
          `${fx.lineCode} already has ${fx.copies.a.code} (${run.number}) and ${fx.copies.b.code} (${next!.number}). Take one back before issuing ${fx.copies.c.code}.`,
        );
      });
      const got = await withApi("owner", (o) => o.q<{ run: { status: string; dieInstanceId: string | null } }>("press.runs.get", { id: run.id }));
      expect(got.run).toMatchObject({ status: "die_issued", dieInstanceId: fx.copies.a.id });

      // The press man's lock banner is gone.
      await press.page.reload();
      await expect(press.page.locator('[data-banner="ready"]')).toContainText("Die issued. Ready to start.");
      await expect(press.page.locator('[data-banner="locked"]')).toHaveCount(0);
      await press.context.close();
    });

    test("press man starts, stops and counts: billets of the cast, pieces on the order line, butt and ends, no rejects", async ({ browser }) => {
      test.setTimeout(150_000);
      const run = fx.run!;
      const { page, context } = await openAs(browser, "press", width, `/press/runs/${run.id}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.locator('[data-banner="running"]')).toBeVisible();
      await expect(page.locator('[data-banner="ready"]')).toHaveCount(0);
      await expect(page.getByTestId("started-at")).toHaveText(/^Started \d{2}:\d{2}$/);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.locator('[data-banner="stopped"]')).toBeVisible();
      await page.getByRole("button", { name: "Count & check" }).click();
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();

      // Step 1: billets of the chain's cast, 6 weighing 310.4 kg.
      await pickOption(page, page.getByLabel("Cast the billets came from"), new RegExp(`^${escape(fx.cast.number)} · `));
      await page.getByLabel("Billets", { exact: true }).fill(String(PRESS.billets));
      await page.getByLabel("Weighed kg", { exact: true }).fill("310.4");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 2: pieces on the order line the plan released.
      await expect(page.locator('[data-slot="cut-row"]').first()).toContainText(fx.order!.number);
      await page.getByLabel("Pcs", { exact: true }).fill(String(PRESS.pcs));
      await page.getByLabel("Good kg", { exact: true }).fill("234.2");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 3: butt and ends.
      await page.getByLabel("Butt kg", { exact: true }).fill("30");
      await page.getByLabel("Ends kg", { exact: true }).fill("14.8");
      await page.getByRole("button", { name: "Save and next" }).click();
      // Step 4: the QC check found nothing (one zero-reject row).
      await page.getByRole("button", { name: "No rejects" }).click();
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(page.getByLabel("Press remark", { exact: true })).toBeVisible();
      // The press man never logs.
      await expect(page.getByRole("button", { name: "Log run" })).toHaveCount(0);
      await expect(page.getByText("A supervisor logs this run.")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, width, "station-counted");
      await context.close();

      const got = await withApi("owner", (o) =>
        o.q<{ run: { status: string; castId: string }; billets: { count: number; kgG: number }[]; lines: { pcs: number; goodG: number; salesOrderLineId: string | null }[]; qc: { pcs: number; kgG: number }[] }>("press.runs.get", { id: run.id }),
      );
      expect(got.run).toMatchObject({ status: "counting", castId: fx.cast.id });
      expect(got.billets.map((b) => [b.count, b.kgG])).toEqual([[PRESS.billets, PRESS.inputG]]);
      expect(got.lines.map((l) => [l.pcs, l.goodG])).toEqual([[PRESS.pcs, PRESS.goodG]]);
      expect(got.qc.map((q) => [q.pcs, q.kgG])).toEqual([[0, 0]]);
    });

    test("supervisor logs the run with the worked figures: 310.4 in, 234.2 good, recovery 75.5 %, balance 31.4 kg", async ({ browser }) => {
      const run = fx.run!;
      const { page, context } = await openAs(browser, "supervisor", width, `/press/runs/${run.id}`);
      await expect(page.locator('[data-banner="counting"]')).toBeVisible();
      await expect(page.locator('[data-slot="counting"]')).toBeVisible({ timeout: 20_000 });
      for (let i = 0; i < 5; i++) {
        const next = page.getByRole("button", { name: "Save and next" });
        if (!(await next.isVisible())) break;
        const before = await page.locator('[data-slot="counting"]').getAttribute("data-step");
        await next.click();
        await expect(page.locator('[data-slot="counting"]')).not.toHaveAttribute("data-step", before ?? "");
      }
      await expect(page.getByText("Ready to log.")).toBeVisible();
      await expect(page.getByTestId("preview-input")).toHaveText("310.4 kg");
      await expect(page.getByTestId("preview-good")).toHaveText("234.2 kg");
      await expect(page.getByTestId("preview-recovery")).toHaveText("75.5%");
      await expect(page.getByTestId("preview-balance")).toHaveText("31.4 kg");
      await page.getByRole("button", { name: "Log run" }).click();
      await expect(page.locator('[data-banner="logged"]')).toBeVisible();
      await expect(page.getByTestId("logged-recovery")).toHaveText("75.5%");
      await expect(page.locator('[data-slot="logged"]')).toContainText(fx.order!.number);
      await expectNoHorizontalScroll(page);
      await shot(page, width, "station-logged");
      await context.close();

      await withApi("owner", async (o) => {
        const got = await o.q<{
          run: { status: string; discardG: number; endsG: number; loggedAt: string };
          figures: { inputG: number; goodG: number; rejectG: number; recoveryBp: number; recoveryPct: string; balanceG: number };
        }>("press.runs.get", { id: run.id });
        expect(got.run).toMatchObject({ status: "logged", discardG: PRESS.buttG, endsG: PRESS.endsG });
        expect(got.figures).toMatchObject({ inputG: PRESS.inputG, goodG: PRESS.goodG, rejectG: 0, recoveryBp: 7545, recoveryPct: "75.5", balanceG: 31_400 });
        fx.loggedAt = new Date(got.run.loggedAt).getTime();
        // The log returned copy A to the rack (the next run preheats B, not A).
        const copies = await o.q<{ items: { id: string; status: string }[] }>("dieInstance.list", { sectionId: fx.sectionId, limit: 10, offset: 0 });
        expect(Object.fromEntries(copies.items.map((c) => [c.id, c.status]))).toMatchObject({ [fx.copies.a.id]: "available", [fx.copies.b.id]: "in_use", [fx.copies.c.id]: "available" });
        // The strip moves the planned kg to pressed: the log's good kg, nothing packed yet.
        const strip = (await o.q<{ lineDetails: { strip: Strip }[] }>("orders.get", { id: fx.order!.id })).lineDetails[0]!.strip;
        expect(strip).toMatchObject({ plannedG: 0, pressedG: PRESS.goodG, producedG: 0, planableG: ORDER_KG_G - PRESS.goodG, bakiG: ORDER_KG_G });
      });
    });

    test("ageing: the trolley is loaded, aged and released", async () => {
      test.skip(true, "ageing lane paused on the satellite");
    });

    test("packer packs 3 bundles on the order line: live kg/12 ft, a reject, a lost reply sent again without a duplicate, party numbers", async ({ browser }) => {
      test.setTimeout(150_000);
      const { page, context } = await openAs(browser, "operator", width, "/pack/new");
      await page.getByLabel("Search die code or section").fill(fx.sectionCode);
      await expect(page.locator("button[data-die]")).toHaveCount(1);
      await page.locator("button[data-die]").first().click();
      const orders = page.locator("[data-slot='order-picker']");
      await expect(orders.getByRole("radio", { name: new RegExp(escape(fx.party.name)) })).toBeAttached({ timeout: 15_000 });
      await orders.getByRole("radio", { name: new RegExp(escape(fx.party.name)) }).check({ force: true });
      await page.locator("[data-slot='copy-picker']").getByRole("radio", { name: fx.copies.a.code, exact: true }).check({ force: true });
      await page.locator("[data-slot='cast-picker']").getByRole("radio", { name: fx.cast.number, exact: true }).check({ force: true });
      await page.getByLabel("Feet", { exact: true }).fill("12");
      await page.getByLabel("Inches", { exact: true }).fill("0");
      const yard = page.locator("input[type='radio'][value$='-Y2']");
      await expect(yard).toBeAttached({ timeout: 15_000 });
      await yard.focus();
      await page.keyboard.press("Space");
      await expect(yard).toBeChecked();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();

      const weight = page.getByLabel("Weight (kg)", { exact: true });
      const pieces = page.getByLabel("Pieces", { exact: true });
      for (const [i, b] of BUNDLES.entries()) {
        await weight.fill(b.kg);
        await pieces.fill(String(PCS_PER_BUNDLE));
        // The live chip is the server's kg/12 ft for exactly these figures, inside the 11.5–12.5 band.
        await expect(page.getByTestId("live-k12-value")).toHaveText(b.k12);
        await expect(page.locator("[data-slot='live-k12']")).toContainText("In range");
        await page.getByRole("button", { name: "Save bundle" }).click();
        await expect(page.locator("[data-slot='saved-bundle']")).toHaveCount(i + 1);
      }
      await page.getByRole("button", { name: "Add reject" }).click();
      await page.getByLabel("Reject pieces", { exact: true }).fill(String(REJECT.pcs));
      await page.getByLabel("kg", { exact: true }).last().fill("1.5");
      await page.getByLabel("Reason", { exact: true }).selectOption("bend");
      await page.getByRole("button", { name: "Save reject" }).click();
      await expect(page.locator("[data-slot='reject-row']")).toContainText("2 pieces rejected");
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await expect(page.locator("[data-slot='review-rejects']")).toContainText("1.5 kg at plant scrap");
      await shot(page, width, "pack-review");

      // The first save reaches orrn and packs, but the reply is lost; Save again replays the same key.
      const sent: { key: string; body: string }[] = [];
      let cut = true;
      await page.route("**/trpc/bundle.createReceipt*", async (route) => {
        const posted = route.request().postData() ?? "";
        const response = await route.fetch();
        sent.push({ key: /"clientRequestId":"([^"]+)"/.exec(posted)?.[1] ?? "", body: await response.text() });
        if (cut) {
          cut = false;
          await route.abort("connectionreset");
          return;
        }
        await route.fulfill({ response });
      });
      await page.getByRole("button", { name: "Save session" }).click();
      await expect(page.locator("[data-slot='pack-save-error']")).toContainText("Tap Save again", { timeout: 15_000 });
      await page.getByRole("button", { name: "Save session" }).click();
      await page.waitForURL((url) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new", { timeout: 20_000 });
      await page.unroute("**/trpc/bundle.createReceipt*");
      expect(sent).toHaveLength(2);
      expect(sent[1]!.key).toBe(sent[0]!.key);
      expect(sent[0]!.body).toContain('"replayed":false');
      expect(sent[1]!.body).toContain('"replayed":true');
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: /Party number/ })).toBeVisible();
      const groupId = new URL(page.url()).pathname.split("/").pop()!;
      await expectNoHorizontalScroll(page);
      await shot(page, width, "pack-saved");
      await context.close();

      await withApi("owner", async (o) => {
        const group = await o.q<{ bundles: { id: string; serial: string; partyNo: string | null; weightG: number; quantity: number; lengthMm: number; kgPer12ftMilli: number; createdAt: string }[] }>("bundle.getGroup", { id: groupId });
        expect(group.bundles).toHaveLength(3);
        const byWeight = BUNDLES.map((b) => group.bundles.find((x) => x.weightG === b.g)!);
        expect(byWeight.every(Boolean)).toBe(true);
        for (const b of byWeight) {
          expect(b).toMatchObject({ quantity: PCS_PER_BUNDLE, lengthMm: FT12_MM });
          expect(b.partyNo).toBeTruthy();
          expect(b.partyNo).not.toBe(b.serial);
          // No duplicate from the replayed save: one bundle per serial in the whole plant.
          const hits = await o.q<{ items: { serial: string }[] }>("bundle.listBundles", { search: b.serial, limit: 5 });
          expect(hits.items.filter((h) => h.serial === b.serial)).toHaveLength(1);
        }
        expect(byWeight.map((b) => b.kgPer12ftMilli)).toEqual([11_599, 11_582, 11_505]);
        // Lifelong numbers of a new party: 1, 2, 3 in packing order.
        expect(byWeight.map((b) => b.partyNo)).toEqual(["1", "2", "3"]);
        fx.bundles = byWeight.map((b) => ({ id: b.id, serial: b.serial, partyNo: b.partyNo, weightG: b.weightG }));
        created.bundles.push({ id: byWeight[2]!.id, serial: byWeight[2]!.serial });
        fx.packedAt = new Date(byWeight[0]!.createdAt).getTime();
        const rej = await o.q<{ items: { pcs: number; weightG: number | null; reason: string; groupId: string; createdAt: string }[] }>("stock.rejections", { dieId: fx.sectionId, limit: 10 });
        expect(rej.items.filter((r) => r.groupId === groupId).map((r) => [r.pcs, r.weightG, r.reason])).toEqual([[REJECT.pcs, REJECT.g, "bend"]]);
        const strip = (await o.q<{ lineDetails: { strip: Strip }[] }>("orders.get", { id: fx.order!.id })).lineDetails[0]!.strip;
        expect(strip).toMatchObject({ producedG: PACKED_G, packedG: PACKED_G, inStockG: PACKED_G, pressedG: PRESS.goodG - PACKED_G });
      });
    });

    test("office holds the third bundle for the line: the strip shows it held, the kg stay where they are", async ({ browser }) => {
      const held = fx.bundles![2]!;
      const { page, context } = await openAs(browser, "office", width, `/orders/${fx.order!.id}`);
      await settled(page);
      await expect(page.locator("[data-held-chip='1']")).toHaveCount(0);
      await page.locator("[data-hold-stock='1']").click();
      const sheet = page.getByRole("dialog");
      await sheet.locator(`[data-stock-bundle='${held.serial}']`).getByRole("checkbox").check();
      await sheet.locator("[data-hold-submit]").click();
      await expect(sheet.locator("[data-hold-result]")).toContainText("Held 1 bundle (69.040 kg)");
      await sheet.getByRole("button", { name: "Done" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.locator("[data-held-chip='1']")).toHaveText("Held: 1 bundle · 69.040 kg");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "order-held");
      await context.close();

      await withApi("owner", async (o) => {
        const strip = (await o.q<{ lineDetails: { strip: Strip }[] }>("orders.get", { id: fx.order!.id })).lineDetails[0]!.strip;
        expect(strip).toMatchObject({ heldG: HELD_G, heldBundles: 1, packedG: PACKED_G, inStockG: PACKED_G });
        // Holding writes no ledger row: the bundle's kg are still at Y2 as packed.
        expect((await o.q<Balance>("stock.balance", { itemKind: "bundle", itemRef: held.id })).items).toEqual([
          { itemKind: "bundle", itemRef: held.id, locationId: fx.yardId, qtyG: HELD_G },
        ]);
        // Another party's load refuses it, naming the order it is held for.
        const d = await o.m<{ id: string; code: string }>("dispatch.create", { customerId: fx.other.id });
        created.dispatches.push(d.id);
        fx.otherDispatchId = d.id;
        const scan = await o.m<{ added: string[]; refused: { serial: string; code: string; reason: string }[] }>("dispatch.scan", { id: d.id, serials: [held.serial] });
        expect(scan.added).toEqual([]);
        expect(scan.refused).toEqual([expect.objectContaining({ serial: held.serial, code: "held_for_order", reason: `Held for ${fx.order!.number} (${fx.party.name})` })]);
      });
    });

    test("dispatcher builds the load from the sales order: two free bundles go on, the other party's is refused; a viewer cannot dispatch; dispatched with transporter and capacity", async ({ browser }) => {
      test.setTimeout(150_000);
      const [b1, b2] = fx.bundles!;
      const { page, context } = await openAs(browser, "office", width, `/orders/${fx.order!.id}`);
      await settled(page);
      await page.locator("[data-dispatch-from-order]").click();
      await expect(page).toHaveURL(new RegExp(`/dispatch/new\\?salesOrderId=${fx.order!.id}`));
      await expect(page.locator("main#main")).toContainText(fx.order!.number);
      await page.getByTestId("transporter-select").selectOption({ label: "Shree Logistics" });
      await page.getByLabel("Truck capacity (kg)").fill("500");
      await page.getByRole("button", { name: "Create dispatch" }).click();
      await expect(page).toHaveURL(/\/dispatch\/(?!new)[^/?]+$/);
      const id = new URL(page.url()).pathname.split("/").pop()!;
      created.dispatches.push(id);
      const head = await withApi("owner", (o) => o.q<{ dispatch: { code: string; salesOrderId: string | null; customerId: string; transporterName: string | null; vehicleCapacityG: number | null } }>("dispatch.getDispatch", { id }));
      expect(head.dispatch).toMatchObject({ salesOrderId: fx.order!.id, customerId: fx.party.id, transporterName: "Shree Logistics", vehicleCapacityG: 500_000 });
      fx.dispatch = { id, code: head.dispatch.code };

      await page.getByRole("button", { name: "Scan bundles" }).click();
      const sheet = page.getByRole("dialog", { name: `Scanning into ${head.dispatch.code}` });
      await expect(sheet).toBeVisible();
      const field = sheet.getByLabel("Serial or label link");
      // The scan line's own status (the capacity banner is a status too).
      const status = sheet.locator("p[role='status']");
      for (const b of [b1!, b2!]) {
        await field.fill(b.serial);
        await field.press("Enter");
        await expect(status).toContainText(`Added ${b.serial}`);
      }
      await field.fill(fx.other.bundleSerial);
      await field.press("Enter");
      await expect(status).toContainText(`Packed for ${fx.other.name}`);
      await expect(sheet.getByTestId("scan-count")).toHaveText("2 added");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "dispatch-scan");
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(page.getByTestId("capacity-banner")).toContainText("139.1");

      // Hold the load.
      await page.getByRole("button", { name: "Hold stock" }).click();
      await expect(page.locator("[data-slot='dispatch-hero']")).toHaveAttribute("data-status", "reserved");

      // A viewer reads the dispatch but has no Dispatch button, and the server refuses the call.
      const viewer = await openAs(browser, "viewer", width, `/dispatch/${id}`);
      await expect(viewer.page.locator("[data-slot='dispatch-hero']")).toHaveAttribute("data-status", "reserved");
      await expect(viewer.page.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
      await viewer.context.close();
      const refused = await withApi("viewer", (v) => v.refused("dispatch.complete", { id }));
      expect(refused).toEqual({ status: 403, message: "You don't have permission to do that" });

      const before = Date.now();
      await page.getByRole("button", { name: "Dispatch", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: `Dispatch ${head.dispatch.code}?` });
      await confirm.getByTestId("confirm-dispatch").click();
      await expect(page.locator("[data-slot='dispatch-hero']")).toHaveAttribute("data-status", "completed", { timeout: 30_000 });
      const after = Date.now();
      await expect(page.locator("[data-slot='pl-header'] [data-fact='transporter'] dd")).toHaveText("Shree Logistics");
      // The order's baki after this load, on the dispatch itself: 8,000 − 139.10 kg.
      await expect(page.locator("main#main")).toContainText(`${kg3(ORDER_KG_G - DISPATCHED_G)} kg`);
      await shot(page, width, "dispatched");
      await context.close();

      await withApi("owner", async (o) => {
        const got = await o.q<{ dispatch: { status: string; completedAt: string; completedBy: string }; items: { serial: string }[] }>("dispatch.getDispatch", { id });
        expect(got.dispatch.status).toBe("completed");
        expect(got.items.map((i) => i.serial).sort()).toEqual([b1!.serial, b2!.serial].sort());
        const completedAt = new Date(got.dispatch.completedAt).getTime();
        expect(completedAt).toBeGreaterThanOrEqual(before - 2_000);
        expect(completedAt).toBeLessThanOrEqual(after + 2_000);
        // The audit trail: who completed it and when (the server's stamp), after the hold and the scans.
        const audit = await o.q<{ items: { action: string; actorId: string | null; actorName: string | null; at: string; meta: Record<string, unknown> }[] }>("audit.forSubject", {
          subjectType: "dispatch",
          subjectId: id,
        });
        const done = audit.items.find((a) => a.action === "dispatch.complete");
        expect(done, "dispatch.complete is audited").toBeTruthy();
        expect(done!.actorId).toBe(got.dispatch.completedBy);
        expect(done!.actorName).toBe("Local Office");
        expect(Math.abs(new Date(done!.at).getTime() - completedAt)).toBeLessThan(5_000);
        expect(done!.meta).toMatchObject({ itemCount: 2 });
        expect(audit.items.map((a) => a.action)).toEqual(expect.arrayContaining(["dispatch.create", "dispatch.addBundle", "dispatch.reserve", "dispatch.complete"]));
        // The other party's bundle never went on.
        expect(got.items.map((i) => i.serial)).not.toContain(fx.other.bundleSerial);
      });
    });

    test("packing list v2: header, Range/12' by the plant's formula, revision 1; regenerate makes revision 2; the certificate is issued", async ({ browser }) => {
      const d = fx.dispatch!;
      const [b1, b2] = fx.bundles!;
      const { page, context } = await openAs(browser, "office", width, `/dispatch/${d.id}`);
      const header = page.locator("[data-slot='pl-header']");
      await expect(header).toBeVisible();
      await expect(header.getByTestId("packing-list-totals")).toHaveText("2 bundles · 139.10 kg");
      await expect(header.locator("[data-fact='dispatch'] dd")).toContainText(d.code);
      await expect(header).toContainText(fx.party.name);
      const rows = page.getByTestId("packing-list-row");
      await expect(rows).toHaveCount(2);
      // Range/12' per row, read as the cell's own token (11.582 kg/12 ft is 11.5 here, never the rounded 11.6).
      for (const [i, b] of [b1!, b2!].entries()) {
        const want = BUNDLES[i]!;
        expect(rangeOf(want.g, PCS_PER_BUNDLE, FT12_MM)).toBe(want.range);
        const row = rows.filter({ hasText: b.serial });
        const tokens = (await row.innerText()).split(/[\t\n]+/).map((s) => s.trim());
        expect(tokens, `${b.serial} row`).toContain(want.range);
        expect(tokens, `${b.serial} row`).toContain(want.k12);
        if (want.range === "11.5") expect(tokens).not.toContain("11.6");
        // The party's own number shows beside the serial.
        await expect(row).toContainText(b.partyNo!);
      }
      // Q39: no cast on the party's packing list (as a word: "J4" is also inside serials like 26J4010).
      await expect(page.locator("main#main")).not.toContainText(new RegExp(`\\b(${escape(fx.cast.number)}|cast)\\b`, "i"));
      const listed = await withApi("owner", (o) => o.q<{ items: { id: string; code: string; dispatchCode: string | null; revision: number; bundleCount: number; weightG: number }[] }>("packingList.list", { customerId: fx.party.id }));
      const pl = listed.items.find((l) => l.dispatchCode === d.code)!;
      expect(pl).toMatchObject({ revision: 1, bundleCount: 2, weightG: DISPATCHED_G });
      expect(pl.code).toMatch(/^PL\/\d{4}-\d{2}\/\d+$/);
      await expect(page.getByRole("heading", { level: 2, name: /Packing list/ })).not.toContainText("Revision");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "pl-rev1");

      await page.getByTestId("regenerate").click();
      await page.getByRole("dialog", { name: "Make a new revision?" }).getByTestId("confirm-regenerate").click();
      const revs = page.locator("[data-slot='pl-revisions'] [data-testid='pl-revision']");
      await expect(revs).toHaveCount(2, { timeout: 20_000 });
      await expect(revs.first()).toHaveAttribute("data-revision", "2");
      await expect(revs.first()).toContainText("Current");
      await expect(revs.last()).toHaveAttribute("data-revision", "1");
      await expect(page.getByRole("heading", { level: 2, name: /Packing list/ })).toContainText("Revision 2");
      const history = await withApi("owner", (o) => o.q<{ code: string; revisions: { revision: number }[] }>("packingList.revisions", { id: pl.id }));
      expect(history.code).toBe(pl.code);
      expect(history.revisions.map((r) => r.revision)).toEqual([1, 2]);

      // The party's test certificate for this dispatch.
      await page.getByTestId("issue-certificate-button").click();
      await expect(page.getByTestId("issue-certificate")).toContainText("Chemistry pending");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "pl-rev2");
      await context.close();
    });

    test("the party signs in to its portal and sees the dispatch, its packing list without casts, and the certificate with chemistry pending", async ({ browser }) => {
      const d = fx.dispatch!;
      const email = `chain-${fx.tag.toLowerCase()}-${Date.now()}@orrn.local`;
      const password = `chain-party-${fx.tag.toLowerCase()}-password`;
      // The office gives the party a login; the party makes its account from the invite.
      await withApi("office", async (office) => {
        const grant = await office.m<{ id: string; inviteUrl: string }>("portal.users.grant", { customerId: fx.party.id, email });
        created.portalUsers.push(grant.id);
        const token = new URL(grant.inviteUrl).pathname.split("/").pop()!;
        const signup = await pwRequest.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
        try {
          const made = await signup.post(`${API}/api/auth/sign-up/email`, { data: { name: "Chain Buyer", email, password } });
          expect(made.ok(), `party sign-up returned ${made.status()}`).toBe(true);
          const accepted = await signup.post(`${API}/trpc/invite.acceptByToken`, { data: { token } });
          expect(accepted.ok(), `invite accept returned ${accepted.status()}`).toBe(true);
        } finally {
          await signup.dispose();
        }
      });

      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/portal\/?$/, { timeout: 30_000 });
      await expect(page.locator("[data-slot='portal-shell']")).toBeVisible();
      await page.goto("/portal/dispatches");
      await settled(page);
      const link = page.locator(`main#main a[href='/portal/dispatches/${d.id}']`).first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/portal/dispatches/${d.id}$`));
      await expect(page.getByTestId("portal-dispatch-totals")).toContainText("bundles");
      await expect(page.locator("main#main")).toContainText(fx.bundles![0]!.serial);
      await expect(page.locator("main#main")).not.toContainText(/cast/i);
      await expectNoHorizontalScroll(page);
      await shot(page, width, "portal-dispatch");
      await page.locator("main#main").getByRole("link", { name: "Test certificate" }).click();
      await expect(page.locator("main#main").getByRole("heading", { level: 1 })).toHaveText("Test certificate");
      const block = page.getByTestId("cert-casts").locator(`[data-cast='${fx.cast.number}']`);
      await expect(block).toHaveAttribute("data-cast-state", "pending");
      await expect(block).toContainText("Chemistry pending");
      await expect(block).toContainText(fx.sectionCode);
      await expect(page.getByTestId("portal-certificate")).toContainText("Quality document. Not a tax invoice.");
      await expectNoHorizontalScroll(page);
      await shot(page, width, "portal-certificate");
      await context.close();

      // The party sees only its own: the other party's open load is not in its list.
      const party = await apiAs({ email, password });
      try {
        const mine = await party.q<{ items: { id: string }[] }>("portal.dispatches.list", {});
        expect(mine.items.map((x) => x.id)).toEqual([d.id]);
      } finally {
        await party.dispose();
      }
    });

    test("the ledger balances: Σ postings per location = stock, and the order strip has the chain's figures", async () => {
      const bundles = fx.bundles!;
      await withApi("owner", async (o) => {
        const balance = (input: Record<string, unknown>) => o.q<Balance>("stock.balance", input);
        // Postings that landed in one instant (a voucher posts all its rows at one server time).
        const delta = async (input: Record<string, unknown>, at: number) => sumG(await balance({ ...input, at })) - sumG(await balance({ ...input, at: at - 1 }));

        // BILLET, the chain's cast: + the melt's logs, − the press run's weighed input.
        expect((await balance({ itemKind: "billet", itemRef: fx.cast.id })).items).toEqual([
          { itemKind: "billet", itemRef: fx.cast.id, locationId: "dev-loc-BILLET", qtyG: MELT.logsG - PRESS.inputG },
        ]);
        expect(await delta({ itemKind: "billet", itemRef: fx.cast.id }, fx.loggedAt!)).toBe(-PRESS.inputG);
        const casts = await o.q<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
        expect(casts.items.find((c) => c.id === fx.cast.id)?.billetsOnHandG).toBe(MELT.logsG - PRESS.inputG);

        // PLANT-SCRAP: the press close put the butt on DISCARD and the ends on PLANT-SCRAP (no rejects);
        // the pack put the reject kg on PLANT-SCRAP.
        const scrapAt = { locationId: "dev-loc-PLANT-SCRAP", itemKind: "return_stream" };
        expect(await delta({ ...scrapAt, itemRef: fx.streams.discard }, fx.loggedAt!)).toBe(PRESS.buttG);
        expect(await delta({ ...scrapAt, itemRef: fx.streams.plantScrap }, fx.loggedAt!)).toBe(PRESS.endsG);
        expect(await delta(scrapAt, fx.loggedAt!)).toBe(PRESS.buttG + PRESS.endsG);
        expect(await delta(scrapAt, fx.packedAt!)).toBe(REJECT.g);

        // Yard: each bundle's postings (+ pack at Y2, − dispatch) equal where it is now.
        let yardG = 0;
        for (const b of bundles) {
          const now = await balance({ itemKind: "bundle", itemRef: b.id });
          const packed = await balance({ itemKind: "bundle", itemRef: b.id, at: fx.packedAt! });
          expect(packed.items, `${b.serial} at pack`).toEqual([{ itemKind: "bundle", itemRef: b.id, locationId: fx.yardId, qtyG: b.weightG }]);
          const got = await o.q<{ bundle: { status: string; locationId: string | null; weightG: number } }>("bundle.getBySerial", { serial: b.serial });
          if (got.bundle.status === "dispatched") {
            expect(now.items, `${b.serial} dispatched`).toEqual([]);
          } else {
            expect(got.bundle.status).toBe("available");
            expect(now.items, `${b.serial} in the yard`).toEqual([{ itemKind: "bundle", itemRef: b.id, locationId: got.bundle.locationId, qtyG: got.bundle.weightG }]);
            yardG += sumG(now);
          }
        }
        expect(bundles.map((b) => b.weightG).reduce((s, g) => s + g, 0)).toBe(PACKED_G);
        expect(yardG).toBe(PACKED_G - DISPATCHED_G);
        expect(yardG).toBe(HELD_G);

        // The order strip: ordered 8 t, pressed 234.2 at the log (26.06 left once 208.14 is packed),
        // produced = Σ bundles, dispatched = the two on the truck, held = the one in the yard, baki = ordered − dispatched.
        const got = await o.q<{ lineDetails: { strip: Strip }[]; totals: { orderedG: number; dispatchedG: number; bakiG: number } }>("orders.get", { id: fx.order!.id });
        expect(got.lineDetails[0]!.strip).toMatchObject({
          orderedG: ORDER_KG_G,
          orderedPcs: 696,
          plannedG: 0,
          pressedG: PRESS.goodG - PACKED_G,
          agedG: 0,
          producedG: PACKED_G,
          packedG: HELD_G,
          inStockG: HELD_G,
          dispatchedG: DISPATCHED_G,
          heldG: HELD_G,
          heldBundles: 1,
          bakiG: ORDER_KG_G - DISPATCHED_G,
          overG: 0,
        });
        expect(got.totals).toMatchObject({ orderedG: ORDER_KG_G, dispatchedG: DISPATCHED_G, bakiG: 7_860_900 });
      });
    });
  });
}
