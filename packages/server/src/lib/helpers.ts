import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { Context } from "../context";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { auditInsert, type AuditInput } from "./audit";
import { nextCompanySeq } from "./sequence";

/**
 * Find a single row from `table` scoped by `companyId` and `id`.
 * Throws a TRPCError with code "NOT_FOUND" when no row exists.
 *
 * All tenant-scoped tables are expected to have `id` and `companyId` columns.
 * This is a thin wrapper around `db.select().from(table).where(…)` to eliminate
 * the repetitive "find + throw" pattern in nearly every get/update/delete procedure.
 *
 * @example
 * const dispatch = await scopedFindOrThrow(ctx.db, dispatchTable, input.id, ctx.companyId);
 */
export async function scopedFindOrThrow<T extends Record<string, unknown>>(
  db: OrrnDb,
  table: SQLiteTable,
  id: string,
  companyId: string,
  opts: { softDeleteField?: string; message?: string } = {},
): Promise<T> {
  const dynamicTable = table as unknown as {
    id: AnySQLiteColumn;
    companyId: AnySQLiteColumn;
  } & Record<string, AnySQLiteColumn | undefined>;
  const conditions = [
    eq(dynamicTable.id, id),
    eq(dynamicTable.companyId, companyId),
  ];

  if (opts.softDeleteField) {
    const softDeleteColumn = dynamicTable[opts.softDeleteField];
    if (softDeleteColumn) {
      conditions.push(isNull(softDeleteColumn));
    }
  }

  const [row] = await db
    .select()
    .from(table)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: opts.message ?? "Resource not found",
    });
  }

  return row as unknown as T;
}

/**
 * Allocate the next tenant sequence, run an atomic write batch, and append an
 * audit row. The caller owns the domain-specific writes; this helper owns the
 * repeated sequence + audit ceremony.
 */
export async function withAudit(
  ctx: Pick<Context, "db" | "companyId" | "session" | "impersonation"> & {
    companyId: string;
  },
  input: AuditInput & { subjectId?: string },
  writeFn: (opts: { id: string; serverSeq: number }) => SqliteBatchItem[],
): Promise<{ id: string; serverSeq: number }> {
  const id = input.subjectId ?? crypto.randomUUID();
  const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

  await atomicBatch(ctx.db, [
    ...writeFn({ id, serverSeq }),
    auditInsert(ctx, {
      action: input.action,
      subjectType: input.subjectType,
      subjectId: id,
      meta: input.meta,
    }),
  ]);

  return { id, serverSeq };
}

/**
 * Run a paginated select query against `table` with an automatic total-count query.
 *
 * Returns `{ items, total, limit, offset }`. This standardises the most common
 * list endpoint pattern across routers (customer.list, die.list, etc.).
 *
 * @example
 * const result = await paginatedList(ctx.db, {
 *   table: customer,
 *   where: and(eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)),
 *   limit: input.limit,
 *   offset: input.offset,
 *   orderBy: [desc(customer.createdAt)],
 * });
 */
export async function paginatedList<T>(
  db: OrrnDb,
  opts: {
    /** The Drizzle table object to select from. */
    table: SQLiteTable;
    /** Optional WHERE clause (e.g. `and(eq(…), isNull(…))`). */
    where?: SQL | undefined;
    /** Maximum number of rows to return. */
    limit: number;
    /** Number of rows to skip. */
    offset: number;
    /** ORDER BY expressions (e.g. `[desc(table.createdAt)]`). */
    orderBy?: AnySQLiteColumn[] | SQL[] | undefined;
    /**
     * Optional field selection object passed to `db.select(fields)`.
     * When omitted all columns are selected.
     */
    select?: Record<string, unknown> | undefined;
  },
): Promise<{ items: T[]; total: number; limit: number; offset: number }> {
  // Build the query – cast through `any` so we can dynamically attach
  // where/orderBy/limit/offset regardless of whether a custom select was given.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = opts.select
    ? db.select(opts.select as any).from(opts.table)
    : db.select().from(opts.table);

  if (opts.where) {
    query = query.where(opts.where);
  }

  if (opts.orderBy && opts.orderBy.length > 0) {
    query = query.orderBy(...(opts.orderBy as [AnySQLiteColumn, ...AnySQLiteColumn[]]));
  }

  const items: T[] = await query.limit(opts.limit).offset(opts.offset);

  // Total count (always unfiltered except by WHERE)
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opts.table)
    .where(opts.where);

  return {
    items,
    total: totalRow?.count ?? 0,
    limit: opts.limit,
    offset: opts.offset,
  };
}

/**
 * Assert that no row matching the `where` condition exists in `table`.
 * Throws a TRPCError with code "CONFLICT" if a match is found.
 *
 * Used for uniqueness checks in create/update procedures
 * (e.g. die series+sectionCode, customer name, dispatch code).
 *
 * @example
 * await assertNoDuplicate(ctx.db, {
 *   table: die,
 *   where: and(
 *     eq(die.companyId, ctx.companyId),
 *     eq(die.series, input.series),
 *     eq(die.sectionCode, input.sectionCode),
 *     isNull(die.deletedAt),
 *   ),
 *   message: "A die with this series and section code already exists",
 * });
 */
export async function assertNoDuplicate(
  db: OrrnDb,
  opts: {
    /** The Drizzle table object to query. */
    table: SQLiteTable;
    /** WHERE clause that identifies a duplicate (e.g. `and(eq(…), eq(…))`). */
    where: SQL;
    /** Custom error message. Defaults to "Duplicate record already exists". */
    message?: string;
  },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(opts.table)
    .where(opts.where)
    .limit(1);

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: opts.message ?? "Duplicate record already exists",
    });
  }
}
