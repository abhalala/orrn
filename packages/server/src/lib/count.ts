/**
 * Stock count classification and report (PL-10; spec P6, §5 "Count close"; digest Stage 14).
 *
 * The same SQL decides the live preview of an open count ("missing list shown before close") and
 * the frozen report written at close, so the two can never disagree:
 * - phantom: in stock at a counted location, not seen anywhere in the count, and unchanged since
 *   the count began (a bundle packed or moved into a counted yard during the count and not
 *   scanned is "changed", not a phantom: the counter may have passed that row already);
 * - moved: seen at a counted location while the system has it at another counted location;
 * - found: seen, but the system does not have it there: unknown or ambiguous code, bundle not in
 *   stock (void / dispatched), or in stock outside the counted locations (or place unknown).
 * A count over every active yard also expects in-stock bundles with no location
 * (`include_unplaced`, legacy stock taken on "place unknown"): unseen, they are phantoms with no
 * system location; seen, they are found (move_found places them).
 * A scan is superseded (reported as matched) when the bundle has ledger rows newer than the scan:
 * the system then knows something the scan did not (it was moved or dispatched after being seen).
 * "Newer" compares company sequences (`server_seq`), which only ever go up.
 *
 * Close writes no kg rows (§5): the closed session is the checkpoint ("balance restarts here").
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import {
  countLine,
  countLocation,
  countSeen,
  countSession,
  type CountLineKind,
  type CountLineResolution,
  type CountStatus,
} from "@orrn/db/schema/count";
import { bundle, type BundleStatus } from "@orrn/db/schema/inventory";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { companyTimezone } from "./dayWindow";
import { sqlUuid } from "./ledger";
import { daysBetween, localDate } from "./zonedBuckets";

/** Bundle statuses that hold stock (reserved bundles are still in the yard). */
const IN_STOCK = ["available", "reserved"] as const;

/** A column of the outer `bundle` row, always table-qualified (correlated subqueries). */
function B(column: string): SQL {
  return sql`${sql.identifier("bundle")}.${sql.identifier(column)}`;
}

/** A column of the outer `count_seen` row, always table-qualified. */
function S(column: string): SQL {
  return sql`${sql.identifier("count_seen")}.${sql.identifier(column)}`;
}

/** Subquery: the locations a count covers. */
function sessionLocations(companyId: string, sessionId: string): SQL {
  return sql`(select cl.location_id from ${countLocation} cl where cl.company_id = ${companyId} and cl.session_id = ${sessionId})`;
}

/** Over the outer `bundle`: it has ledger rows written after company sequence `seq`. */
function bundleChangedAfter(companyId: string, seq: number): SQL {
  return sql`exists (select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle' and l.item_ref = ${B("id")} and l.server_seq > ${seq})`;
}

/** Over the outer `bundle`: scanned in this count. */
function seenInSession(companyId: string, sessionId: string): SQL {
  return sql`exists (select 1 from ${countSeen} s where s.company_id = ${companyId} and s.session_id = ${sessionId} and s.bundle_id = ${B("id")})`;
}

/** What the classification needs from a count session (`include_unplaced` never changes after start). */
export type CountScope = { id: string; startSeq: number; includeUnplaced: boolean };

/**
 * Over the outer `bundle`: in stock at one of the count's locations, or with no location at all
 * when the count includes unplaced bundles.
 */
function atCountedLocation(companyId: string, scope: Pick<CountScope, "id" | "includeUnplaced">): SQL {
  const where = scope.includeUnplaced
    ? sql`(${B("location_id")} in ${sessionLocations(companyId, scope.id)} or ${B("location_id")} is null)`
    : sql`${B("location_id")} in ${sessionLocations(companyId, scope.id)}`;
  return sql`${B("company_id")} = ${companyId} and ${B("status")} in ('available', 'reserved') and ${where}`;
}

/** Over the outer `bundle`: a phantom of the count (see the module comment). */
export function phantomWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and not ${seenInSession(companyId, scope.id)} and not ${bundleChangedAfter(companyId, scope.startSeq)})`;
}

/** Over the outer `bundle`: at a counted location, not scanned, but changed after the count began. */
export function changedWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and not ${seenInSession(companyId, scope.id)} and ${bundleChangedAfter(companyId, scope.startSeq)})`;
}

