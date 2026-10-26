/**
 * Posting builders for the append-only kg stock ledger (spec P5, §5; ADR-003/ADR-004).
 *
 * Every builder returns INSERT statements for the caller's single `atomicBatch`, next to the
 * document rows and the audit row. Nothing here (or anywhere) UPDATEs or DELETEs a ledger row.
 *
 * Bundles: a bundle's ledger balance must always equal its projection (status available/reserved
 * → +weight at `bundle.location_id`; dispatched/void → 0). D1 has no transactions, but a batch
 * runs its statements serially with nothing interleaved, so every posting for an EXISTING bundle
 * is an INSERT … SELECT that reads the bundle row at write time, guarded so it lands exactly when
 * the bundle write beside it landed:
 *   - "our write landed" = the bundle row carries this request's `server_seq` (each request
 *     allocates a fresh one from `company_sequence`) and the expected new status/location;
 *   - "on ledger" = the bundle already has ledger rows. Bundles created before the ledger existed
 *     have none and are taken on by `openingRows` (stock.openingBalance); until then no posting
 *     touches them, so a later opening balance still starts from the right place.
 * Location and weight come from the bundle row inside the statement, never from the request's
 * earlier read, so a move that lands between a read and a batch cannot skew a posting.
 */
import { and, eq, exists, inArray, notExists, sql, type SQL } from "drizzle-orm";

import { countLine } from "@orrn/db/schema/count";
import { bundle } from "@orrn/db/schema/inventory";
import { dcNote, purchaseLot } from "@orrn/db/schema/purchase";
import { location, stockLedger, type LedgerVoucherType, type LocationKind } from "@orrn/db/schema/stock";
import { alias } from "drizzle-orm/sqlite-core";

import { chunk, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { lotHasNoLiveDraws } from "./foundry";

export type PostingCtx = {
  db: OrrnDb;
  companyId: string;
  userId: string | null;
  /** This request's company sequence (`nextCompanySeq`), also stamped on the bundle rows it writes. */
  seq: number;
  postedAt: Date;
};

/** Bundle statuses that hold stock: reserved bundles are still in the yard until the DN completes. */
export const IN_STOCK_STATUSES = ["available", "reserved"] as const;

/** Bundle ids per move statement: ~15 other bound values + ids stays under D1's 100. */
export const LEDGER_IN_CHUNK = 60;

/** A uuid v4 generated per row by SQLite, for INSERT … SELECT postings. */
export const sqlUuid = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** EXISTS: the outer `bundle` row already has ledger rows. */
function bundleOnLedger(db: OrrnDb) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.companyId, bundle.companyId),
          eq(stockLedger.itemKind, "bundle"),
          eq(stockLedger.itemRef, bundle.id),
        ),
      ),
  );
}

/**
 * The outer `bundle` row's column, always table-qualified. Drizzle renders a column inside a
 * single-table select's fields unqualified, which inside a correlated subquery over stock_ledger
 * would silently bind to the subquery's own table.
 */
function outerBundle(column: "id" | "company_id" | "location_id"): SQL {
  return sql`${sql.identifier("bundle")}.${sql.identifier(column)}`;
}

/** A stock_ledger column, table-qualified (for the two-table select of move's + rows). */
function ledgerCol(column: "line" | "qty_g" | "posted_at"): SQL {
  return sql`${sql.identifier("stock_ledger")}.${sql.identifier(column)}`;
}

