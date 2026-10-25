/**
 * Dev seed: ageing on the demo plant (W3-AG-S). PR-8's line (80 pcs of KD's channel 12230, 234.2 kg)
 * goes on two trolleys:
 *   AG-1 on T-1: 40 pcs, aged, three Webster samples passed, released: 40 pcs wait on the pack list.
 *   AG-2 on T-2: 30 pcs, in OV-1 now, with the oven simulator's curve logged up to now.
 * 10 pcs stay on the press line for a load in the app. Times sit inside today's production day, after
 * PR-8 was logged (`clock.dayAt`), so the day may be too young for a 6 h soak: AG-1's typed readings
 * cover at most its first 4 h, its soak is always short (under_aged), and it was released on an approved
 * `ageing_override` (the same rows at any hour: the demo shows the override path).
 */
import type { approval, docSeries } from "@orrn/db/schema";
import type { ageingBatch, ageingHardness, ageingRow, ageingTempLog, trolley } from "@orrn/db/schema/ageing";
import { AGEING_RECIPE_SUGGESTIONS, ovenSimulatedCurve, soakCompliance, type AgeingReading } from "@orrn/domain";

import type { SeedClock } from "./dev-seed-kit";

type Shift = { shiftId: string | null; productionDay: string; shiftSeq: number | null };

export type AgeingDemoInput = {
  companyId: string;
  clock: SeedClock;
  ownerId: string;
  supervisorId: string;
  pressUserId: string;
  nextSeq: () => number;
  shiftAt: (ms: number) => Shift;
  period: string;
  sectionId: string;
  copyId: string;
  castId: string;
  pressRunId: string;
  pressRunLineId: string;
  lineGoodG: number;
  linePcs: number;
  ovenId: string;
  recipeId: (alloy: string, temper: string) => string;
};

export type AgeingDemo = {
  trolleys: (typeof trolley.$inferInsert)[];
  batches: (typeof ageingBatch.$inferInsert)[];
  rows: (typeof ageingRow.$inferInsert)[];
  readings: (typeof ageingTempLog.$inferInsert)[];
  hardness: (typeof ageingHardness.$inferInsert)[];
  approvals: (typeof approval.$inferInsert)[];
  series: (typeof docSeries.$inferInsert)[];
};

const MIN = 60_000;