/**
 * Over `cl` (a phantom count_line), `cs` (its closed count_session) and a bundle's id and
 * location columns: the bundle is STILL a phantom of that count. It sits where the count expected
 * it (NULL = place unknown), has no ledger row since the close (not moved, voided, restored or
 * dispatched) and no count has scanned it since. The phantom_void hook and the 7 am "phantoms
 * still missing" number share this one rule so they cannot disagree. The caller adds the line
 * filters (approval, resolution) and the bundle status it needs.
 */
export function stillPhantomOfLine(companyId: string, bundleId: SQL, bundleLocationId: SQL): SQL {
  return sql`${bundleLocationId} is cl.system_location_id
    and not exists (
      select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle'
        and l.item_ref = ${bundleId} and l.server_seq > cs.close_seq
    )
    and not exists (
      select 1 from count_seen s where s.company_id = ${companyId} and s.bundle_id = ${bundleId}
        and s.server_seq > cs.close_seq
    )`;
}

/**
 * Over `count_seen` LEFT JOIN `bundle`: 'found', 'moved', or NULL when the scan matches the system
 * (same location, or the system is newer than the scan).
 */
export function seenKindCase(companyId: string, sessionId: string): SQL<CountLineKind | null> {
  return sql<CountLineKind | null>`(case
    when ${S("bundle_id")} is null then 'found'
    when exists (select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle' and l.item_ref = ${S("bundle_id")} and l.server_seq > ${S("server_seq")}) then null
    when ${B("id")} is null then 'found'
    when ${B("status")} not in ('available', 'reserved') then 'found'
    when ${B("location_id")} = ${S("location_id")} then null
    when ${B("location_id")} in ${sessionLocations(companyId, sessionId)} then 'moved'
    else 'found'
  end)`;
}

const bundleSeenJoin = and(eq(bundle.id, countSeen.bundleId), eq(bundle.companyId, countSeen.companyId));

export type CloseCtx = { db: OrrnDb; companyId: string; userId: string | null; seq: number; closedAt: Date };

/** EXISTS: this request's close landed on the session. */
export function closeLanded(ctx: Pick<CloseCtx, "companyId" | "seq">, sessionId: string): SQL {
  return sql`exists (select 1 from ${countSession} cs where cs.id = ${sessionId} and cs.company_id = ${ctx.companyId} and cs.status = 'closed' and cs.close_seq = ${ctx.seq})`;
}

/**
 * The close batch (before the audit row): session → closed (only from open), locations released,
 * phantom lines, found/moved lines, then the totals. Every statement after the first is guarded by
 * "this request's close landed", so a close that lost a race (or ran on a closed count) writes
 * nothing; the partial unique indexes on count_line back that up.
 */