/** Id of the outer bundle's latest ledger row of `voucherTypes` with the given sign (for `reversal_of`). */
function latestBundleRow(voucherTypes: LedgerVoucherType[], positive: boolean) {
  const types = sql.join(
    voucherTypes.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql<string | null>`(
    select l.id from ${stockLedger} l
    where l.company_id = ${outerBundle("company_id")} and l.item_kind = 'bundle' and l.item_ref = ${outerBundle("id")}
      and l.voucher_type in (${types}) and ${positive ? sql`l.qty_g > 0` : sql`l.qty_g < 0`}
    order by l.posted_at desc, l.server_seq desc, l.line desc
    limit 1
  )`;
}

/**
 * Posting time for a row of the outer bundle: the request's instant, but never at or before the
 * bundle's latest existing row. A request reads "now" before its batch, so a slower request could
 * otherwise post a row dated before one that was written ahead of it; per item, posting order
 * always equals write order, so the balance "as of" any instant never shows a half-applied pair.
 */
function postedAtFor(ctx: PostingCtx): SQL<number> {
  return sql<number>`max(${ctx.postedAt.getTime()}, coalesce((
    select max(l.posted_at) + 1 from ${stockLedger} l
    where l.company_id = ${outerBundle("company_id")} and l.item_kind = 'bundle' and l.item_ref = ${outerBundle("id")}
  ), 0))`;
}

type BundleSelectOpts = {
  voucherType: LedgerVoucherType;
  /** A fixed id, or a column of a joined table (e.g. the count line that voids the bundle). */
  voucherId: string | SQL<string>;
  line: SQL<number>;
  sign: 1 | -1;
  reversalOf?: SQL<string | null>;
  reason?: string | SQL<string> | null;
};

/** One ledger row per selected `bundle` row. Keys follow stock_ledger's column order (insert-select rule). */
function bundleRowSelect(ctx: PostingCtx, o: BundleSelectOpts) {
  return {
    id: sqlUuid.as("id"),
    companyId: sql<string>`${ctx.companyId}`.as("company_id"),
    serverSeq: sql<number>`${ctx.seq}`.as("server_seq"),
    voucherType: sql<LedgerVoucherType>`${o.voucherType}`.as("voucher_type"),
    voucherId: sql<string>`${o.voucherId}`.as("voucher_id"),
    line: o.line.as("line"),
    itemKind: sql<"bundle">`'bundle'`.as("item_kind"),
    itemRef: sql<string>`${bundle.id}`.as("item_ref"),
    locationId: sql<string | null>`${bundle.locationId}`.as("location_id"),
    qtyG: (o.sign === 1 ? sql<number>`${bundle.weightG}` : sql<number>`-${bundle.weightG}`).as("qty_g"),
    postedAt: postedAtFor(ctx).as("posted_at"),
    reversalOf: (o.reversalOf ?? sql<string | null>`null`).as("reversal_of"),
    reason: sql<string | null>`${o.reason ?? null}`.as("reason"),
    createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
    createdAt: sql<number>`${Date.now()}`.as("created_at"),
  };
}

/** `offset + row_number()` in serial order: stable, unique line numbers within one voucher. */
function lineByRowNumber(offset: number, step = 1, minus = 0): SQL<number> {
  return sql<number>`(${offset} + ${step} * row_number() over (order by ${bundle.serial}) - ${minus})`;
}

/**
 * + rows for bundles created in this same batch (pack) or taken on with known values (bulk
 * import → "opening"). Plain chunked VALUES inserts; the bundles are new, so nothing can race.
 */
export function packRows(
  ctx: PostingCtx,
  voucher: { type: "pack" | "opening"; id: string },
  bundles: readonly { id: string; weightG: number; locationId: string | null }[],
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  pushChunkedInserts(
    out,
    (rows) => ctx.db.insert(stockLedger).values(rows),
    bundles.map((b, idx) => ({
      id: crypto.randomUUID(),
      companyId: ctx.companyId,
      serverSeq: ctx.seq,
      voucherType: voucher.type,
      voucherId: voucher.id,
      line: idx + 1,
      itemKind: "bundle" as const,
      itemRef: b.id,
      locationId: b.locationId,
      qtyG: b.weightG,
      postedAt: ctx.postedAt,
      reversalOf: null,
      reason: null,
      createdBy: ctx.userId,
    })),
  );
  return out;
}

/** EXISTS: `locationId` is, right now, an active yard of the company (where bundles may be put). */
export function activeYard(db: OrrnDb, companyId: string, locationId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(location)
      .where(
        and(
          eq(location.id, locationId),
          eq(location.companyId, companyId),
          eq(location.active, true),
          eq(location.kind, "yard"),
        ),
      ),
  );
}