export function buildAgeingDemo(input: AgeingDemoInput): AgeingDemo {
  const { companyId, clock, ownerId } = input;
  const recipe = AGEING_RECIPE_SUGGESTIONS.find((r) => r.alloy === "6063" && r.temper === "T6" && r.kind === "full")!;
  const snapshot = { targetTempX10: recipe.targetTempX10, toleranceX10: recipe.toleranceX10, soakMin: recipe.soakMin, maxSoakMin: recipe.maxSoakMin };
  const kgOf = (pcs: number) => Math.round((input.lineGoodG * pcs) / input.linePcs);

  // AG-1: in at 55 % of the production day so far, out at 80 %, released at 82 %.
  const in1 = input.clock.dayAt(0.55);
  const out1 = input.clock.dayAt(0.8);
  const rel1 = input.clock.dayAt(0.82);
  // Whole minutes between in and out (0 right after the day starts: then no reading, verdict no_readings).
  const spanMin = Math.floor((out1 - in1) / MIN);
  const step = Math.min(15, Math.max(1, Math.floor(spanMin / 20)));
  const typed: AgeingReading[] = [];
  for (let m = step; m <= Math.min(spanMin, 240); m += step) typed.push({ at: in1 + m * MIN, tempCX10: recipe.targetTempX10 + ((m / step) % 3) - 1 });
  const soak1 = soakCompliance({ readings: typed, snapshot, inAt: in1, outAt: out1, now: clock.now });
  const overridden = true;
  if (soak1.verdict === "ok") throw new Error("dev-seed: AG-1's soak must stay short");
  const approvalId = "dev-approval-ageing-override-1";

  // AG-2: in at 86 %, still in the oven; the simulator's curve up to now.
  const in2 = input.clock.dayAt(0.86);
  const sim = ovenSimulatedCurve({ ...snapshot, startMs: in2, seed: "dev-ageing-batch-2" }).filter((r) => r.at <= clock.now);
  const soak2 = soakCompliance({ readings: sim, snapshot, inAt: in2, outAt: null, now: clock.now });

  const shift1 = input.shiftAt(in1);
  const shift2 = input.shiftAt(in2);
  const snap = {
    alloy: recipe.alloy,
    temper: recipe.temper,
    ...snapshot,
    hardnessMethod: recipe.hardnessMethod,
    hardnessMinX10: recipe.hardnessMinX10,
    hardnessMaxX10: recipe.hardnessMaxX10,
    sampleCount: recipe.sampleCount,
    tempCX10: recipe.targetTempX10,
    ovenId: input.ovenId,
    recipeId: input.recipeId(recipe.alloy, recipe.temper),
  };
  const batches: AgeingDemo["batches"] = [
    {
      id: "dev-ageing-batch-1",
      companyId,
      serverSeq: input.nextSeq(),
      number: "AG-1",
      status: "released",
      trolleyId: "dev-trolley-1",
      ...snap,
      shiftId: shift1.shiftId,
      productionDay: shift1.productionDay,
      shiftSeq: shift1.shiftSeq,
      gasStartMilli: 1_204_000,
      gasEndMilli: 1_209_350,
      inAt: new Date(in1),
      outAt: new Date(out1),
      soakStartedAt: soak1.soakStartedAt == null ? null : new Date(soak1.soakStartedAt),
      soakVerdict: soak1.verdict,
      soakInBandMin: soak1.inBandMin,
      qcVerdict: overridden ? "override" : "pass",
      releasedAt: new Date(rel1),
      releasedBy: input.supervisorId,
      overrideApprovalId: overridden ? approvalId : null,
      startedBy: input.pressUserId,
      createdBy: input.pressUserId,
      createdAt: new Date(in1 - 20 * MIN),
      updatedAt: new Date(rel1),
    },
    {
      id: "dev-ageing-batch-2",
      companyId,
      serverSeq: input.nextSeq(),
      number: "AG-2",
      status: "in_oven",
      trolleyId: "dev-trolley-2",
      ...snap,
      shiftId: shift2.shiftId,
      productionDay: shift2.productionDay,
      shiftSeq: shift2.shiftSeq,
      gasStartMilli: 1_209_350,
      inAt: new Date(in2),
      soakStartedAt: soak2.soakStartedAt == null ? null : new Date(soak2.soakStartedAt),
      startedBy: input.pressUserId,
      createdBy: input.pressUserId,
      createdAt: new Date(in2 - 15 * MIN),
      updatedAt: new Date(in2),
    },
  ];
  const line = {
    companyId,
    source: "press" as const,
    pressRunId: input.pressRunId,
    pressRunLineId: input.pressRunLineId,
    dieId: input.sectionId,
    dieInstanceId: input.copyId,
    castId: input.castId,
    lengthMm: 3_658,
    sortOrder: 1,
    createdBy: input.pressUserId,
  };
  const rows: AgeingDemo["rows"] = [
    {
      ...line,
      id: "dev-ageing-row-1",
      serverSeq: input.nextSeq(),
      batchId: "dev-ageing-batch-1",
      pcs: 40,
      kgG: kgOf(40),
      status: "released",
      hardnessMethod: "webster",
      hardnessReadingX10: 115,
      hardnessPass: true,
      createdAt: new Date(in1 - 20 * MIN),
    },
    { ...line, id: "dev-ageing-row-2", serverSeq: input.nextSeq(), batchId: "dev-ageing-batch-2", pcs: 30, kgG: kgOf(30), status: "pending", createdAt: new Date(in2 - 15 * MIN) },
  ];
  const readings: AgeingDemo["readings"] = [
    ...typed.map((r, i) => ({ id: `dev-ageing-temp-1-${i + 1}`, companyId, serverSeq: batches[0]!.serverSeq, batchId: "dev-ageing-batch-1", at: new Date(r.at), tempCX10: r.tempCX10, source: "typed" as const, createdBy: input.pressUserId })),
    ...sim.map((r, i) => ({ id: `dev-ageing-temp-2-${i + 1}`, companyId, serverSeq: batches[1]!.serverSeq, batchId: "dev-ageing-batch-2", at: new Date(r.at), tempCX10: r.tempCX10, source: "simulator" as const, createdBy: null })),
  ];
  const hardness: AgeingDemo["hardness"] = [110, 115, 120].map((readingX10, i) => ({
    id: `dev-ageing-hardness-1-${i + 1}`,
    companyId,
    serverSeq: batches[0]!.serverSeq,
    batchId: "dev-ageing-batch-1",
    rowId: "dev-ageing-row-1",
    method: "webster" as const,
    readingX10,
    pass: true,
    testedBy: input.pressUserId,
    testedAt: new Date(out1 + (i + 1) * MIN),
  }));
  const approvals: AgeingDemo["approvals"] = overridden
    ? [
        {
          id: approvalId,
          companyId,
          serverSeq: input.nextSeq(),
          kind: "ageing_override",
          subjectId: "dev-ageing-batch-1",
          status: "approved",
          requestNote: "Readings stopped after 4 h; the customer accepts this lot",
          meta: { number: "AG-1", soak: soak1.verdict, inBandMin: soak1.inBandMin },
          requestedBy: input.supervisorId,
          decidedBy: ownerId,
          decidedAt: new Date(out1 + 5 * MIN),
          createdAt: new Date(out1 + 2 * MIN),
          updatedAt: new Date(out1 + 5 * MIN),
        },
      ]
    : [];
  const series: AgeingDemo["series"] = [{ id: `dev-series-ageing-${input.period}`, companyId, docType: "ageing", period: input.period, value: 2, createdBy: ownerId }];
  return {
    trolleys: [{ id: "dev-trolley-2", companyId, serverSeq: input.nextSeq(), code: "T-2", capacityG: 2_000_000, status: "active", sortOrder: 2, createdBy: ownerId }],
    batches,
    rows,
    readings,
    hardness,
    approvals,
    series,
  };
}
