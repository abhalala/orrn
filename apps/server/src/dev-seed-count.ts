/**
 * Stock count demo for the dev seed (PL-10): CNT-1, a count of yards Y1 and Y2 that closed two days
 * ago with a variance: two bundles the system holds that nobody found (phantoms), one code the yard
 * scanned that is in no list, and one bundle found in Yard 2 that the system has in Yard 1 (moved).
 *
 * Everything is derived from the seeded bundles as they stood at the close (a bundle packed later
 * or already dispatched is not expected), so the report agrees with the bundles that exist. Close
 * writes no kg rows (the closed count is the checkpoint), so the ledger needs nothing. No approval
 * is open: the phantoms wait for a manager to request the void.
 */
import { countLine, countLocation, countSeen, countSession, countTally } from "@orrn/db/schema/count";
import type { auditLog } from "@orrn/db/schema/audit";
import type { docSeries } from "@orrn/db/schema/series";
import { docPeriod } from "@orrn/server/lib/docNumber";

import { devLocationId, type SeedBundle, type SeedClock } from "./dev-seed-kit";

type InsertRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export type CountSeed = {
  session: InsertRow<typeof countSession>;
  locations: InsertRow<typeof countLocation>[];
  seen: InsertRow<typeof countSeen>[];
  lines: InsertRow<typeof countLine>[];
  tally: InsertRow<typeof countTally>[];
  series: InsertRow<typeof docSeries>[];
  audits: InsertRow<typeof auditLog>[];
  summary: { expected: number; seen: number; phantoms: number; found: number; moved: number };
};

/** In stock (available or reserved) at the instant `t`, replaying the bundle's status history. */
function inStockAt(member: SeedBundle, t: number): boolean {
  if (member.createdAt > t) return false;
  let status = "available";
  for (const e of [...member.events].sort((a, b) => a.at - b.at)) {
    if (e.at <= t) status = e.to;
  }
  return status === "available" || status === "reserved";
}