export function closeStatements(ctx: CloseCtx, session: CountScope): SqliteBatchItem[] {
  const { db, companyId, seq } = ctx;
  const sessionId = session.id;
  const landed = closeLanded(ctx, sessionId);
  const now = ctx.closedAt.getTime();
  const common = {
    id: sqlUuid.as("id"),
    companyId: sql<string>`${companyId}`.as("company_id"),
    serverSeq: sql<number>`${seq}`.as("server_seq"),
    sessionId: sql<string>`${sessionId}`.as("session_id"),
  };
  const tail = {
    resolution: sql<CountLineResolution>`'open'`.as("resolution"),
    approvalId: sql<string | null>`null`.as("approval_id"),
    resolvedAt: sql<number | null>`null`.as("resolved_at"),
    resolvedBy: sql<string | null>`null`.as("resolved_by"),
    resolutionVoucherId: sql<string | null>`null`.as("resolution_voucher_id"),
    createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
    createdAt: sql<number>`${now}`.as("created_at"),
    updatedAt: sql<number>`${now}`.as("updated_at"),
  };
  const kind = seenKindCase(companyId, sessionId);
  const lineCount = (k: CountLineKind) =>
    sql<number>`(select count(*) from ${countLine} x where x.company_id = ${companyId} and x.session_id = ${sessionId} and x.kind = ${k})`;
  const bundleCount = (where: SQL) => sql<number>`(select count(*) from ${bundle} where ${where})`;

  return [
    db
      .update(countSession)
      .set({ status: "closed", closedAt: ctx.closedAt, closedBy: ctx.userId, closeSeq: seq, serverSeq: seq })
      .where(and(eq(countSession.id, sessionId), eq(countSession.companyId, companyId), eq(countSession.status, "open"))),
    db
      .update(countLocation)
      .set({ status: "closed", serverSeq: seq })
      .where(
        and(
          eq(countLocation.companyId, companyId),
          eq(countLocation.sessionId, sessionId),
          eq(countLocation.status, "open"),
          landed,
        ),
      ),
    // Keys follow count_line's column order (insert-select rule).
    db.insert(countLine).select(
      db
        .select({
          ...common,
          kind: sql<CountLineKind>`'phantom'`.as("kind"),
          bundleId: sql<string>`${B("id")}`.as("bundle_id"),
          seenId: sql<string | null>`null`.as("seen_id"),
          code: sql<string | null>`null`.as("code"),
          systemLocationId: sql<string | null>`${B("location_id")}`.as("system_location_id"),
          seenLocationId: sql<string | null>`null`.as("seen_location_id"),
          bundleStatus: sql<string>`${B("status")}`.as("bundle_status"),
          weightG: sql<number>`${B("weight_g")}`.as("weight_g"),
          ...tail,
        })
        .from(bundle)
        .where(and(phantomWhere(companyId, session), landed)),
    ),
    db.insert(countLine).select(
      db
        .select({
          ...common,
          kind: sql<CountLineKind>`${kind}`.as("kind"),
          bundleId: sql<string | null>`${S("bundle_id")}`.as("bundle_id"),
          seenId: sql<string>`${S("id")}`.as("seen_id"),
          code: sql<string>`${S("code")}`.as("code"),
          systemLocationId: sql<string | null>`${B("location_id")}`.as("system_location_id"),
          seenLocationId: sql<string>`${S("location_id")}`.as("seen_location_id"),
          bundleStatus: sql<string | null>`${B("status")}`.as("bundle_status"),
          weightG: sql<number | null>`${B("weight_g")}`.as("weight_g"),
          ...tail,
        })
        .from(countSeen)
        .leftJoin(bundle, bundleSeenJoin)
        .where(
          and(
            eq(countSeen.companyId, companyId),
            eq(countSeen.sessionId, sessionId),
            sql`${kind} is not null`,
            landed,
          ),
        ),
    ),
    db
      .update(countSession)
      .set({
        expectedCount: sql<number>`${bundleCount(atCountedLocation(companyId, session))} - ${bundleCount(
          changedWhere(companyId, session),
        )}`,
        changedCount: bundleCount(changedWhere(companyId, session)),
        seenCount: sql<number>`(select count(*) from ${countSeen} s where s.company_id = ${companyId} and s.session_id = ${sessionId})`,
        phantomCount: lineCount("phantom"),
        phantomG: sql<number>`(select coalesce(sum(x.weight_g), 0) from ${countLine} x where x.company_id = ${companyId} and x.session_id = ${sessionId} and x.kind = 'phantom')`,
        foundCount: lineCount("found"),
        movedCount: lineCount("moved"),
      })
      .where(
        and(
          eq(countSession.id, sessionId),
          eq(countSession.companyId, companyId),
          eq(countSession.status, "closed"),
          eq(countSession.closeSeq, seq),
        ),
      ),
  ];
}

/**
 * Before a close: phantoms nobody had a chance to see. Per counted yard with no scan at all, the
 * phantoms it would report (a forgotten yard or a mis-tap on Close would put them all on the
 * owner's report, and close is final); plus the unplaced phantoms when the count has no scan at
 * all. A yard whose bundles were all seen elsewhere is not listed (nothing goes missing from it).
 */