/**
 * The location holds no stock right now: no available/reserved bundle sits there and its ledger
 * balance (any item kind) is zero. Used as a write-time guard inside the UPDATE that retires or
 * re-types a location, so a move that lands after the caller's read cannot slip past it.
 */
export function locationIsEmpty(db: OrrnDb, companyId: string, locationId: string): SQL {
  return and(
    notExists(
      db
        .select({ one: sql`1` })
        .from(bundle)
        .where(
          and(
            eq(bundle.companyId, companyId),
            eq(bundle.locationId, locationId),
            inArray(bundle.status, [...IN_STOCK_STATUSES]),
          ),
        ),
    ),
    sql`coalesce((select sum(l.qty_g) from ${stockLedger} l where l.company_id = ${companyId} and l.location_id = ${locationId}), 0) = 0`,
  ) as SQL;
}

/**
 * Move: for each chunk, − rows at the bundle's current location (read in the statement), then the
 * bundle UPDATE to `toLocationId`, both under the same predicate (in stock, not already there);
 * finally one + row at the new location mirroring every − row of this voucher whose bundle UPDATE
 * landed. Bundles already at `toLocationId` are left alone (same-location no-op). Off-ledger
 * (legacy) bundles still move but post nothing.
 */
export function moveRows(
  ctx: PostingCtx,
  input: {
    voucherId: string;
    bundleIds: readonly string[];
    toLocationId: string;
    reason?: string | null;
    /**
     * Extra write-time condition on the outer `bundle` row (e.g. "still where the count saw the
     * system have it"); a bundle that fails it is neither posted nor moved.
     */
    onlyIf?: SQL;
  },
): SqliteBatchItem[] {
  const { db, companyId } = ctx;
  const out: SqliteBatchItem[] = [];
  const parts = chunk([...input.bundleIds], LEDGER_IN_CHUNK);
  parts.forEach((ids, partIdx) => {
    const movable = and(
      eq(bundle.companyId, companyId),
      inArray(bundle.id, ids),
      inArray(bundle.status, [...IN_STOCK_STATUSES]),
      sql`${bundle.locationId} is not ${input.toLocationId}`,
      // Evaluated at write time: a location retired or re-typed after the request read it takes no bundle.
      activeYard(db, companyId, input.toLocationId),
      input.onlyIf,
    );
    out.push(
      db.insert(stockLedger).select(
        db
          .select(
            bundleRowSelect(ctx, {
              voucherType: "move",
              voucherId: input.voucherId,
              // − rows take odd lines, their + rows the even line after.
              line: lineByRowNumber(partIdx * LEDGER_IN_CHUNK * 2, 2, 1),
              sign: -1,
              reason: input.reason,
            }),
          )
          .from(bundle)
          .where(and(movable, bundleOnLedger(db))),
      ),
      db.update(bundle).set({ locationId: input.toLocationId, serverSeq: ctx.seq }).where(movable),
    );
  });
  out.push(
    db.insert(stockLedger).select(
      db
        .select({
          id: sqlUuid.as("id"),
          companyId: sql<string>`${companyId}`.as("company_id"),
          serverSeq: sql<number>`${ctx.seq}`.as("server_seq"),
          voucherType: sql<LedgerVoucherType>`'move'`.as("voucher_type"),
          voucherId: sql<string>`${input.voucherId}`.as("voucher_id"),
          line: sql<number>`${ledgerCol("line")} + 1`.as("line"),
          itemKind: sql<"bundle">`'bundle'`.as("item_kind"),
          itemRef: sql<string>`${outerBundle("id")}`.as("item_ref"),
          locationId: sql<string | null>`${outerBundle("location_id")}`.as("location_id"),
          qtyG: sql<number>`-${ledgerCol("qty_g")}`.as("qty_g"),
          postedAt: sql<number>`${ledgerCol("posted_at")}`.as("posted_at"),
          reversalOf: sql<string | null>`null`.as("reversal_of"),
          reason: sql<string | null>`${input.reason ?? null}`.as("reason"),
          createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
          createdAt: sql<number>`${Date.now()}`.as("created_at"),
        })
        .from(stockLedger)
        .innerJoin(bundle, and(eq(bundle.companyId, stockLedger.companyId), eq(bundle.id, stockLedger.itemRef)))
        .where(
          and(
            eq(stockLedger.companyId, companyId),
            eq(stockLedger.voucherType, "move"),
            eq(stockLedger.voucherId, input.voucherId),
            sql`${stockLedger.qtyG} < 0`,
            eq(bundle.serverSeq, ctx.seq),
            eq(bundle.locationId, input.toLocationId),
          ),
        ),
    ),
  );
  return out;
}

