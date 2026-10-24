/**
 * Shared fixture for the Wave 1 orders tests (orders-w1-*.test.ts): the PL-8 sales plant
 * (`sales-fixture.ts`) on an inch company (FourCubes types ft + in), plus die copies with weight
 * readings, a press line and the `reallocate` reason codes.
 */
import { defaultReasonCodeRows } from "@orrn/domain";
import { die, dieInstance, dieWeightReading, pressLine, reasonCode } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import type { CompanyRole, TestEnv } from "./harness";
import { salesHelpers, type Api, type SalesPlant } from "./sales-fixture";

export const FT12 = 3_658; // 12 ft as stored (mm)
export const FT18 = 5_486; // 18 ft as stored (mm)

export interface OpPlant extends SalesPlant {
  /** Add a copy of a section; `milli` adds a weight reading (kg/12ft x 1000). */
  copy(sectionId: string, opts?: { milli?: number; ownerCustomerId?: string | null; seqNo?: number }): Promise<string>;
  reading(copyId: string, milli: number, at?: Date): Promise<void>;
  section(over?: { weightMinG?: number; weightMaxG?: number; ownerCustomerId?: string | null; alloy?: string | null; temper?: string | null }): Promise<string>;
  pressLineId: string;
  /** Confirmed W1 order: PO, pieces lines on a section with a pinned or suggested copy. */
  confirmedOrder(
    lines: { sectionId: string; pcs?: number; kgG?: number; mm?: number; dieInstanceId?: string | null; tierRank?: number | null }[],
    over?: { customerId?: string; poNumber?: string },
  ): Promise<{ id: string; number: string; lineIds: string[] }>;
}

let seqNo = 0;
let poSeq = 0;

export function opHelpers(getEnv: () => TestEnv) {
  const base = salesHelpers(getEnv);

  async function opPlant(opts: { settings?: Record<string, unknown> } = {}): Promise<OpPlant> {
    const env = getEnv();
    const p = await base.plant({ settings: { lengthUnit: "inch", ...opts.settings } });
    const pressLineId = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: pressLineId, companyId: p.companyId, code: "P1", name: "Press 1" });
    const rows = defaultReasonCodeRows().map((r) => ({ ...r, id: crypto.randomUUID(), companyId: p.companyId }));
    for (let i = 0; i < rows.length; i += 8) await env.db.insert(reasonCode).values(rows.slice(i, i + 8));

    async function reading(copyId: string, milli: number, at = new Date(Date.now() - 60_000)) {
      await env.db.insert(dieWeightReading).values({
        id: crypto.randomUUID(),
        companyId: p.companyId,
        dieInstanceId: copyId,
        kgPer12ftMilli: milli,
        readAt: at,
      });
    }

    async function copy(sectionId: string, o: { milli?: number; ownerCustomerId?: string | null; seqNo?: number } = {}) {
      seqNo += 1;
      const id = crypto.randomUUID();
      await env.db.insert(dieInstance).values({
        id,
        companyId: p.companyId,
        sectionId,
        seqNo: o.seqNo ?? seqNo,
        code: `C-${seqNo}`,
        ownerCustomerId: o.ownerCustomerId ?? null,
      });
      if (o.milli) await reading(id, o.milli);
      return id;
    }

    async function section(over: Parameters<OpPlant["section"]>[0] = {}) {
      return env.seedDie(p.companyId, { weightMinG: 11_800, weightMaxG: 12_600, ...over });
    }

    async function confirmedOrder(
      lines: Parameters<OpPlant["confirmedOrder"]>[0],
      over: { customerId?: string; poNumber?: string } = {},
    ) {
      poSeq += 1;
      const res = await p.owner.orders.create({
        customerId: over.customerId ?? p.customerId,
        poNumber: over.poNumber ?? `PO-W1-${poSeq}`,
        lines: lines.map((l) => ({
          sectionId: l.sectionId,
          cutLengthMm: l.mm ?? FT12,
          qtyBasis: l.pcs ? ("pcs" as const) : ("kg" as const),
          pcs: l.pcs,
          kgG: l.kgG,
          dieInstanceId: l.dieInstanceId ?? null,
          tierRank: l.dieInstanceId ? null : (l.tierRank ?? 1),
        })),
      });
      await p.owner.orders.confirm({ id: res.id });
      const got = await p.owner.orders.get({ id: res.id });
      return { id: res.id, number: res.number, lineIds: got.lines.map((l) => l.lineId) };
    }

    return { ...p, copy, reading, section, pressLineId, confirmedOrder };
  }

  return { ...base, opPlant };
}

export async function setSectionOwner(env: TestEnv, sectionId: string, ownerCustomerId: string | null) {
  await env.db.update(die).set({ ownerCustomerId }).where(eq(die.id, sectionId));
}

export type { Api, CompanyRole };