export async function unscannedPhantoms(
  db: OrrnDb,
  companyId: string,
  scope: CountScope,
): Promise<{ yards: { locationId: string; code: string; bundles: number }[]; unplaced: number }> {
  const [byLocation, scanned] = await Promise.all([
    db
      .select({ locationId: bundle.locationId, code: location.code, n: sql<number>`count(*)` })
      .from(bundle)
      .leftJoin(location, and(eq(location.id, bundle.locationId), eq(location.companyId, bundle.companyId)))
      .where(phantomWhere(companyId, scope))
      .groupBy(bundle.locationId, location.code)
      .orderBy(asc(location.code)),
    db
      .selectDistinct({ locationId: countSeen.locationId })
      .from(countSeen)
      .where(and(eq(countSeen.companyId, companyId), eq(countSeen.sessionId, scope.id))),
  ]);
  const scannedAt = new Set(scanned.map((s) => s.locationId));
  const yards = byLocation
    .filter((r): r is typeof r & { locationId: string } => r.locationId !== null && !scannedAt.has(r.locationId))
    .map((r) => ({ locationId: r.locationId, code: r.code ?? "?", bundles: Number(r.n) }));
  const unplacedRow = byLocation.find((r) => r.locationId === null);
  return { yards, unplaced: scanned.length === 0 && unplacedRow ? Number(unplacedRow.n) : 0 };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type CountReportBundle = {
  /** NULL in the live preview of an open count. */
  lineId: string | null;
  bundleId: string;
  serial: string | null;
  sectionCode: string | null;
  weightG: number | null;
  status: BundleStatus | null;
  systemLocationId: string | null;
  systemLocationCode: string | null;
  seenLocationId: string | null;
  seenLocationCode: string | null;
  castId: string | null;
  packedAt: Date | null;
  resolution: CountLineResolution;
  approvalId: string | null;
};

export type FoundReason = "unknown" | "ambiguous" | "not_in_stock" | "elsewhere";

export type CountFoundLine = {
  lineId: string | null;
  code: string;
  reason: FoundReason;
  seenLocationId: string | null;
  seenLocationCode: string | null;
  resolvedBundle: CountReportBundle | null;
  resolution: CountLineResolution;
};

export type AgeBucket = "0-15" | "16-30" | "31-60" | "60+";

export type CountSummary = {
  /** In stock at the counted locations (excluding bundles that changed during the count, unseen). */
  expected: number;
  seen: number;
  /**
   * Scans that agree with the system: same location, or superseded by a newer ledger row. A bundle
   * seen and then dispatched during the count still counts as matched although it is no longer
   * expected, so `matched` can exceed `expected`.
   */
  matched: number;
  phantom: number;
  phantomG: number;
  found: number;
  moved: number;
  /** At a counted location, changed after the count began and not scanned: not called phantom. */
  changed: number;
  /** phantom ÷ expected in basis points (owner measure M1: < 100 bp). */
  phantomBp: number;
};

export type CountReport = {
  sessionId: string;
  number: string;
  status: CountStatus;
  closedAt: Date | null;
  /** true once closed (read from count_line); false = live preview of an open count. */
  frozen: boolean;
  summary: CountSummary;
  phantom: CountReportBundle[];
  moved: CountReportBundle[];
  found: CountFoundLine[];
  byCast: { castId: string | null; bundles: number; weightG: number }[];
  byAge: { bucket: AgeBucket; bundles: number; weightG: number }[];
  pendingApprovalId: string | null;
};

type RawLine = {
  lineId: string | null;
  kind: CountLineKind;
  bundleId: string | null;
  code: string | null;
  systemLocationId: string | null;
  seenLocationId: string | null;
  status: string | null;
  weightG: number | null;
  resolution: CountLineResolution;
  approvalId: string | null;
  serial: string | null;
  castId: string | null;
  packedAt: Date | null;
  sectionCode: string | null;
  resolveKind: string | null;
};

type SessionLike = {
  id: string;
  number: string;
  status: CountStatus;
  startSeq: number;
  includeUnplaced: boolean;
  closedAt: Date | null;
  expectedCount: number | null;
  seenCount: number | null;
  phantomCount: number | null;
  phantomG: number | null;
  foundCount: number | null;
  movedCount: number | null;
  changedCount: number | null;
};

const bundleDieJoin = and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId));