/**
 * Void: reversal of the bundle's pack (or opening / restore) row, at wherever the bundle sits now.
 * Run AFTER the bundle UPDATE to `void` in the same batch; lands only if that UPDATE did.
 */
export function voidRows(
  ctx: PostingCtx,
  input: { bundleId: string; voucherId: string; reason?: string | null },
): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select(
        bundleRowSelect(ctx, {
          voucherType: "void",
          voucherId: input.voucherId,
          line: sql<number>`1`,
          sign: -1,
          reversalOf: latestBundleRow(["pack", "opening", "restore"], true),
          reason: input.reason,
        }),
      )
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, ctx.companyId),
          eq(bundle.id, input.bundleId),
          eq(bundle.status, "void"),
          eq(bundle.serverSeq, ctx.seq),
          bundleOnLedger(db),
        ),
      ),
  );
}

/** Restore (void → available): the bundle is packed again; reverses its latest void row. Run AFTER the UPDATE. */
export function restoreRows(
  ctx: PostingCtx,
  input: { bundleId: string; voucherId: string; reason?: string | null },
): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select(
        bundleRowSelect(ctx, {
          voucherType: "restore",
          voucherId: input.voucherId,
          line: sql<number>`1`,
          sign: 1,
          reversalOf: latestBundleRow(["void"], false),
          reason: input.reason,
        }),
      )
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, ctx.companyId),
          eq(bundle.id, input.bundleId),
          eq(bundle.status, "available"),
          eq(bundle.serverSeq, ctx.seq),
          bundleOnLedger(db),
        ),
      ),
  );
}

/**
 * Phantom void (approval `phantom_void`, PL-10): reversal of the pack / opening / restore row of
 * every bundle this decision voided, at wherever the bundle sits. Voucher = the bundle's count
 * line (line 1), so each reversal names the count that called it a phantom. Run AFTER the bundle
 * UPDATE to `void` (stamped with the decision's seq); lands only for bundles that UPDATE voided.
 */
export function phantomVoidRows(ctx: PostingCtx, input: { approvalId: string }): SqliteBatchItem {
  const { db, companyId } = ctx;
  const line = (column: string) => sql`${sql.identifier("count_line")}.${sql.identifier(column)}`;
  return db.insert(stockLedger).select(
    db
      .select(
        bundleRowSelect(ctx, {
          voucherType: "void",
          voucherId: sql<string>`${line("id")}`,
          line: sql<number>`1`,
          sign: -1,
          reversalOf: latestBundleRow(["pack", "opening", "restore"], true),
          reason: sql<string>`'Phantom at count ' || coalesce((
            select cs.number from count_session cs
            where cs.id = ${line("session_id")} and cs.company_id = ${line("company_id")}
          ), '')`,
        }),
      )
      .from(bundle)
      .innerJoin(countLine, and(eq(countLine.companyId, bundle.companyId), eq(countLine.bundleId, bundle.id)))
      .where(
        and(
          eq(bundle.companyId, companyId),
          eq(bundle.status, "void"),
          eq(bundle.serverSeq, ctx.seq),
          eq(countLine.companyId, companyId),
          eq(countLine.approvalId, input.approvalId),
          eq(countLine.kind, "phantom"),
          eq(countLine.resolution, "void_requested"),
          bundleOnLedger(db),
        ),
      ),
  );
}

/**
 * Dispatch complete (DN): − bundle kg at its location for every bundle this request moved to
 * `dispatched` on `dispatchId`. Run AFTER the bundle UPDATE; `guard` is the caller's "our
 * completion landed" EXISTS (completedBySeq). One statement, no id list, any dispatch size.
 */
