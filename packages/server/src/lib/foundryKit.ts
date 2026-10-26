/**
 * Shared pieces of the foundry routers (W2-FD-S): the context shape, the refusals every foundry
 * procedure uses, cast / lot / stream loaders, and the reversal of a locked melt (cancel and
 * correction share it). Moved out of `routers/foundry.ts` so the melt stepper (`foundryMelt.ts`)
 * and the masters can use them without an import cycle.
 */
import { spectroCheck, spectroElementKey, SpectroRefusal, type SpectroPpm } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { alloy, alloyLimit, cast, melt, meltChemical, returnStream, type CastRow, type SpectroLimitsSnapshot } from "@orrn/db/schema/foundry";
import { purchaseLot } from "@orrn/db/schema/purchase";
import { location, stockLedger, type LedgerVoucherType } from "@orrn/db/schema/stock";
import { storeItem, storeTxn } from "@orrn/db/schema/store";

import type { Context } from "../context";
import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { mapInChunks } from "./atomic";
import { DROSS_STREAM, foundryAbort, lotRemainingSql, OUTER_LOT_ID } from "./foundry";
import { storeCancelMark, storeCancelRows } from "./store";

export type Ctx = Pick<Context, "db" | "session" | "impersonation"> & {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
};

export const sqlUuid = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

export const CAST_NOT_FOUND = { code: "NOT_FOUND", message: "Cast not found" } as const;

export const MELT_NOT_FOUND = { code: "NOT_FOUND", message: "Melt not found" } as const;

export function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

export async function loadCast(ctx: Pick<Ctx, "db" | "companyId">, castId: string): Promise<CastRow> {
  const [row] = await ctx.db
    .select()
    .from(cast)
    .where(and(eq(cast.id, castId), eq(cast.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(CAST_NOT_FOUND);
  return row;
}

export function castStateMessage(c: Pick<CastRow, "number" | "status">): string {
  return c.status === "closed"
    ? `${c.number} is closed`
    : c.status === "closing"
      ? `${c.number} is waiting for its close-out approval`
      : `${c.number} changed; open it again`;
}

export type LotForMelt = {
  id: string;
  number: string;
  status: string;
  locationId: string | null;
  scrapItemId: string;
  scrapGradeId: string;
  remainingG: number;
};

export async function lotsForMelt(ctx: Ctx, lotIds: string[]): Promise<Map<string, LotForMelt>> {
  const remaining = lotRemainingSql(ctx.companyId, OUTER_LOT_ID);
  const rows = await mapInChunks(
    lotIds,
    (ids) =>
      ctx.db
        .select({
          id: purchaseLot.id,
          number: purchaseLot.number,
          status: purchaseLot.status,
          locationId: purchaseLot.locationId,
          scrapItemId: purchaseLot.scrapItemId,
          scrapGradeId: purchaseLot.scrapGradeId,
          remainingG: remaining,
        })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.id, ids))),
    60,
  );
  return new Map(rows.map((r) => [r.id, { ...r, remainingG: Number(r.remainingG) }]));
}

export async function streamsByIds(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof returnStream.$inferSelect>();
  const rows = await mapInChunks(ids, (part) =>
    ctx.db
      .select()
      .from(returnStream)
      .where(and(eq(returnStream.companyId, ctx.companyId), inArray(returnStream.id, part))),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** The by-product stream dross / Fe posts to: it must exist, be active and be a by-product. */
export async function streamByCode(ctx: Ctx, code: string) {
  const label = code === DROSS_STREAM ? "Dross" : "Fe";
  const [row] = await ctx.db
    .select()
    .from(returnStream)
    .where(and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.code, code)))
    .limit(1);
  if (!row) bad(`Add the ${label} return stream first (Masters → Return streams)`);
  if (!row.active) bad(`The ${label} return stream (${code}) is retired; reactivate it first (Masters → Return streams)`);
  if (row.kind !== "byproduct") bad(`The ${code} return stream must be a by-product stream to take ${label.toLowerCase()}`);
  return row;
}

