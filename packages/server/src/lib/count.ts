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
 * A bundle at a counted location that ANOTHER count scanned after this one began is not missing
 * either (digest §12: a phantom is not in the yard at a count): it is `seenElsewhere`, never a
 * phantom. An older sighting that is still to be acted on (its count is open, or its found / moved
 * line is open) does not change the frozen report, but flags the phantom (`seenElsewhere` on the
 * report bundle), blocks its void request, and keeps it out of "still missing"
 * (`stillPhantomOfLine`, shared by the void hook and the 7 am number).
 * A scan is superseded (reported as matched) when the bundle has ledger rows newer than the scan:
 * the system then knows something the scan did not (it was moved or dispatched after being seen).
 * "Newer" compares company sequences (`server_seq`), which only ever go up.
 *
 * Close writes no kg rows (§5): the closed session is the checkpoint ("balance restarts here").
 */
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import {
  countLine,
  countLocation,
  countSeen,
  countSession,
  countTally,
  type CountLineKind,
  type CountLineResolution,
  type CountStatus,
} from "@orrn/db/schema/count";
import { bundle, type BundleStatus } from "@orrn/db/schema/inventory";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import { chunk, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { companyTimezone, dayWindow } from "./dayWindow";
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

/**
 * Over the outer `bundle`: it changed after company sequence `seq`: it has ledger rows written
 * after it, or (a bundle with no ledger rows at all, legacy stock not yet taken on by
 * `stock.openingBalance`) its own row was stamped after it, since moves and status changes of an
 * off-ledger bundle post no ledger row (correctness r0 M-1).
 */
function bundleChangedAfter(companyId: string, seq: number): SQL {
  return sql`(exists (select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle' and l.item_ref = ${B("id")} and l.server_seq > ${seq})
    or (${B("server_seq")} > ${seq} and not exists (select 1 from stock_ledger l0 where l0.company_id = ${companyId} and l0.item_kind = 'bundle' and l0.item_ref = ${B("id")})))`;
}

/** Over the outer `bundle`: scanned in this count. */
function seenInSession(companyId: string, sessionId: string): SQL {
  return sql`exists (select 1 from ${countSeen} s where s.company_id = ${companyId} and s.session_id = ${sessionId} and s.bundle_id = ${B("id")})`;
}

/** Over the outer `bundle`: scanned in any count of the company (cancelled ones too) after company sequence `seq`. */
function seenInAnyCountAfter(companyId: string, seq: number): SQL {
  return sql`exists (select 1 from ${countSeen} s where s.company_id = ${companyId} and s.bundle_id = ${B("id")} and s.server_seq > ${seq})`;
}

/**
 * Over `sg` (a count_seen row of the bundle) joined to `sgc` (its count_session): the sighting is
 * still to be acted on in its own count: that count is open, or its found / moved line is open;
 * and the system has written no ledger row for the bundle since (no move, void or dispatch).
 */
function sightingPending(companyId: string): SQL {
  return sql`(sgc.status = 'open' or exists (
      select 1 from count_line sgl where sgl.company_id = ${companyId} and sgl.seen_id = sg.id
        and sgl.kind in ('found', 'moved') and sgl.resolution = 'open'
    ))
    and not exists (
      select 1 from stock_ledger sgx where sgx.company_id = ${companyId} and sgx.item_kind = 'bundle'
        and sgx.item_ref = sg.bundle_id and sgx.server_seq > sg.server_seq
    )`;
}

/**
 * Over `sg` joined to `sgc`: a sighting in ANOTHER count that says the bundle is not missing from
 * the count (`sessionId`, `startSeq`): made after that count began, or older but still pending.
 * The caller adds `sg.bundle_id = …`.
 */
function sightingClears(companyId: string, sessionId: SQL, startSeq: SQL): SQL {
  return sql`sg.company_id = ${companyId} and sg.session_id <> ${sessionId}
    and (sg.server_seq > ${startSeq} or (${sightingPending(companyId)}))`;
}

const SIGHTINGS = sql`count_seen sg inner join count_session sgc on sgc.id = sg.session_id and sgc.company_id = sg.company_id`;

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

/**
 * Over the outer `bundle`: a phantom of the count (see the module comment): at a counted location,
 * not scanned here, unchanged since the count began, and not scanned by any other count since.
 */
export function phantomWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and not ${seenInSession(companyId, scope.id)} and not ${bundleChangedAfter(companyId, scope.startSeq)} and not ${seenInAnyCountAfter(companyId, scope.startSeq)})`;
}

/**
 * Over the outer `bundle`: at a counted location, not scanned here and unchanged, but scanned by
 * another count after this one began (misplaced, not missing).
 */
export function seenElsewhereWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and not ${seenInSession(companyId, scope.id)} and not ${bundleChangedAfter(companyId, scope.startSeq)} and ${seenInAnyCountAfter(companyId, scope.startSeq)})`;
}