export function buildCount(input: {
  companyId: string;
  clock: SeedClock;
  countedBy: string;
  closedBy: string;
  nextSeq: () => number;
  bundles: readonly SeedBundle[];
  /** Where each bundle sits (yard location id), dies by bundle id, kept out of the count: bundles that are moving or on a request. */
  yardOf: (bundleId: string) => string | null;
  dieOf: (bundleId: string) => string;
  excluded: ReadonlySet<string>;
}): CountSeed {
  const { companyId, clock } = input;
  const startedAt = clock.pastAt(2, 17.5);
  const closedAt = clock.pastAt(2, 19.5);
  const startSeq = input.nextSeq();
  const closeSeq = input.nextSeq();
  const yards = ["Y1", "Y2"].map(devLocationId);
  const period = docPeriod("count", new Date(clock.now));
  const id = "dev-count-1";

  const expected = input.bundles
    .filter((b) => {
      const yard = input.yardOf(b.id);
      return yard !== null && yards.includes(yard) && inStockAt(b, closedAt);
    })
    .sort((a, b) => a.serial.localeCompare(b.serial, "en", { numeric: true }));

  // Phantoms: two old bundles still in the yard that nobody found. Never one that is on a request or a dispatch.
  const candidates = expected.filter((b) => !input.excluded.has(b.id) && b.status === "available" && !b.currentDispatchId);
  const phantoms = candidates.filter((b) => b.sessionIdx === 3 || b.sessionIdx === 1).slice(0, 2);
  const phantomIds = new Set(phantoms.map((b) => b.id));
  // Moved: the first other candidate in Yard 1, seen in Yard 2.
  const movedMember = candidates.find((b) => !phantomIds.has(b.id) && input.yardOf(b.id) === yards[0]);
  const seenMembers = expected.filter((b) => !phantomIds.has(b.id));

  const seen: CountSeed["seen"] = [];
  const seenIdOf = new Map<string, string>();
  const span = Math.max(closedAt - startedAt - 10 * 60_000, 60_000);
  seenMembers.forEach((b, i) => {
    const location = b.id === movedMember?.id ? yards[1]! : input.yardOf(b.id)!;
    const seenId = `${id}-seen-${String(i + 1).padStart(3, "0")}`;
    seenIdOf.set(b.id, seenId);
    seen.push({
      id: seenId,
      companyId,
      serverSeq: startSeq,
      sessionId: id,
      locationId: location,
      code: b.serial,
      resolveKind: "bundle",
      bundleId: b.id,
      scannedAt: new Date(startedAt + 60_000 + Math.floor((span * i) / Math.max(seenMembers.length, 1))),
      createdBy: input.countedBy,
    });
  });
  const strayCode = "26J4999";
  const strayId = `${id}-seen-stray`;
  seen.push({
    id: strayId,
    companyId,
    serverSeq: startSeq,
    sessionId: id,
    locationId: yards[0]!,
    code: strayCode,
    resolveKind: "not_found",
    bundleId: null,
    scannedAt: new Date(startedAt + 30 * 60_000),
    createdBy: input.countedBy,
  });

  const lines: CountSeed["lines"] = [
    ...phantoms.map((b, i) => ({
      id: `${id}-line-phantom-${i + 1}`,
      companyId,
      serverSeq: closeSeq,
      sessionId: id,
      kind: "phantom" as const,
      bundleId: b.id,
      seenId: null,
      code: b.serial,
      systemLocationId: input.yardOf(b.id),
      seenLocationId: null,
      bundleStatus: "available",
      weightG: b.weightG,
      resolution: "open" as const,
      createdBy: input.closedBy,
      createdAt: new Date(closedAt),
    })),
    {
      id: `${id}-line-found-1`,
      companyId,
      serverSeq: closeSeq,
      sessionId: id,
      kind: "found" as const,
      bundleId: null,
      seenId: strayId,
      code: strayCode,
      systemLocationId: null,
      seenLocationId: yards[0]!,
      bundleStatus: null,
      weightG: null,
      resolution: "open" as const,
      createdBy: input.closedBy,
      createdAt: new Date(closedAt),
    },
    ...(movedMember
      ? [
          {
            id: `${id}-line-moved-1`,
            companyId,
            serverSeq: closeSeq,
            sessionId: id,
            kind: "moved" as const,
            bundleId: movedMember.id,
            seenId: seenIdOf.get(movedMember.id)!,
            code: movedMember.serial,
            systemLocationId: input.yardOf(movedMember.id),
            seenLocationId: yards[1]!,
            bundleStatus: "available",
            weightG: movedMember.weightG,
            resolution: "open" as const,
            createdBy: input.closedBy,
            createdAt: new Date(closedAt),
          },
        ]
      : []),
  ];

  // Variance per (yard, section): expected = in stock there at close; counted = scans there.
  type Cell = { expectedCount: number; expectedG: number; countedCount: number; countedG: number };
  const cells = new Map<string, Cell & { locationId: string; dieId: string | null }>();
  const cell = (locationId: string, dieId: string | null) => {
    const key = `${locationId}|${dieId ?? ""}`;
    let c = cells.get(key);
    if (!c) {
      c = { locationId, dieId, expectedCount: 0, expectedG: 0, countedCount: 0, countedG: 0 };
      cells.set(key, c);
    }
    return c;
  };
  for (const b of expected) {
    const c = cell(input.yardOf(b.id)!, input.dieOf(b.id));
    c.expectedCount += 1;
    c.expectedG += b.weightG;
  }
  for (const b of seenMembers) {
    const where = b.id === movedMember?.id ? yards[1]! : input.yardOf(b.id)!;
    const c = cell(where, input.dieOf(b.id));
    c.countedCount += 1;
    c.countedG += b.weightG;
  }
  cell(yards[0]!, null).countedCount += 1; // the stray code counts with no section and 0 kg
  const tally: CountSeed["tally"] = [...cells.values()].map((c, i) => ({
    id: `${id}-tally-${String(i + 1).padStart(3, "0")}`,
    companyId,
    serverSeq: closeSeq,
    sessionId: id,
    locationId: c.locationId,
    dieId: c.dieId,
    expectedCount: c.expectedCount,
    expectedG: c.expectedG,
    countedCount: c.countedCount,
    countedG: c.countedG,
    createdBy: input.closedBy,
    createdAt: new Date(closedAt),
  }));

  const phantomG = phantoms.reduce((s, b) => s + b.weightG, 0);
  const session: CountSeed["session"] = {
    id,
    companyId,
    serverSeq: closeSeq,
    number: "CNT-1",
    period,
    status: "closed",
    startSeq,
    includeUnplaced: false,
    note: "Quarter count of Yard 1 and Yard 2",
    closedAt: new Date(closedAt),
    closedBy: input.closedBy,
    closeSeq,
    expectedCount: expected.length,
    seenCount: seen.length,
    phantomCount: phantoms.length,
    phantomG,
    foundCount: 1,
    movedCount: movedMember ? 1 : 0,
    changedCount: 0,
    seenElsewhereCount: 0,
    clientRequestId: null,
    createdBy: input.countedBy,
    createdAt: new Date(startedAt),
  };
  const locations: CountSeed["locations"] = yards.map((locationId, i) => ({
    id: `${id}-loc-${i + 1}`,
    companyId,
    serverSeq: startSeq,
    sessionId: id,
    locationId,
    status: "closed" as const,
    createdBy: input.countedBy,
    createdAt: new Date(startedAt),
  }));
  const audits: CountSeed["audits"] = [
    { id: "dev-audit-count-1-start", companyId, actorId: input.countedBy, action: "count.start", subjectType: "count_session", subjectId: id, meta: { number: "CNT-1", locations: ["Y1", "Y2"], includeUnplaced: false }, at: new Date(startedAt) },
    { id: "dev-audit-count-1-close", companyId, actorId: input.closedBy, action: "count.close", subjectType: "count_session", subjectId: id, meta: { number: "CNT-1" }, at: new Date(closedAt) },
  ];
  const series: CountSeed["series"] = [{ id: `dev-series-count-${period}`, companyId, docType: "count", period, value: 1, createdBy: input.closedBy }];
  return { session, locations, seen, lines, tally, series, audits, summary: { expected: expected.length, seen: seen.length, phantoms: phantoms.length, found: 1, moved: movedMember ? 1 : 0 } };
}