export function dispatchRows(ctx: PostingCtx, input: { dispatchId: string; guard: SQL }): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select(
        bundleRowSelect(ctx, {
          voucherType: "dispatch",
          voucherId: input.dispatchId,
          line: lineByRowNumber(0),
          sign: -1,
        }),
      )
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, ctx.companyId),
          eq(bundle.currentDispatchId, input.dispatchId),
          eq(bundle.status, "dispatched"),
          eq(bundle.serverSeq, ctx.seq),
          input.guard,
          bundleOnLedger(db),
        ),
      ),
  );
}

/**
 * Opening balance: + rows for every in-stock bundle of the company that has no ledger rows yet,
 * at its current location (NULL when unknown). Idempotent: a second run finds nothing to post.
 */
export function openingRows(ctx: PostingCtx, input: { voucherId: string }): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select(
        bundleRowSelect(ctx, {
          voucherType: "opening",
          voucherId: input.voucherId,
          line: lineByRowNumber(0),
          sign: 1,
        }),
      )
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, ctx.companyId),
          inArray(bundle.status, [...IN_STOCK_STATUSES]),
          notExists(
            db
              .select({ one: sql`1` })
              .from(stockLedger)
              .where(
                and(
                  eq(stockLedger.companyId, bundle.companyId),
                  eq(stockLedger.itemKind, "bundle"),
                  eq(stockLedger.itemRef, bundle.id),
                ),
              ),
          ),
        ),
      ),
  );
}

// ---------------------------------------------------------------------------
// Scrap (spec P14, §5 "Purchase lot OK → + scrap (item+grade) @ scrap store, FC kg minus approved
// D/C deduction"). item_kind `scrap_grade`, item_ref `{scrapItemId}:{scrapGradeId}`
// (lib/purchase.ts scrapItemRef); the lot is the voucher, so draws can be traced per lot later.
// ---------------------------------------------------------------------------

/** A purchase_lot column, table-qualified (correlated subqueries must not bind to their own table). */
function lotCol(column: string): SQL {
  return sql`${sql.identifier("purchase_lot")}.${sql.identifier(column)}`;
}

const scrapRefOfLot = sql<string>`${lotCol("scrap_item_id")} || ':' || ${lotCol("scrap_grade_id")}`;

/**
 * Lot OK: + (FC kg − bori of the lot's D/C notes approved so far) at the lot's scrap store. Run
 * AFTER the lot UPDATE to `ok` (which stamps this request's `server_seq` and the location); lands
 * only if that UPDATE did, so a lost race posts nothing. A note approved later posts its own
 * deduction (`dcNoteDeductionRows`); batches are serial, so each deduction is counted once.
 */