/** EXISTS: the stream is still active and of `kind` (write-time guard for output streams). */
export function activeStream(companyId: string, streamId: string, kind: "charge" | "byproduct") {
  return sql`exists (select 1 from ${returnStream} os where os.id = ${streamId} and os.company_id = ${companyId} and os.active = 1 and os.kind = ${kind})`;
}

/** The melt's store draws not cancelled yet, with what a cancel would return them to. */
export async function liveMeltDraws(ctx: Ctx, meltId: string) {
  return ctx.db
    .select({
      id: storeTxn.id,
      number: storeTxn.number,
      itemName: storeItem.name,
      itemActive: storeItem.active,
      locationCode: location.code,
      locationActive: location.active,
      locationKind: location.kind,
    })
    .from(meltChemical)
    .innerJoin(storeTxn, and(eq(storeTxn.id, meltChemical.storeTxnId), eq(storeTxn.companyId, meltChemical.companyId)))
    .leftJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
    .leftJoin(location, and(eq(location.id, storeTxn.locationId), eq(location.companyId, storeTxn.companyId)))
    .where(and(eq(meltChemical.companyId, ctx.companyId), eq(meltChemical.meltId, meltId), isNull(storeTxn.cancelledAt)));
}

/**
 * Cancelling a melt puts its chemicals back in the store. Like `store.cancel` (ruling PL7RR), it
 * never puts stock on a retired item or into a retired / re-typed store location: this read gives
 * the melt-side message; `storeCancelRows` holds the same rule at write time (nothing lands, the
 * cancel's store abort fails the batch).
 */
export function storeReturnBlock(draws: Awaited<ReturnType<typeof liveMeltDraws>>): string | null {
  for (const d of draws) {
    if (!d.itemActive) return `${d.itemName ?? d.number} is retired in the store; reactivate it first (cancelling the melt returns it)`;
    if (!d.locationActive || d.locationKind !== "store") {
      return `${d.locationCode ?? "The store location"} is retired; reactivate it first (cancelling the melt returns ${d.itemName ?? d.number} there)`;
    }
  }
  return null;
}

/**
 * Reverse every ledger row of a locked melt (`melt_cancel`, `reversal_of`) and cancel its store
 * draws, guarded on the melt having been marked by this batch (`server_seq = seq` and cancelled).
 * The caller writes the melt UPDATE before these; a lost guard inserts nothing and the caller's
 * abort fails the batch.
 */