/** Frozen lines of a closed count, with the bundle facts the yard needs to find them. */
async function frozenLines(db: OrrnDb, companyId: string, sessionId: string): Promise<RawLine[]> {
  const rows = await db
    .select({
      lineId: countLine.id,
      kind: countLine.kind,
      bundleId: countLine.bundleId,
      code: countLine.code,
      systemLocationId: countLine.systemLocationId,
      seenLocationId: countLine.seenLocationId,
      status: countLine.bundleStatus,
      weightG: countLine.weightG,
      resolution: countLine.resolution,
      approvalId: countLine.approvalId,
      serial: bundle.serial,
      castId: bundle.castId,
      packedAt: bundle.createdAt,
      sectionCode: die.sectionCode,
      resolveKind: countSeen.resolveKind,
    })
    .from(countLine)
    .leftJoin(bundle, and(eq(bundle.id, countLine.bundleId), eq(bundle.companyId, countLine.companyId)))
    .leftJoin(die, bundleDieJoin)
    .leftJoin(countSeen, and(eq(countSeen.id, countLine.seenId), eq(countSeen.companyId, countLine.companyId)))
    .where(and(eq(countLine.companyId, companyId), eq(countLine.sessionId, sessionId)))
    .orderBy(asc(countLine.kind), asc(bundle.serial), asc(countLine.code));
  return rows;
}

/** Live classification of an open count (nothing written). */
async function previewLines(db: OrrnDb, companyId: string, session: SessionLike): Promise<RawLine[]> {
  const kind = seenKindCase(companyId, session.id);
  const [phantoms, seen] = await Promise.all([
    db
      .select({
        bundleId: bundle.id,
        systemLocationId: bundle.locationId,
        status: bundle.status,
        weightG: bundle.weightG,
        serial: bundle.serial,
        castId: bundle.castId,
        packedAt: bundle.createdAt,
        sectionCode: die.sectionCode,
      })
      .from(bundle)
      .leftJoin(die, bundleDieJoin)
      .where(phantomWhere(companyId, session))
      .orderBy(asc(bundle.serial)),
    db
      .select({
        kind: sql<CountLineKind>`${kind}`,
        bundleId: countSeen.bundleId,
        code: countSeen.code,
        seenLocationId: countSeen.locationId,
        resolveKind: countSeen.resolveKind,
        systemLocationId: bundle.locationId,
        status: bundle.status,
        weightG: bundle.weightG,
        serial: bundle.serial,
        castId: bundle.castId,
        packedAt: bundle.createdAt,
        sectionCode: die.sectionCode,
      })
      .from(countSeen)
      .leftJoin(bundle, bundleSeenJoin)
      .leftJoin(die, bundleDieJoin)
      .where(and(eq(countSeen.companyId, companyId), eq(countSeen.sessionId, session.id), sql`${kind} is not null`))
      .orderBy(asc(countSeen.code)),
  ]);
  return [
    ...phantoms.map(
      (p): RawLine => ({
        ...p,
        lineId: null,
        kind: "phantom",
        code: null,
        seenLocationId: null,
        resolution: "open",
        approvalId: null,
        resolveKind: null,
      }),
    ),
    ...seen.map((s): RawLine => ({ ...s, lineId: null, resolution: "open", approvalId: null })),
  ];
}

/** Live totals of an open count (same definitions as close). */
async function previewTotals(db: OrrnDb, companyId: string, session: SessionLike) {
  const count = (where: SQL) => db.select({ n: sql<number>`count(*)` }).from(bundle).where(where);
  const [[atLoc], [changed], [seen]] = await Promise.all([
    count(sql`(${atCountedLocation(companyId, session)})`),
    count(changedWhere(companyId, session)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(countSeen)
      .where(and(eq(countSeen.companyId, companyId), eq(countSeen.sessionId, session.id))),
  ]);
  const changedN = Number(changed?.n ?? 0);
  return { expected: Number(atLoc?.n ?? 0) - changedN, changed: changedN, seen: Number(seen?.n ?? 0) };
}

function bp(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 10_000) / whole) : 0;
}