export function lotOkRows(ctx: PostingCtx, input: { lotId: string }): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${ctx.companyId}`.as("company_id"),
        serverSeq: sql<number>`${ctx.seq}`.as("server_seq"),
        voucherType: sql<LedgerVoucherType>`'purchase_lot'`.as("voucher_type"),
        voucherId: sql<string>`${lotCol("id")}`.as("voucher_id"),
        line: sql<number>`1`.as("line"),
        itemKind: sql<"scrap_grade">`'scrap_grade'`.as("item_kind"),
        itemRef: scrapRefOfLot.as("item_ref"),
        locationId: sql<string | null>`${lotCol("location_id")}`.as("location_id"),
        qtyG: sql<number>`${lotCol("fc_kg_g")} - coalesce((
          select sum(n.bori_deduction_g) from ${dcNote} n
          where n.company_id = ${lotCol("company_id")} and n.lot_id = ${lotCol("id")} and n.status = 'approved'
        ), 0)`.as("qty_g"),
        postedAt: sql<number>`${ctx.postedAt.getTime()}`.as("posted_at"),
        reversalOf: sql<string | null>`null`.as("reversal_of"),
        reason: sql<string | null>`${lotCol("number")}`.as("reason"),
        createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(purchaseLot)
      .where(
        and(
          eq(purchaseLot.companyId, ctx.companyId),
          eq(purchaseLot.id, input.lotId),
          eq(purchaseLot.status, "ok"),
          eq(purchaseLot.serverSeq, ctx.seq),
          sql`${lotCol("fc_kg_g")} is not null`,
        ),
      ),
  );
}

/**
 * D/C note approved after its lot was OK: − bori deduction at the lot's location, same item_ref.
 * Run AFTER the note UPDATE to `approved` (stamped with this decision's seq); lands only if that
 * landed, the lot is still OK and its OK posting exists. Before OK, the OK posting subtracts it.
 */
export function dcNoteDeductionRows(ctx: PostingCtx, input: { noteId: string }): SqliteBatchItem {
  const { db } = ctx;
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${ctx.companyId}`.as("company_id"),
        serverSeq: sql<number>`${ctx.seq}`.as("server_seq"),
        voucherType: sql<LedgerVoucherType>`'dc_note'`.as("voucher_type"),
        voucherId: sql<string>`${sql.identifier("dc_note")}.${sql.identifier("id")}`.as("voucher_id"),
        line: sql<number>`1`.as("line"),
        itemKind: sql<"scrap_grade">`'scrap_grade'`.as("item_kind"),
        itemRef: scrapRefOfLot.as("item_ref"),
        locationId: sql<string | null>`${lotCol("location_id")}`.as("location_id"),
        qtyG: sql<number>`-${sql.identifier("dc_note")}.${sql.identifier("bori_deduction_g")}`.as("qty_g"),
        postedAt: sql<number>`${ctx.postedAt.getTime()}`.as("posted_at"),
        reversalOf: sql<string | null>`null`.as("reversal_of"),
        reason: sql<string | null>`${sql.identifier("dc_note")}.${sql.identifier("number")}`.as("reason"),
        createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(dcNote)
      .innerJoin(purchaseLot, and(eq(purchaseLot.id, dcNote.lotId), eq(purchaseLot.companyId, dcNote.companyId)))
      .where(
        and(
          eq(dcNote.companyId, ctx.companyId),
          eq(dcNote.id, input.noteId),
          eq(dcNote.status, "approved"),
          eq(dcNote.serverSeq, ctx.seq),
          sql`${dcNote.boriDeductionG} > 0`,
          eq(purchaseLot.status, "ok"),
          exists(
            db
              .select({ one: sql`1` })
              .from(stockLedger)
              .where(
                and(
                  eq(stockLedger.companyId, ctx.companyId),
                  eq(stockLedger.voucherType, "purchase_lot"),
                  sql`${stockLedger.voucherId} = ${lotCol("id")}`,
                ),
              ),
          ),
        ),
      ),
  );
}

/** WHERE (over `l`, an alias of stock_ledger) for every scrap posting of a lot: its OK row and its notes' deductions. */
function lotPostingsWhere(l: string, companyId: string, lotId: string): SQL {
  const c = (col: string) => sql`${sql.identifier(l)}.${sql.identifier(col)}`;
  return sql`${c("company_id")} = ${companyId} and ${c("item_kind")} = 'scrap_grade' and (
    (${c("voucher_type")} = 'purchase_lot' and ${c("voucher_id")} = ${lotId})
    or (${c("voucher_type")} = 'dc_note' and ${c("voucher_id")} in (
      select n.id from ${dcNote} n where n.company_id = ${companyId} and n.lot_id = ${lotId}
    ))
  )`;
}

/**
 * Write-time guard for cancelling an OK lot: no live melt has drawn from the lot (PL-5 records the
 * lot on every melt line), and the lot's item+grade at its location still holds at least what the
 * lot put there, so the reversal cannot drive scrap stock negative.
 */
export function lotCancelLeavesStockNonNegative(companyId: string, lotId: string): SQL {
  return sql`${lotHasNoLiveDraws(companyId, sql`${lotId}`)} and coalesce((
      select sum(b.qty_g) from ${stockLedger} b
      where b.company_id = ${companyId} and b.item_kind = 'scrap_grade'
        and b.item_ref = ${scrapRefOfLot} and b.location_id is ${lotCol("location_id")}
    ), 0) >= coalesce((select sum(l.qty_g) from ${stockLedger} l where ${lotPostingsWhere("l", companyId, lotId)}), 0)`;
}