export function meltReversalStatements(
  db: OrrnDb,
  input: {
    companyId: string;
    meltId: string;
    seq: number;
    at: Date;
    userId: string;
    reason: string;
    storeTxnIds: readonly string[];
    storeReason: string;
  },
): SqliteBatchItem[] {
  const { companyId, meltId, seq, at, userId, reason } = input;
  const orig = alias(stockLedger, "orig");
  const o = (col: string) => sql`${sql.identifier("orig")}.${sql.identifier(col)}`;
  const out: SqliteBatchItem[] = [
    db.insert(stockLedger).select(
      db
        .select({
          id: sqlUuid.as("id"),
          companyId: sql<string>`${o("company_id")}`.as("company_id"),
          serverSeq: sql<number>`${seq}`.as("server_seq"),
          voucherType: sql<LedgerVoucherType>`'melt_cancel'`.as("voucher_type"),
          voucherId: sql<string>`${o("voucher_id")}`.as("voucher_id"),
          line: sql<number>`${o("line")}`.as("line"),
          itemKind: sql<string>`${o("item_kind")}`.as("item_kind"),
          itemRef: sql<string>`${o("item_ref")}`.as("item_ref"),
          locationId: sql<string | null>`${o("location_id")}`.as("location_id"),
          qtyG: sql<number>`-${o("qty_g")}`.as("qty_g"),
          postedAt: sql<number>`max(${at.getTime()}, ${o("posted_at")} + 1)`.as("posted_at"),
          reversalOf: sql<string>`${o("id")}`.as("reversal_of"),
          reason: sql<string>`${reason}`.as("reason"),
          createdBy: sql<string>`${userId}`.as("created_by"),
          createdAt: sql<number>`${at.getTime()}`.as("created_at"),
        })
        .from(orig)
        .where(
          and(
            eq(orig.companyId, companyId),
            eq(orig.voucherType, "melt"),
            eq(orig.voucherId, meltId),
            sql`not exists (select 1 from ${stockLedger} r where r.company_id = ${companyId} and r.reversal_of = ${o("id")})`,
            sql`exists (select 1 from ${melt} cm where cm.id = ${meltId} and cm.company_id = ${companyId} and cm.server_seq = ${seq} and cm.cancelled_at is not null)`,
          ),
        ),
    ),
  ];
  for (const txnId of input.storeTxnIds) {
    const cancelInput = { companyId, seq, txnId, exchangeId: null, userId, at, reason: input.storeReason };
    out.push(storeCancelRows(db, cancelInput), storeCancelMark(db, cancelInput));
  }
  if (input.storeTxnIds.length > 0) {
    out.push(
      foundryAbort(
        db,
        companyId,
        sql`(select count(*) from ${storeTxn} st where st.company_id = ${companyId} and st.server_seq = ${seq} and st.cancelled_at is not null and st.id in (${sql.join(
          input.storeTxnIds.map((t) => sql`${t}`),
          sql`, `,
        )})) < ${input.storeTxnIds.length}`,
      ),
    );
  }
  return out;
}

/**
 * Spectro values judged against the melt's alloy limits as they are now (FP-FD-10): per-element
 * ppm columns, Al (measured or balance), the verdict and the limits snapshot the result keeps (a
 * later limit edit rewrites no verdict). Keys are element symbols in any case (`Si`, `si`); others
 * stay in `values_ppm` only. A sum of the eight above 100 % refuses.
 */
export async function spectroJudge(
  db: OrrnDb,
  companyId: string,
  alloyRef: { alloyId: string | null; alloyCode: string },
  valuesPpm: Record<string, number>,
) {
  let alloyId = alloyRef.alloyId;
  if (!alloyId) {
    const [a] = await db
      .select({ id: alloy.id })
      .from(alloy)
      .where(and(eq(alloy.companyId, companyId), eq(alloy.code, alloyRef.alloyCode)))
      .limit(1);
    alloyId = a?.id ?? null;
  }
  const limits = alloyId
    ? await db
        .select({ element: alloyLimit.element, minPpm: alloyLimit.minPpm, maxPpm: alloyLimit.maxPpm })
        .from(alloyLimit)
        .where(and(eq(alloyLimit.companyId, companyId), eq(alloyLimit.alloyId, alloyId)))
    : [];
  const ppm: SpectroPpm = {};
  for (const [k, v] of Object.entries(valuesPpm)) {
    const el = spectroElementKey(k);
    if (el) ppm[el] = v;
  }
  let check: ReturnType<typeof spectroCheck>;
  try {
    check = spectroCheck(ppm, limits);
  } catch (e) {
    if (e instanceof SpectroRefusal) bad(e.code === "over_million" ? "The eight elements add up to more than 100 %" : "Spectro values must be whole ppm from 0 to 1,000,000");
    throw e;
  }
  const snapshot: SpectroLimitsSnapshot = { alloyId, alloyCode: alloyRef.alloyCode, limits };
  return {
    siPpm: ppm.si ?? null,
    fePpm: ppm.fe ?? null,
    cuPpm: ppm.cu ?? null,
    mnPpm: ppm.mn ?? null,
    mgPpm: ppm.mg ?? null,
    znPpm: ppm.zn ?? null,
    tiPpm: ppm.ti ?? null,
    crPpm: ppm.cr ?? null,
    alPpm: check.alPpm,
    alSource: check.alSource,
    verdict: check.verdict,
    limitsSnapshot: snapshot,
  };
}