/** Over the outer `bundle`: at a counted location, not scanned, but changed after the count began. */
export function changedWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and not ${seenInSession(companyId, scope.id)} and ${bundleChangedAfter(companyId, scope.startSeq)})`;
}

/**
 * Over the outer `bundle`: in the count's expected set (the summary's `expected`): at a counted
 * location, minus the unscanned bundles that changed during the count.
 */
function expectedWhere(companyId: string, scope: CountScope): SQL {
  return sql`(${atCountedLocation(companyId, scope)} and (${seenInSession(companyId, scope.id)} or not ${bundleChangedAfter(companyId, scope.startSeq)}))`;
}

/**
 * Variance source rows (see `count_tally`): one row per expected bundle at its location, one per
 * scan of the count at the yard it counts for. Over `count_seen` left-joined to `bundle`: a scan
 * of an expected bundle that a newer ledger row superseded counts where the system now has it; a
 * superseded scan of a bundle that left the count (moved out, dispatched) counts nowhere.
 */
function tallySource(companyId: string, scope: CountScope): SQL {
  const superseded = sql`exists (select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle' and l.item_ref = ${S("bundle_id")} and l.server_seq > ${S("server_seq")})`;
  const expected = expectedWhere(companyId, scope);
  return sql`(
    select ${B("location_id")} as loc, ${B("die_id")} as die, 1 as e, ${B("weight_g")} as eg, 0 as c, 0 as cg
      from ${bundle} where ${expected}
    union all
    select case when ${B("id")} is not null and ${expected} and ${superseded} then ${B("location_id")} else ${S("location_id")} end as loc,
        ${B("die_id")} as die, 0 as e, 0 as eg, 1 as c, coalesce(${B("weight_g")}, 0) as cg
      from ${countSeen} left join ${bundle} on ${B("id")} = ${S("bundle_id")} and ${B("company_id")} = ${S("company_id")}
      where ${S("company_id")} = ${companyId} and ${S("session_id")} = ${scope.id}
        and ((${B("id")} is not null and ${expected}) or not ${superseded})
  ) t`;
}

/** The grouped variance columns over `tallySource` (aliases = count_tally column names). */
function tallyFields() {
  return {
    locationId: sql<string | null>`t.loc`.as("location_id"),
    dieId: sql<string | null>`t.die`.as("die_id"),
    expectedCount: sql<number>`sum(t.e)`.as("expected_count"),
    expectedG: sql<number>`sum(t.eg)`.as("expected_g"),
    countedCount: sql<number>`sum(t.c)`.as("counted_count"),
    countedG: sql<number>`sum(t.cg)`.as("counted_g"),
  };
}

/**
 * Over `cl` (a phantom count_line), `cs` (its closed count_session) and a bundle's id and
 * location columns: the bundle is STILL a phantom of that count. It sits where the count expected
 * it (NULL = place unknown), has no ledger row since the close (not moved, voided, restored or
 * dispatched), no other count has scanned it since that count BEGAN (a scan that landed after the
 * close but took its sequence before it, ruling 169, included), and no older sighting in another
 * count is still pending there (open count, or open found / moved line: move it from that count
 * instead). The phantom_void hook and the 7 am "phantoms still missing" number share this one rule
 * so they cannot disagree. The caller adds the line filters (approval, resolution) and the bundle
 * status it needs.
 */
