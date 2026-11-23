/**
 * The subject of a quality check and the temper limits a mechanical check reads (XE QA, moved here from
 * routers/qa.ts by lane DEVICES so the device auto-capture writes the same records through the same code).
 */
import { and, eq, sql } from "drizzle-orm";

import { ageingHardness, ageingRow, ageingBatch } from "@orrn/db/schema/ageing";
import { cast } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { pressRun } from "@orrn/db/schema/press";
import { purchaseLot } from "@orrn/db/schema/purchase";
import { qaPlan, qaTemper, type QaHardnessMethod } from "@orrn/db/schema/qa";
import { storeTxn } from "@orrn/db/schema/store";
import type { QaSubjectType, TemperLimits } from "@orrn/domain";

import type { OrrnDb } from "./atomic";
import { qaRefusal } from "./qaRefusals";

export type QaSubject = {
  number: string;
  pressRunId: string | null;
  bundleId: string | null;
  dieId: string | null;
  dieInstanceId: string | null;
  lotId: string | null;
  castId: string | null;
  ageingBatchId: string | null;
};

/** Load the subject of a check, scoped by company; NOT_FOUND ("Not found") for another plant's row. */
export async function loadSubject(db: OrrnDb, companyId: string, type: QaSubjectType, subjectId: string): Promise<QaSubject> {
  const none: QaSubject = { number: "", pressRunId: null, bundleId: null, dieId: null, dieInstanceId: null, lotId: null, castId: null, ageingBatchId: null };
  if (type === "press_run") {
    const [r] = await db
      .select({ number: pressRun.number, dieId: pressRun.sectionId, dieInstanceId: pressRun.dieInstanceId, castId: pressRun.castId })
      .from(pressRun)
      .where(and(eq(pressRun.companyId, companyId), eq(pressRun.id, subjectId)))
      .limit(1);
    if (r) return { ...none, number: r.number, pressRunId: subjectId, dieId: r.dieId, dieInstanceId: r.dieInstanceId, castId: r.castId };
  } else if (type === "bundle") {
    const [b] = await db
      .select({ serial: bundle.serial, dieId: bundle.dieId, dieInstanceId: bundle.dieInstanceId, castId: bundle.castId, ageingRowId: bundle.ageingRowId })
      .from(bundle)
      .where(and(eq(bundle.companyId, companyId), eq(bundle.id, subjectId)))
      .limit(1);
    if (b) {
      let ageingBatchId: string | null = null;
      if (b.ageingRowId) {
        const [row] = await db.select({ batchId: ageingRow.batchId }).from(ageingRow).where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.id, b.ageingRowId))).limit(1);
        ageingBatchId = row?.batchId ?? null;
      }
      return { ...none, number: b.serial, bundleId: subjectId, dieId: b.dieId, dieInstanceId: b.dieInstanceId, castId: b.castId, ageingBatchId };
    }
  } else if (type === "purchase_lot") {
    const [l] = await db.select({ number: purchaseLot.number }).from(purchaseLot).where(and(eq(purchaseLot.companyId, companyId), eq(purchaseLot.id, subjectId))).limit(1);
    if (l) return { ...none, number: l.number, lotId: subjectId };
  } else if (type === "store_grn") {
    const [g] = await db
      .select({ number: storeTxn.number })
      .from(storeTxn)
      .where(and(eq(storeTxn.companyId, companyId), eq(storeTxn.id, subjectId), eq(storeTxn.kind, "grn")))
      .limit(1);
    if (g) return { ...none, number: g.number };
  } else if (type === "cast") {
    const [c] = await db.select({ number: cast.number }).from(cast).where(and(eq(cast.companyId, companyId), eq(cast.id, subjectId))).limit(1);
    if (c) return { ...none, number: c.number, castId: subjectId };
  } else if (type === "ageing_batch") {
    const [a] = await db.select({ number: ageingBatch.number }).from(ageingBatch).where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.id, subjectId))).limit(1);
    if (a) return { ...none, number: a.number, ageingBatchId: subjectId };
  }
  throw qaRefusal("subject_not_found");
}

/** The temper limits a mechanical check reads: the one picked, else the section's quality plan temper. */
export async function temperFor(db: OrrnDb, companyId: string, temperId: string | undefined, s: QaSubject): Promise<{ id: string; limits: TemperLimits; hardnessMethod: QaHardnessMethod } | null> {
  let tid = temperId ?? null;
  if (!tid && s.dieId) {
    const plans = await db
      .select({ temperId: qaPlan.temperId, dieInstanceId: qaPlan.dieInstanceId })
      .from(qaPlan)
      .where(and(eq(qaPlan.companyId, companyId), eq(qaPlan.dieId, s.dieId)));
    const own = plans.find((p) => p.dieInstanceId && p.dieInstanceId === s.dieInstanceId) ?? plans.find((p) => p.dieInstanceId == null);
    tid = own?.temperId ?? null;
  }
  if (!tid) return null;
  const [t] = await db.select().from(qaTemper).where(and(eq(qaTemper.companyId, companyId), eq(qaTemper.id, tid))).limit(1);
  if (!t) throw qaRefusal("subject_not_found");
  return { id: t.id, hardnessMethod: t.hardnessMethod, limits: { hardnessMinX10: t.hardnessMinX10, tensileMinMpa: t.tensileMinMpa, yieldMinMpa: t.yieldMinMpa, elongationMinX10: t.elongationMinX10 } };
}

/**
 * Row 26: hardness already exists at ageing. The lowest deciding sample of the batch, when none was typed.
 * Review S2: only samples on one scale are compared: the temper's scale when there is a temper (another
 * scale's lowest comes back with its scale, so the check can say it was not compared), else the one scale
 * the batch was read on (two scales and no temper: none).
 */
export async function ageingHardnessX10(
  db: OrrnDb,
  companyId: string,
  batchId: string | null,
  want: QaHardnessMethod | null,
): Promise<{ x10: number; method: QaHardnessMethod } | null> {
  if (!batchId) return null;
  const rows = await db
    .select({ method: ageingHardness.method, min: sql<number | null>`min(${ageingHardness.readingX10})` })
    .from(ageingHardness)
    .where(and(eq(ageingHardness.companyId, companyId), eq(ageingHardness.batchId, batchId), sql`${ageingHardness.pass} is not null`))
    .groupBy(ageingHardness.method);
  const found = rows.filter((r) => r.min != null).map((r) => ({ x10: Number(r.min), method: r.method as QaHardnessMethod }));
  if (want) return found.find((r) => r.method === want) ?? found[0] ?? null;
  return found.length === 1 ? found[0]! : null;
}

