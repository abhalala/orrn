/**
 * Shared fixture for the Wave 2 press tests (press-w2-*.test.ts): the W1 orders plant (inch company,
 * press line P1, every reason code) plus the BILLET / PLANT-SCRAP locations, casts with billets on
 * hand, and helpers that walk a run through release → issue → start → stop → count.
 */
import { cast, location, reasonCode, stockLedger } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import type { TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";

export const kg = (n: number) => Math.round(n * 1000);
let castSeq = 0;

export type PressPlant = OpPlant & {
  billetStoreId: string;
  plantScrapId: string;
  /** A cast with `billetG` of billets on hand at the billet store. */
  castWith(billetG: number): Promise<{ id: string; number: string }>;
  code(kind: string, code: string): Promise<string>;
  /** Section + copy (12.000 kg/12ft) + confirmed order (pcs) + released plan → its queued run. */
  queuedRun(opts?: { pcs?: number; purpose?: "production" | "die_trial" | "sample" | "other"; sectionId?: string; urgent?: boolean; window?: { start: number; end: number } }): Promise<{
    runId: string;
    planId: string;
    sectionId: string;
    copyId: string;
    orderId: string;
    orderNumber: string;
    salesOrderLineIds: string[];
    planLineIds: string[];
  }>;
  issue(runId: string, copyId: string): Promise<string>;
  /** queued → die_issued → running → stopped → counting (press role starts; no supervisor named). */
  countingRun(opts?: Parameters<PressPlant["queuedRun"]>[0]): Promise<Awaited<ReturnType<PressPlant["queuedRun"]>>>;
};

export function pressHelpers(getEnv: () => TestEnv) {
  const { opPlant } = opHelpers(getEnv);

  async function pressPlant(opts: { settings?: Record<string, unknown> } = {}): Promise<PressPlant> {
    const env = getEnv();
    const p = await opPlant(opts);
    // The sales plant seeds the default locations (BILLET, PLANT-SCRAP among them).
    const locs = await env.db.select({ id: location.id, code: location.code }).from(location).where(eq(location.companyId, p.companyId));
    const billetStoreId = locs.find((l) => l.code === "BILLET")!.id;
    const plantScrapId = locs.find((l) => l.code === "PLANT-SCRAP")!.id;

    async function castWith(billetG: number) {
      castSeq += 1;
      const id = crypto.randomUUID();
      const number = `K${castSeq}`;
      await env.db.insert(cast).values({ id, companyId: p.companyId, number, period: "2026-10", year: 2026, month: 10, seq: castSeq, alloy: "6063", openedAt: new Date() });
      if (billetG > 0) {
        await env.db.insert(stockLedger).values({
          id: crypto.randomUUID(),
          companyId: p.companyId,
          voucherType: "melt",
          voucherId: crypto.randomUUID(),
          line: 1,
          itemKind: "billet",
          itemRef: id,
          locationId: billetStoreId,
          qtyG: billetG,
          postedAt: new Date(Date.now() - 3_600_000),
        });
      }
      return { id, number };
    }

    async function code(kind: string, c: string) {
      const [row] = await env.db
        .select({ id: reasonCode.id })
        .from(reasonCode)
        .where(and(eq(reasonCode.companyId, p.companyId), eq(reasonCode.kind, kind as never), eq(reasonCode.code, c)));
      if (!row) throw new Error(`no reason ${kind}.${c}`);
      return row.id;
    }

    async function queuedRun(o: Parameters<PressPlant["queuedRun"]>[0] = {}) {
      const sectionId = o.sectionId ?? (await p.section());
      const copyId = await p.copy(sectionId, { milli: 12_000 });
      const purpose = o.purpose ?? "production";
      let orderId = "";
      let orderNumber = "";
      let salesOrderLineIds: string[] = [];
      const now = Date.now();
      let dies;
      if (purpose === "production") {
        const ord = await p.confirmedOrder([{ sectionId, pcs: (o.pcs ?? 100) * 2 }]);
        orderId = ord.id;
        orderNumber = ord.number;
        salesOrderLineIds = ord.lineIds;
        dies = [{ sectionId, urgent: o.urgent, lines: [{ salesOrderLineId: ord.lineIds[0]!, pcs: o.pcs ?? 100 }] }];
      } else {
        dies = [{ sectionId, urgent: o.urgent, lines: [] }];
      }
      const plan = await p.as("office").plans.create({ windowStart: o.window?.start ?? now, windowEnd: o.window?.end ?? now + 8 * 3_600_000, pressLineId: p.pressLineId, purpose, dies });
      const rel = await p.as("manager").plans.release({ id: plan.id });
      const got = await p.owner.plans.get({ id: plan.id });
      return { runId: rel.runs[0]!.id, planId: plan.id, sectionId, copyId, orderId, orderNumber, salesOrderLineIds, planLineIds: got.lines.map((l) => l.id) };
    }

    async function issue(runId: string, copyId: string) {
      const out = await p.as("die_room").dieInstance.issues.issue({ dieInstanceId: copyId, pressLineId: p.pressLineId, pressRunId: runId });
      return out.id;
    }

    async function countingRun(o: Parameters<PressPlant["queuedRun"]>[0] = {}) {
      const r = await queuedRun(o);
      await issue(r.runId, r.copyId);
      const press = p.as("press");
      await press.press.runs.start({ id: r.runId });
      await press.press.runs.stop({ id: r.runId });
      await press.press.runs.count({ id: r.runId });
      return r;
    }

    return { ...p, billetStoreId, plantScrapId, castWith, code, queuedRun, issue, countingRun };
  }

  return { pressPlant };
}

/**
 * The spec's worked example (§E3): billets 310.4 kg, good 234.2 kg → 7545 bp (75.5 %); butt 25.0,
 * ends 12.8, rejects 7.0 → balance 31.4 kg.
 */
export async function fillWorkedExample(p: PressPlant, runId: string, castId: string, o: { planLineId?: string; qcZero?: boolean } = {}) {
  const press = p.as("press");
  await press.press.runs.billets({ id: runId, castId, rows: [{ count: 4, kgG: kg(155.2), lengthMm: 600 }, { count: 4, kgG: kg(155.2), lengthMm: 600 }] });
  await press.press.runs.lines({ id: runId, rows: [{ cutLengthMm: 3_658, pcs: 80, goodG: kg(234.2), pressPlanLineId: o.planLineId ?? null }] });
  if (o.qcZero) await press.press.runs.qc({ id: runId, rows: [{ pcs: 0, kgG: 0 }] });
  else await press.press.runs.qc({ id: runId, rows: [{ pcs: 3, kgG: kg(7), reasonCodeId: await p.code("qc_reject", "bend"), runLine: 1 }] });
  await press.press.runs.scrap({ id: runId, discardG: kg(25), endsG: kg(12.8) });
}