export function stillPhantomOfLine(companyId: string, bundleId: SQL, bundleLocationId: SQL): SQL {
  return sql`${bundleLocationId} is cl.system_location_id
    and not exists (
      select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle'
        and l.item_ref = ${bundleId} and l.server_seq > cs.close_seq
    )
    and not exists (
      select 1 from ${SIGHTINGS}
      where sg.bundle_id = ${bundleId} and ${sightingClears(companyId, sql`cl.session_id`, sql`cs.start_seq`)}
    )`;
}

/** Where another count saw a phantom of this count (the latest sighting that clears it). */
export type CountSighting = {
  sessionId: string;
  number: string;
  locationId: string;
  locationCode: string | null;
  /** That count is still open. */
  countOpen: boolean;
  /**
   * The sighting is still to be acted on in that count (it is open, or its found / moved line is
   * open): `void_phantom` refuses the bundle; close that count and move it from there instead.
   */
  resolveThere: boolean;
};

/**
 * Sightings in other counts that clear phantoms of `scope` (see `sightingClears`), latest first per
 * bundle. `bundles` is either an id list (chunked here) or a subquery of bundle ids.
 */
export async function sightingsOf(
  db: OrrnDb,
  companyId: string,
  scope: Pick<CountScope, "id" | "startSeq">,
  bundles: string[] | SQL,
): Promise<Map<string, CountSighting>> {
  const run = (where: SQL) =>
    db.all<{
      bundleId: string;
      sessionId: string;
      number: string;
      status: CountStatus;
      locationId: string;
      locationCode: string | null;
      serverSeq: number;
      resolveThere: number;
    }>(sql`select sg.bundle_id as bundleId, sg.session_id as sessionId, sgc.number as number,
        sgc.status as status, sg.location_id as locationId, loc.code as locationCode,
        sg.server_seq as serverSeq, (case when ${sightingPending(companyId)} then 1 else 0 end) as resolveThere
      from ${SIGHTINGS}
      left join ${location} loc on loc.id = sg.location_id and loc.company_id = sg.company_id
      where ${where} and ${sightingClears(companyId, sql`${scope.id}`, sql`${scope.startSeq}`)}`);
  const rows = Array.isArray(bundles)
    ? (await Promise.all(chunk(bundles, 60).map((ids) => run(sql`sg.bundle_id in ${ids}`)))).flat()
    : await run(sql`sg.bundle_id in ${bundles}`);
  const out = new Map<string, CountSighting & { serverSeq: number }>();
  for (const r of rows) {
    const seq = Number(r.serverSeq);
    const prev = out.get(r.bundleId);
    // The latest sighting, but one still to be acted on wins over a settled one.
    const pending = Number(r.resolveThere) === 1;
    if (prev && ((prev.resolveThere && !pending) || (prev.resolveThere === pending && prev.serverSeq >= seq))) continue;
    out.set(r.bundleId, {
      sessionId: r.sessionId,
      number: r.number,
      locationId: r.locationId,
      locationCode: r.locationCode,
      countOpen: r.status === "open",
      resolveThere: pending,
      serverSeq: seq,
    });
  }
  return new Map([...out].map(([k, { serverSeq: _seq, ...v }]) => [k, v]));
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
    // Variance per (yard, section), frozen (keys follow count_tally's column order).
    db.insert(countTally).select(
      db
        .select({
          id: sqlUuid.as("id"),
          companyId: sql<string>`${companyId}`.as("company_id"),
          serverSeq: sql<number>`${seq}`.as("server_seq"),
          sessionId: sql<string>`${sessionId}`.as("session_id"),
          ...tallyFields(),
          createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
          createdAt: sql<number>`${now}`.as("created_at"),
        })
        .from(tallySource(companyId, session))
        .where(landed)
        .groupBy(sql`t.loc`, sql`t.die`),
    ),
    db
      .update(countSession)
      .set({
        expectedCount: sql<number>`${bundleCount(atCountedLocation(companyId, session))} - ${bundleCount(
          changedWhere(companyId, session),
        )}`,
        changedCount: bundleCount(changedWhere(companyId, session)),
        seenElsewhereCount: bundleCount(seenElsewhereWhere(companyId, session)),
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
  /**
   * Phantoms only (open or awaiting approval): another count saw the bundle, so it is not missing
   * (see `CountSighting`); null otherwise.
   */
  seenElsewhere: CountSighting | null;
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
  /**
   * At a counted location, unchanged and not scanned here, but scanned by another count after this
   * one began (misplaced, not missing): not called phantom. Part of `expected`.
   */
  seenElsewhere: number;
  /** phantom ÷ expected in basis points (owner measure M1: < 100 bp). */
  phantomBp: number;
};

/** Expected − counted, bundles and kg (positive: short, negative: extra). */
type VarianceFigures = {
  expected: number;
  expectedG: number;
  counted: number;
  countedG: number;
  variance: number;
  varianceG: number;
};

/** Per counted yard; `locationId` NULL = bundles with no place (a count with `include_unplaced`). */
export type CountVarianceLocation = { locationId: string | null; locationCode: string | null } & VarianceFigures;
/**
 * Per section: `bundle.die_id`, the `die` catalogue row (12170 Domal), NOT a physical die copy
 * (`die_instance`, the oblique code). `dieId` NULL = codes that resolved to no bundle.
 */
export type CountVarianceSection = { dieId: string | null; sectionCode: string | null } & VarianceFigures;

/**
 * Variance per yard and per section (`count_tally`): frozen at close, live for an open count, empty
 * for a cancelled one. Σ expected = `summary.expected`; Σ counted = `summary.seen` minus scans
 * superseded by a move out of the count or a dispatch.
 */
export type CountVariance = { byLocation: CountVarianceLocation[]; bySection: CountVarianceSection[] };

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
  variance: CountVariance;
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
  seenElsewhereCount: number | null;
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
  const [[atLoc], [changed], [elsewhere], [seen]] = await Promise.all([
    count(sql`(${atCountedLocation(companyId, session)})`),
    count(changedWhere(companyId, session)),
    count(seenElsewhereWhere(companyId, session)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(countSeen)
      .where(and(eq(countSeen.companyId, companyId), eq(countSeen.sessionId, session.id))),
  ]);
  const changedN = Number(changed?.n ?? 0);
  return {
    expected: Number(atLoc?.n ?? 0) - changedN,
    changed: changedN,
    seenElsewhere: Number(elsewhere?.n ?? 0),
    seen: Number(seen?.n ?? 0),
  };
}

type TallyRow = {
  locationId: string | null;
  dieId: string | null;
  sectionCode: string | null;
  expectedCount: number;
  expectedG: number;
  countedCount: number;
  countedG: number;
};

/** The count's variance tally rows: frozen ones once closed, the live tally while open. */
async function tallyRows(db: OrrnDb, companyId: string, session: SessionLike): Promise<TallyRow[]> {
  if (session.status === "cancelled") return [];
  if (session.status === "closed") {
    return db
      .select({
        locationId: countTally.locationId,
        dieId: countTally.dieId,
        sectionCode: die.sectionCode,
        expectedCount: countTally.expectedCount,
        expectedG: countTally.expectedG,
        countedCount: countTally.countedCount,
        countedG: countTally.countedG,
      })
      .from(countTally)
      .leftJoin(die, and(eq(die.id, countTally.dieId), eq(die.companyId, countTally.companyId)))
      .where(and(eq(countTally.companyId, companyId), eq(countTally.sessionId, session.id)));
  }
  const v = db.select(tallyFields()).from(tallySource(companyId, session)).groupBy(sql`t.loc`, sql`t.die`).as("v");
  return db
    .select({
      locationId: v.locationId,
      dieId: v.dieId,
      sectionCode: die.sectionCode,
      expectedCount: v.expectedCount,
      expectedG: v.expectedG,
      countedCount: v.countedCount,
      countedG: v.countedG,
    })
    .from(v)
    .leftJoin(die, and(eq(die.id, v.dieId), eq(die.companyId, companyId)));
}

/** Sum tally rows by `keyOf`; nulls sort last, then by label, then by key. */
function rollUp<K extends string | null, X>(
  rows: TallyRow[],
  keyOf: (r: TallyRow) => K,
  labelOf: (r: TallyRow) => string | null,
  make: (key: K, label: string | null, f: VarianceFigures) => X,
): X[] {
  const acc = new Map<K, { label: string | null; e: number; eg: number; c: number; cg: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = acc.get(k) ?? { label: labelOf(r), e: 0, eg: 0, c: 0, cg: 0 };
    a.e += Number(r.expectedCount);
    a.eg += Number(r.expectedG);
    a.c += Number(r.countedCount);
    a.cg += Number(r.countedG);
    acc.set(k, a);
  }
  return [...acc.entries()]
    .sort(([ka, a], [kb, b]) =>
      ka === null ? 1 : kb === null ? -1 : (a.label ?? "").localeCompare(b.label ?? "") || ka.localeCompare(kb),
    )
    .map(([k, a]) =>
      make(k, a.label, {
        expected: a.e,
        expectedG: a.eg,
        counted: a.c,
        countedG: a.cg,
        variance: a.e - a.c,
        varianceG: a.eg - a.cg,
      }),
    );
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
  // Sightings in other counts of this count's phantoms that are still open or awaiting approval.
  const sightings =
    session.status === "cancelled"
      ? new Map<string, CountSighting>()
      : await sightingsOf(
          db,
          companyId,
          session,
          frozen
            ? sql`(select x.bundle_id from ${countLine} x where x.company_id = ${companyId} and x.session_id = ${session.id}
                and x.kind = 'phantom' and x.resolution in ('open', 'void_requested') and x.bundle_id is not null)`
            : sql`(select ${bundle.id} from ${bundle} where ${phantomWhere(companyId, session)})`,
        );

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
    seenElsewhere:
      r.kind === "phantom" && (r.resolution === "open" || r.resolution === "void_requested")
        ? (sightings.get(r.bundleId!) ?? null)
        : null,
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
      seenElsewhere: session.seenElsewhereCount ?? 0,
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
      seenElsewhere: t.seenElsewhere,
      phantomBp: bp(phantom.length, t.expected),
    };
  } else {
    summary = {
      expected: 0, seen: 0, matched: 0, phantom: 0, phantomG: 0, found: 0, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 0,
    };
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

  const tally = await tallyRows(db, companyId, session);
  const variance: CountVariance = {
    byLocation: rollUp(
      tally,
      (r) => r.locationId,
      (r) => (r.locationId ? (codeOf.get(r.locationId) ?? null) : null),
      (locationId, locationCode, f) => ({ locationId, locationCode, ...f }),
    ),
    bySection: rollUp(
      tally,
      (r) => r.dieId,
      (r) => r.sectionCode,
      (dieId, sectionCode, f) => ({ dieId, sectionCode, ...f }),
    ),
  };

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
    variance,
    pendingApprovalId: pending?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Phantom summary (7 am report / Today: `phantomSinceLastCount`, PL-11)
// ---------------------------------------------------------------------------

export type PhantomSummary = {
  /** The most recently closed count, its yards and its phantom share. */
  lastCount: {
    sessionId: string;
    number: string;
    closedAt: Date;
    /** The yards it covered (label the share with them: one yard's count is not a full count). */
    locationCodes: string[];
    expected: number;
    phantom: number;
    phantomG: number;
    phantomBp: number;
  } | null;
  /**
   * Every count closed on the company calendar day of the last count, together (sum phantom ÷ sum
   * expected): yards counted as separate counts on one evening read as one count (owner measure
   * M1 is defined over a full count). A count whose yards were ALL counted again by a later count
   * closed that day is left out (the recount is the newer truth); one recounted only in part stays.
   */
  lastDay: {
    /** Company-local date, YYYY-MM-DD. */
    date: string;
    /** Counts in the sums. */
    counts: number;
    /** Their numbers, oldest close first. */
    numbers: string[];
    /** Counts of that day left out because later counts that day covered every yard of theirs, oldest first. */
    recounted: string[];
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

/** Counts closed on one company calendar day (a plant counts a handful a day at most). */
const MAX_DAY_COUNTS = 100;

export async function phantomSummary(db: OrrnDb, companyId: string): Promise<PhantomSummary> {
  const [[last], [open], [co]] = await Promise.all([
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
    db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
  ]);
  const openOut = { bundles: Number(open?.n ?? 0), weightG: Number(open?.g ?? 0) };
  if (!last || !last.closedAt) return { lastCount: null, lastDay: null, open: openOut };

  const timezone = companyTimezone(co?.settings);
  const { startMs, endMs } = dayWindow(timezone, last.closedAt.getTime());
  const closedThatDay = and(
    eq(countSession.companyId, companyId),
    eq(countSession.status, "closed"),
    gte(countSession.closedAt, new Date(startMs)),
    lt(countSession.closedAt, new Date(endMs)),
  );
  const [codes, newestFirst, dayYards] = await Promise.all([
    db
      .select({ code: location.code })
      .from(countLocation)
      .innerJoin(location, and(eq(location.id, countLocation.locationId), eq(location.companyId, countLocation.companyId)))
      .where(and(eq(countLocation.companyId, companyId), eq(countLocation.sessionId, last.sessionId)))
      .orderBy(asc(location.sortOrder), asc(location.code)),
    db
      .select({
        sessionId: countSession.id,
        number: countSession.number,
        expected: countSession.expectedCount,
        phantom: countSession.phantomCount,
        phantomG: countSession.phantomG,
      })
      .from(countSession)
      .where(closedThatDay)
      .orderBy(desc(countSession.closedAt), desc(countSession.closeSeq))
      .limit(MAX_DAY_COUNTS),
    // The yards of that day's counts (≤ 100 counts × 20 yards).
    db
      .select({ sessionId: countLocation.sessionId, locationId: countLocation.locationId })
      .from(countLocation)
      .innerJoin(
        countSession,
        and(eq(countSession.id, countLocation.sessionId), eq(countSession.companyId, countLocation.companyId)),
      )
      .where(and(eq(countLocation.companyId, companyId), closedThatDay)),
  ]);
  // Newest first: a count whose every yard a later count of the day already covered is a recount's
  // predecessor and leaves the sums.
  const yardsOf = new Map<string, string[]>();
  for (const r of dayYards) yardsOf.set(r.sessionId, [...(yardsOf.get(r.sessionId) ?? []), r.locationId]);
  const covered = new Set<string>();
  const day: typeof newestFirst = [];
  const recounted: string[] = [];
  for (const r of newestFirst) {
    const yards = yardsOf.get(r.sessionId) ?? [];
    if (yards.length > 0 && yards.every((y) => covered.has(y))) recounted.unshift(r.number);
    else day.unshift(r);
    for (const y of yards) covered.add(y);
  }
  const sum = (k: "expected" | "phantom" | "phantomG") => day.reduce((t, r) => t + (r[k] ?? 0), 0);
  return {
    lastCount: {
      sessionId: last.sessionId,
      number: last.number,
      closedAt: last.closedAt,
      locationCodes: codes.map((c) => c.code),
      expected: last.expected ?? 0,
      phantom: last.phantom ?? 0,
      phantomG: last.phantomG ?? 0,
      phantomBp: bp(last.phantom ?? 0, last.expected ?? 0),
    },
    lastDay: {
      date: localDate(timezone, last.closedAt.getTime()),
      counts: day.length,
      numbers: day.map((r) => r.number),
      recounted,
      expected: sum("expected"),
      phantom: sum("phantom"),
      phantomG: sum("phantomG"),
      phantomBp: bp(sum("phantom"), sum("expected")),
    },
    open: openOut,
  };
}