/**
 * Cancel of an OK lot: one reversal row (`reversal_of`) for each of the lot's scrap postings not
 * reversed yet. Run AFTER the lot UPDATE to `cancelled` (stamped with this request's seq).
 */
export function lotCancelRows(ctx: PostingCtx, input: { lotId: string; reason?: string | null }): SqliteBatchItem {
  const { db, companyId } = ctx;
  const orig = alias(stockLedger, "orig");
  const o = (col: string) => sql`${sql.identifier("orig")}.${sql.identifier(col)}`;
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${companyId}`.as("company_id"),
        serverSeq: sql<number>`${ctx.seq}`.as("server_seq"),
        voucherType: sql<LedgerVoucherType>`'purchase_lot_cancel'`.as("voucher_type"),
        voucherId: sql<string>`${input.lotId}`.as("voucher_id"),
        line: sql<number>`row_number() over (order by ${o("posted_at")}, ${o("voucher_type")}, ${o("line")})`.as("line"),
        itemKind: sql<"scrap_grade">`'scrap_grade'`.as("item_kind"),
        itemRef: sql<string>`${o("item_ref")}`.as("item_ref"),
        locationId: sql<string | null>`${o("location_id")}`.as("location_id"),
        qtyG: sql<number>`-${o("qty_g")}`.as("qty_g"),
        postedAt: sql<number>`max(${ctx.postedAt.getTime()}, ${o("posted_at")} + 1)`.as("posted_at"),
        reversalOf: sql<string | null>`${o("id")}`.as("reversal_of"),
        reason: sql<string | null>`${input.reason ?? null}`.as("reason"),
        createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(orig)
      .where(
        and(
          lotPostingsWhere("orig", companyId, input.lotId),
          sql`not exists (select 1 from ${stockLedger} r where r.company_id = ${companyId} and r.reversal_of = ${o("id")})`,
          sql`exists (select 1 from ${purchaseLot} p where p.id = ${input.lotId} and p.company_id = ${companyId} and p.status = 'cancelled' and p.server_seq = ${ctx.seq})`,
        ),
      ),
  );
}

// ---------------------------------------------------------------------------
// Default locations (spec P6): seeded per company by stock.locations.seedDefaults and dev seed.
// ---------------------------------------------------------------------------

export const DEFAULT_LOCATIONS: readonly { code: string; name: string; kind: LocationKind }[] = [
  { code: "Y1", name: "Yard 1", kind: "yard" },
  { code: "Y2", name: "Yard 2", kind: "yard" },
  { code: "Y3", name: "Yard 3", kind: "yard" },
  { code: "Y4", name: "Yard 4", kind: "yard" },
  { code: "Y5", name: "Yard 5", kind: "yard" },
  { code: "Y6", name: "Yard 6", kind: "yard" },
  { code: "BILLET", name: "Billet store", kind: "billet_store" },
  { code: "SCRAP", name: "Scrap yard", kind: "scrap_store" },
  { code: "STORE", name: "Central store", kind: "store" },
  { code: "PLANT-SCRAP", name: "Plant scrap", kind: "wip" },
];

/** Insert the default locations a company is missing (by code); existing ones are untouched. */
export function defaultLocationStatements(
  db: OrrnDb,
  companyId: string,
  opts: { userId: string | null; seq?: number; idFor?: (code: string) => string },
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  pushChunkedInserts(
    out,
    (rows) => db.insert(location).values(rows).onConflictDoNothing({ target: [location.companyId, location.code] }),
    DEFAULT_LOCATIONS.map((l, idx) => ({
      id: opts.idFor ? opts.idFor(l.code) : crypto.randomUUID(),
      companyId,
      serverSeq: opts.seq ?? 0,
      code: l.code,
      name: l.name,
      kind: l.kind,
      active: true,
      sortOrder: idx + 1,
      createdBy: opts.userId,
    })),
  );
  return out;
}

/** WHERE for "this company's ledger rows", optionally as of an instant. */
export function ledgerScope(companyId: string, at?: Date) {
  return and(eq(stockLedger.companyId, companyId), at ? sql`${stockLedger.postedAt} <= ${at.getTime()}` : undefined);
}

