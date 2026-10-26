/**
 * Die room demo for the dev seed (FP-DR): the part of the catalogue the order book and the press
 * stand on, added around the Tee 13090 / Channel 12230 / Patti 14701 copies the main seed keeps for
 * the e2e specs.
 *
 * - every one of the 12 sections ends up with 1-3 copies (Tee has 20 because each e2e width mutates
 *   its own); a heavier band on five sections gives the ladder (the catalogue's tier rows);
 * - drift: copies read green (<= 8 % over the band start), amber (<= 10 %) and red (> 10 %);
 * - one copy at nitriding (with its log), one at the die maker (job DM-1 sent), one KD-owned section
 *   (12230, main seed), nine Tee copies on trial (main seed);
 * - one tier proposal waiting for a manager (a lift to the heavier band);
 * - the last reading of a copy that ran today comes from its press run (readings linked to PR-n).
 *
 * Ids are fixed (`dev-copy-*`, `dev-band-*`, `dev-reading-*`), so a re-run gives the same rows.
 */
import type { approval } from "@orrn/db/schema/approval";
import type { auditLog } from "@orrn/db/schema/audit";
import {
  dieBand,
  dieInstance,
  dieMaker,
  dieMakerJob,
  dieTierChange,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema/dies";
import type { docSeries } from "@orrn/db/schema/series";
import { docPeriod } from "@orrn/server/lib/docNumber";
import { nameKey } from "@orrn/server/lib/purchase";

import type { SeedClock } from "./dev-seed-kit";

type InsertRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Commercial text and profile kind of every demo section (the BIS pair follows the kind). */
export function sectionExtras(code: string): { alloy: string; temper: string; profileKind: "hollow" | "solid" } {
  const hollow = code === "15204" || code === "15310";
  return { alloy: "6063", temper: "T6", profileKind: hollow ? "hollow" : "solid" };
}

export type DieExtras = {
  bands: InsertRow<typeof dieBand>[];
  copies: InsertRow<typeof dieInstance>[];
  tierChanges: InsertRow<typeof dieTierChange>[];
  readings: InsertRow<typeof dieWeightReading>[];
  nitriding: InsertRow<typeof nitridingLog>[];
  makers: InsertRow<typeof dieMaker>[];
  makerJobs: InsertRow<typeof dieMakerJob>[];
  approvals: InsertRow<typeof approval>[];
  audits: InsertRow<typeof auditLog>[];
  series: InsertRow<typeof docSeries>[];
};

type ExtraCopy = {
  section: string;
  code: string;
  seqNo: number;
  tier: number | null;
  status: "available" | "in_use" | "at_nitriding" | "at_maker";
  readings: number[];
  lifeG?: number;
  hardness?: number;
};

/** Section key -> [heavier band min, max, wall in tenths of a mm]. The band start is the section's own max. */
const HEAVY_BANDS: Record<string, { code: string; wallTenthMm: number; widthG: number }> = {
  patti1: { code: "14701", wallTenthMm: 32, widthG: 200 },
  angle1: { code: "11250", wallTenthMm: 32, widthG: 200 },
  flat2: { code: "14730", wallTenthMm: 32, widthG: 200 },
  chan075: { code: "12212", wallTenthMm: 30, widthG: 200 },
  angle125: { code: "11262", wallTenthMm: 32, widthG: 200 },
};

export function buildDieExtras(input: {
  companyId: string;
  clock: SeedClock;
  ownerId: string;
  dieroomId: string;
  nextSeq: () => number;
  /** Section row by die key: id and the section's own band in grams per 12 ft. */
  section: (key: string) => { id: string; weightMinG: number; weightMaxG: number };
  copyId: (code: string) => string;
  customerId: (key: string) => string;
}): DieExtras {
  const { companyId, clock, ownerId, dieroomId, nextSeq } = input;
  const pastAt = (daysAgo: number, hour: number) => new Date(clock.pastAt(daysAgo, hour));

  // Ladder: one heavier band on five sections (band start = the section's current max).
  const bandId = (key: string) => `dev-band-${HEAVY_BANDS[key]!.code}-heavy`;
  const bands: DieExtras["bands"] = Object.entries(HEAVY_BANDS).map(([key, spec]) => {
    const s = input.section(key);
    return {
      id: bandId(key),
      companyId,
      serverSeq: nextSeq(),
      sectionId: s.id,
      wallTenthMm: spec.wallTenthMm,
      weightMinG: s.weightMaxG,
      weightMaxG: s.weightMaxG + spec.widthG,
      label: `${(s.weightMaxG / 1000).toFixed(1)}-${((s.weightMaxG + spec.widthG) / 1000).toFixed(1)}`,
      createdBy: ownerId,
      createdAt: pastAt(9, 10),
      updatedAt: pastAt(9, 10),
    };
  });

  const extra: ExtraCopy[] = [
    // Patti 14701 (2.400-2.600): 14701-1 runs on Press 1 (main seed); -2 reads amber, a lift to the heavier band is proposed.
    { section: "patti1", code: "14701-2", seqNo: 2, tier: 2, status: "available", readings: [2_560, 2_640] },
    // Angle 11250 (2.000-2.200): -1 green and on Press 2 now (PR-10); -2 reads red and is at nitriding.
    { section: "angle1", code: "11250-1", seqNo: 1, tier: 1, status: "in_use", readings: [2_040, 2_090], hardness: 1_020 },
    { section: "angle1", code: "11250-2", seqNo: 2, tier: 2, status: "at_nitriding", readings: [2_160, 2_230] },
    // Channel 12212 (2.200-2.400): -2 is at the die maker for a repair.
    { section: "chan075", code: "12212-1", seqNo: 1, tier: 1, status: "available", readings: [2_260] },
    { section: "chan075", code: "12212-2", seqNo: 2, tier: 2, status: "at_maker", readings: [2_330, 2_410] },
    { section: "patti15", code: "14715-1", seqNo: 1, tier: 1, status: "available", readings: [3_050] },
    { section: "angle125", code: "11262-1", seqNo: 1, tier: 1, status: "available", readings: [2_540] },
    // Flat 14730 (2.900-3.100): -1 green, -2 red.
    { section: "flat2", code: "14730-1", seqNo: 1, tier: 1, status: "available", readings: [3_120] },
    { section: "flat2", code: "14730-2", seqNo: 2, tier: 2, status: "available", readings: [3_200, 3_260] },
    { section: "tee1", code: "13072-1", seqNo: 1, tier: 1, status: "available", readings: [2_150] },
    { section: "tube075", code: "15204-1", seqNo: 1, tier: 1, status: "available", readings: [2_330] },
    { section: "sqtube1", code: "15310-1", seqNo: 1, tier: 1, status: "available", readings: [2_700] },
    { section: "angle15", code: "11280-1", seqNo: 1, tier: 1, status: "available", readings: [3_180] },
  ];
  const maker1 = "dev-die-maker-1";
  const maker2 = "dev-die-maker-2";
  const copies: DieExtras["copies"] = extra.map((c) => ({
    id: input.copyId(c.code),
    companyId,
    serverSeq: nextSeq(),
    sectionId: input.section(c.section).id,
    seqNo: c.seqNo,
    code: c.code,
    status: c.status,
    tierRank: c.tier,
    tierSince: c.tier === null ? null : pastAt(9, 11),
    hardness: c.hardness ?? null,
    lifeG: c.lifeG ?? null,
    bandId: null,
    dieMakerId: c.code === "12212-2" ? maker1 : c.code === "11250-1" ? maker2 : null,
    makerDieNo: c.code === "12212-2" ? "SDT-4471" : null,
    makerProjectNo: c.code === "12212-2" ? "P-2209" : null,
    rackNo: c.status === "available" ? `R${(c.seqNo + c.code.length) % 9 + 1}` : null,
    receivedAt: pastAt(12, 11),
    createdBy: ownerId,
    createdAt: pastAt(9, 11),
    updatedAt: pastAt(9, 11),
  }));

  const tierChanges: DieExtras["tierChanges"] = extra
    .filter((c) => c.tier !== null)
    .map((c) => ({
      id: `dev-tier-${c.code}`,
      companyId,
      serverSeq: nextSeq(),
      dieInstanceId: input.copyId(c.code),
      toRank: c.tier!,
      reason: "initial",
      status: "applied" as const,
      effectiveAt: pastAt(9, 11),
      createdBy: ownerId,
    }));

  const readings: DieExtras["readings"] = extra.flatMap((c) =>
    c.readings.map((milli, i) => ({
      id: `dev-reading-${c.code}-${i + 1}`,
      companyId,
      serverSeq: nextSeq(),
      dieInstanceId: input.copyId(c.code),
      kgPer12ftMilli: milli,
      lastKgPer12ftMilli: i === 0 ? null : c.readings[i - 1]!,
      readAt: pastAt(c.readings.length - i + 1, 9),
      createdBy: dieroomId,
    })),
  );

  // Nitriding: 11250-2 went in yesterday (still there); 14701-1 had its last run six days ago.
  const nitriding: DieExtras["nitriding"] = [
    {
      id: "dev-nitriding-11250-2",
      companyId,
      serverSeq: nextSeq(),
      dieInstanceId: input.copyId("11250-2"),
      nitridedAt: pastAt(1, 15),
      hardness: 1_040,
      cr4OpenG: 5_000,
      cr4UsedG: 250,
      cr4CloseG: 4_750,
      cr2OpenG: 3_200,
      cr2UsedG: 120,
      cr2CloseG: 3_080,
      k2sOpenG: 1_800,
      k2sUsedG: 60,
      k2sCloseG: 1_740,
      causticOpenG: 8_000,
      causticUsedG: 300,
      causticCloseG: 7_700,
      notes: "Red drift: nitrided before it goes back to the rack",
      signedBy: dieroomId,
      createdBy: dieroomId,
      createdAt: pastAt(1, 15),
    },
    {
      id: "dev-nitriding-14701-1",
      companyId,
      serverSeq: nextSeq(),
      dieInstanceId: input.copyId("14701-1"),
      nitridedAt: pastAt(6, 14),
      hardness: 1_060,
      cr4OpenG: 5_250,
      cr4UsedG: 250,
      cr4CloseG: 5_000,
      notes: null,
      signedBy: dieroomId,
      createdBy: dieroomId,
      createdAt: pastAt(6, 14),
    },
  ];

  // Makers and their jobs: DM-1 (12212-2 sent for repair, open), DM-2 (11250-1 corrected and received).
  const period = docPeriod("die_maker_job", new Date(clock.now));
  const makers: DieExtras["makers"] = [
    { id: maker1, companyId, serverSeq: nextSeq(), name: "Shree Die Tools", nameKey: nameKey("Shree Die Tools"), phone: "+91 98250 88123", city: "Rajkot", notes: "Repairs and new copies", createdBy: ownerId },
    { id: maker2, companyId, serverSeq: nextSeq(), name: "Gujarat Dies & Tools", nameKey: nameKey("Gujarat Dies & Tools"), phone: "+91 98790 42210", city: "Morbi", notes: "Corrections", createdBy: ownerId },
  ];
  const makerJobs: DieExtras["makerJobs"] = [
    {
      id: "dev-maker-job-1",
      companyId,
      serverSeq: nextSeq(),
      number: "DM-1",
      period,
      dieInstanceId: input.copyId("12212-2"),
      dieMakerId: maker1,
      purpose: "repair",
      status: "sent",
      sentAt: pastAt(5, 12),
      receivedAt: null,
      note: "Wall thin at the leg; weld and re-cut",
      createdBy: dieroomId,
      fromStatus: "available",
    },
    {
      id: "dev-maker-job-2",
      companyId,
      serverSeq: nextSeq(),
      number: "DM-2",
      period,
      dieInstanceId: input.copyId("11250-1"),
      dieMakerId: maker2,
      purpose: "correction",
      status: "received",
      sentAt: pastAt(21, 12),
      receivedAt: pastAt(14, 16),
      note: "Bearing length corrected",
      createdBy: dieroomId,
      receivedBy: dieroomId,
      fromStatus: "available",
    },
  ];

  // Approval waiting for a manager: a lift proposal for 14701-2. (No pending die_owner_override: the e2e asks for one on
  // 12230-1 itself and a copy has at most one open request; the approved exception for Tejura is in the main seed.)
  const lift = {
    id: "dev-tier-change-14701-2-lift",
    companyId,
    serverSeq: nextSeq(),
    dieInstanceId: input.copyId("14701-2"),
    fromRank: 2,
    toRank: 2,
    fromBandId: null,
    toBandId: bandId("patti1"),
    isLift: true,
    reason: "Reads 10 % over the band start for two runs; move it to the heavier band",
    status: "pending" as const,
    approvalId: "dev-approval-rerank-14701-2",
    createdBy: dieroomId,
    createdAt: pastAt(1, 17),
  };
  tierChanges.push(lift);
  const approvals: DieExtras["approvals"] = [
    {
      id: "dev-approval-rerank-14701-2",
      companyId,
      serverSeq: nextSeq(),
      kind: "die_rerank",
      subjectId: lift.id,
      status: "pending",
      requestNote: lift.reason,
      meta: {
        dieInstanceId: input.copyId("14701-2"),
        sectionId: input.section("patti1").id,
        code: "14701-2",
        fromRank: 2,
        toRank: 2,
        isLift: true,
        fromBandId: null,
        toBandId: bandId("patti1"),
      },
      requestedBy: dieroomId,
      createdAt: pastAt(1, 17),
    },
  ];

  const audits: DieExtras["audits"] = [
    {
      id: "dev-audit-tier-propose-14701-2",
      companyId,
      actorId: dieroomId,
      action: "die_tier.propose",
      subjectType: "die_instance",
      subjectId: input.copyId("14701-2"),
      meta: { code: "14701-2", fromRank: 2, toRank: 2, isLift: true, fromBandId: null, toBandId: bandId("patti1"), approvalId: "dev-approval-rerank-14701-2" },
      at: pastAt(1, 17),
    },
  ];

  const series: DieExtras["series"] = [
    { id: `dev-series-die_maker_job-${period}`, companyId, docType: "die_maker_job", period, value: makerJobs.length, createdBy: ownerId },
  ];

  return { bands, copies, tierChanges, readings, nitriding, makers, makerJobs, approvals, audits, series };
}

/** Which copy a packing session's bundles were pressed on (the bundle's `die_instance_id`). */
export const SESSION_COPY = ["14701-1", "11250-1", "13090-1", "12212-1", "14715-1", "11262-1", "14730-1", "11250-1", "12230-1"] as const;