const AGE_BUCKETS: { bucket: AgeBucket; maxDays: number }[] = [
  { bucket: "0-15", maxDays: 15 },
  { bucket: "16-30", maxDays: 30 },
  { bucket: "31-60", maxDays: 60 },
  { bucket: "60+", maxDays: Number.POSITIVE_INFINITY },
];

/**
 * The count's report: frozen lines once closed, a live preview while open, nothing when cancelled.
 * Ages are company calendar days from the pack date to the close (or now, for a preview), in the
 * same buckets as analytics stock ageing.
 */
export async function countReport(
  db: OrrnDb,
  companyId: string,
  session: SessionLike,
  now: Date,
): Promise<CountReport> {
  const [locations, [co], [pending]] = await Promise.all([
    db.select({ id: location.id, code: location.code }).from(location).where(eq(location.companyId, companyId)),
    db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
    db
      .select({ id: approval.id })
      .from(approval)
      .where(
        and(
          eq(approval.companyId, companyId),
          eq(approval.kind, "phantom_void"),
          eq(approval.subjectId, session.id),
          eq(approval.status, "pending"),
        ),
      )
      .limit(1),
  ]);
  const codeOf = new Map(locations.map((l) => [l.id, l.code]));
  const timezone = companyTimezone(co?.settings);

  const frozen = session.status === "closed";
  const raw =
    session.status === "cancelled"
      ? []
      : frozen
        ? await frozenLines(db, companyId, session.id)
        : await previewLines(db, companyId, session);

  const toBundle = (r: RawLine): CountReportBundle => ({
    lineId: r.lineId,
    bundleId: r.bundleId!,
    serial: r.serial,
    sectionCode: r.sectionCode,
    weightG: r.weightG,
    status: (r.status as BundleStatus | null) ?? null,
    systemLocationId: r.systemLocationId,
    systemLocationCode: r.systemLocationId ? (codeOf.get(r.systemLocationId) ?? null) : null,
    seenLocationId: r.seenLocationId,
    seenLocationCode: r.seenLocationId ? (codeOf.get(r.seenLocationId) ?? null) : null,
    castId: r.castId,
    packedAt: r.packedAt,
    resolution: r.resolution,
    approvalId: r.approvalId,
  });

  const phantom = raw.filter((r) => r.kind === "phantom" && r.bundleId).map(toBundle);
  const moved = raw.filter((r) => r.kind === "moved" && r.bundleId).map(toBundle);
  const found = raw
    .filter((r) => r.kind === "found")
    .map((r): CountFoundLine => {
      const reason: FoundReason = !r.bundleId || r.serial === null
        ? r.resolveKind === "ambiguous"
          ? "ambiguous"
          : "unknown"
        : !(IN_STOCK as readonly string[]).includes(r.status ?? "")
          ? "not_in_stock"
          : "elsewhere";
      return {
        lineId: r.lineId,
        code: r.code ?? "",
        reason,
        seenLocationId: r.seenLocationId,
        seenLocationCode: r.seenLocationId ? (codeOf.get(r.seenLocationId) ?? null) : null,
        resolvedBundle: r.bundleId && r.serial !== null ? toBundle(r) : null,
        resolution: r.resolution,
      };
    });

  let summary: CountSummary;
  if (frozen) {
    const seen = session.seenCount ?? 0;
    const f = session.foundCount ?? 0;
    const m = session.movedCount ?? 0;
    const ph = session.phantomCount ?? 0;
    const expected = session.expectedCount ?? 0;
    summary = {
      expected,
      seen,
      matched: seen - f - m,
      phantom: ph,
      phantomG: session.phantomG ?? 0,
      found: f,
      moved: m,
      changed: session.changedCount ?? 0,
      phantomBp: bp(ph, expected),
    };
  } else if (session.status === "open") {
    const t = await previewTotals(db, companyId, session);
    summary = {
      expected: t.expected,
      seen: t.seen,
      matched: t.seen - found.length - moved.length,
      phantom: phantom.length,
      phantomG: phantom.reduce((s, b) => s + (b.weightG ?? 0), 0),
      found: found.length,
      moved: moved.length,
      changed: t.changed,
      phantomBp: bp(phantom.length, t.expected),
    };
  } else {
    summary = { expected: 0, seen: 0, matched: 0, phantom: 0, phantomG: 0, found: 0, moved: 0, changed: 0, phantomBp: 0 };
  }

  // By cast (most kg first, unknown cast last) and by age at the close.
  const casts = new Map<string | null, { bundles: number; weightG: number }>();
  for (const b of phantom) {
    const c = casts.get(b.castId) ?? { bundles: 0, weightG: 0 };
    c.bundles += 1;
    c.weightG += b.weightG ?? 0;
    casts.set(b.castId, c);
  }
  const byCast = [...casts.entries()]
    .map(([castId, v]) => ({ castId, ...v }))
    .sort((a, b) =>
      a.castId === null ? 1 : b.castId === null ? -1 : b.weightG - a.weightG || a.castId.localeCompare(b.castId),
    );
  const refMs = (frozen ? session.closedAt : null)?.getTime() ?? now.getTime();
  const refDate = localDate(timezone, refMs);
  const byAge = AGE_BUCKETS.map(({ bucket }) => ({ bucket, bundles: 0, weightG: 0 }));
  for (const b of phantom) {
    const days = b.packedAt ? daysBetween(localDate(timezone, b.packedAt.getTime()), refDate) : 0;
    const idx = AGE_BUCKETS.findIndex((x) => days <= x.maxDays);
    const slot = byAge[idx === -1 ? AGE_BUCKETS.length - 1 : idx]!;
    slot.bundles += 1;
    slot.weightG += b.weightG ?? 0;
  }

  return {
    sessionId: session.id,
    number: session.number,
    status: session.status,
    closedAt: session.closedAt,
    frozen,
    summary,
    phantom,
    moved,
    found,
    byCast,
    byAge,
    pendingApprovalId: pending?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Phantom summary (7 am report / Today: `phantomSinceLastCount`, PL-11)
// ---------------------------------------------------------------------------

export type PhantomSummary = {
  /** The most recently closed count and its phantom share. */
  lastCount: {
    sessionId: string;
    number: string;
    closedAt: Date;
    expected: number;
    phantom: number;
    phantomG: number;
    phantomBp: number;
  } | null;
  /**
   * Phantoms of closed counts still missing: line open or awaiting approval, bundle still in stock
   * where the count expected it, no ledger row since that close and not scanned by a later count
   * (`stillPhantomOfLine`, the void hook's rule).
   */
  open: { bundles: number; weightG: number };
};

export async function phantomSummary(db: OrrnDb, companyId: string): Promise<PhantomSummary> {
  const [[last], [open]] = await Promise.all([
    db
      .select({
        sessionId: countSession.id,
        number: countSession.number,
        closedAt: countSession.closedAt,
        expected: countSession.expectedCount,
        phantom: countSession.phantomCount,
        phantomG: countSession.phantomG,
      })
      .from(countSession)
      .where(and(eq(countSession.companyId, companyId), eq(countSession.status, "closed")))
      .orderBy(desc(countSession.closedAt), desc(countSession.serverSeq))
      .limit(1),
    // Each bundle once, even when several closed counts called it a phantom.
    db
      .select({ n: sql<number>`count(*)`, g: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, companyId),
          inArray(bundle.status, [...IN_STOCK]),
          sql`exists (
            select 1 from ${countLine} cl
            inner join ${countSession} cs on cs.id = cl.session_id and cs.company_id = cl.company_id
            where cl.company_id = ${companyId} and cl.bundle_id = ${B("id")} and cl.kind = 'phantom'
              and cl.resolution in ('open', 'void_requested') and cs.status = 'closed'
              and ${stillPhantomOfLine(companyId, B("id"), B("location_id"))}
          )`,
        ),
      ),
  ]);
  return {
    lastCount:
      last && last.closedAt
        ? {
            sessionId: last.sessionId,
            number: last.number,
            closedAt: last.closedAt,
            expected: last.expected ?? 0,
            phantom: last.phantom ?? 0,
            phantomG: last.phantomG ?? 0,
            phantomBp: bp(last.phantom ?? 0, last.expected ?? 0),
          }
        : null,
    open: { bundles: Number(open?.n ?? 0), weightG: Number(open?.g ?? 0) },
  };
}
