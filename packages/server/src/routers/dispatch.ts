import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import {
  dispatch,
  dispatchItem,
  dispatchStatuses,
  type DispatchStatus,
} from "@orrn/db/schema/dispatch";
import { bundle, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { DISPATCH_TRANSITIONS, normalizeSerial } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import {
  atomicBatch,
  chunk,
  IN_LIST_CHUNK,
  mapInChunks,
  pushChunkedInserts,
  type SqliteBatchItem,
} from "../lib/atomic";
import { bundleBlockReason, holdingDispatchCodes } from "../lib/bundleHold";
import { formatDispatchCode } from "../lib/dispatchCode";
import { nextCompanySeq } from "../lib/sequence";
import { appendPackingListWrites } from "./packingList";

/*
 * State predicates (audit S6): every write re-states the status it expects —
 * bundle UPDATEs carry `status = <expected>` (and `current_dispatch_id = <this
 * dispatch>` when releasing or dispatching), dispatch UPDATEs carry
 * `status IN (<allowed from>)`. Each procedure also reads and checks state
 * before writing, so sequential misuse (complete after cancel, …) errors.
 *
 * Residual race (audit S6, FLAG): a D1 batch can't abort when a guarded UPDATE
 * matches 0 rows, so two truly concurrent requests can still both pass their
 * reads and let the batch's INSERTs (items, status events, audit) land beside a
 * no-op UPDATE. The predicates keep bundle/dispatch status itself from being
 * corrupted; closing the gap fully needs real transactions (Postgres rebuild).
 */

/** Statuses a dispatch may move to `to` from, per the shared domain table. */
function dispatchStatusesInto(to: DispatchStatus): DispatchStatus[] {
  return (Object.keys(DISPATCH_TRANSITIONS) as DispatchStatus[]).filter((from) =>
    DISPATCH_TRANSITIONS[from].includes(to),
  );
}

function assertDispatchTransition(from: DispatchStatus, to: DispatchStatus) {
  const allowed = DISPATCH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Dispatch transition ${from} -> ${to} is not allowed.`,
    });
  }
}

/** WHERE for a dispatch UPDATE: this tenant's live row, still in one of `statuses`. */
function dispatchInStatus(companyId: string, id: string, statuses: DispatchStatus[]) {
  return and(
    eq(dispatch.companyId, companyId),
    eq(dispatch.id, id),
    isNull(dispatch.deletedAt),
    inArray(dispatch.status, statuses),
  );
}

const EDITABLE_DISPATCH: DispatchStatus[] = ["draft", "reserved"];

/** The UNIQUE(dispatch_id, bundle_id) index fired: a concurrent add of the same bundle won. */
function isDuplicateItemError(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    const message = cur instanceof Error ? cur.message : String(cur);
    if (message.includes("UNIQUE constraint failed: dispatch_item")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: { serial: string; reason: string }[];
};

const createInput = z.object({
  customerId: z.string().min(1, "Customer is required"),
  shipDate: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateInput = z.object({
  id: z.string(),
  customerId: z.string().optional(),
  shipDate: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const dispatchRouter = router({
  create: actionProcedure("dispatch.create")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const customerRow = await ctx.db.query.customer.findFirst({
        where: and(
          eq(customer.id, input.customerId),
          eq(customer.companyId, ctx.companyId),
          isNull(customer.deletedAt),
        ),
      });
      if (!customerRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const id = crypto.randomUUID();
      const userId = ctx.session.user.id;

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const code = formatDispatchCode(seq);

      await atomicBatch(ctx.db, [
        ctx.db.insert(dispatch).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          code,
          customerId: input.customerId,
          status: "draft",
          shipDate: input.shipDate ? new Date(input.shipDate) : null,
          notes: input.notes ?? null,
          createdBy: userId,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.create",
            subjectType: "dispatch",
            subjectId: id,
            meta: { code, customerId: input.customerId },
          },
        ),
      ]);

      return { success: true, id, code };
    }),

  listDispatches: companyProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(dispatchStatuses).optional(),
        customerId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)];
      if (input.status) conditions.push(eq(dispatch.status, input.status));
      if (input.customerId) conditions.push(eq(dispatch.customerId, input.customerId));
      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          or(like(dispatch.code, pattern), like(dispatch.notes, pattern))!,
        );
      }

      const items = await ctx.db
        .select({
          id: dispatch.id,
          code: dispatch.code,
          status: dispatch.status,
          shipDate: dispatch.shipDate,
          notes: dispatch.notes,
          createdAt: dispatch.createdAt,
          customerId: dispatch.customerId,
          customerName: customer.name,
          itemCount: sql<number>`count(${dispatchItem.id})`.as("item_count"),
          totalQuantity: sql<number>`coalesce(sum(${bundle.quantity}), 0)`.as("total_quantity"),
          totalWeightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`.as("total_weight_g"),
        })
        .from(dispatch)
        .innerJoin(
          customer,
          and(eq(customer.id, dispatch.customerId), eq(customer.companyId, dispatch.companyId)),
        )
        .leftJoin(
          dispatchItem,
          and(
            eq(dispatchItem.dispatchId, dispatch.id),
            eq(dispatchItem.companyId, dispatch.companyId),
          ),
        )
        .leftJoin(
          bundle,
          and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)),
        )
        .where(and(...conditions))
        .groupBy(dispatch.id, customer.name)
        .orderBy(desc(dispatch.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRow = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(dispatch)
        .where(and(...conditions));

      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  getDispatch: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }

      const customerRow = await ctx.db.query.customer.findFirst({
        where: and(eq(customer.id, row.customerId), eq(customer.companyId, ctx.companyId)),
      });

      const items = await ctx.db
        .select({
          itemId: dispatchItem.id,
          bundleId: bundle.id,
          serial: bundle.serial,
          status: bundle.status,
          quantity: bundle.quantity,
          weightG: bundle.weightG,
          lengthMm: bundle.lengthMm,
          groupId: bundle.groupId,
          groupLabel: dispatchItem.groupLabel,
          dieId: bundle.dieId,
          dieSeries: die.series,
          dieSectionCode: die.sectionCode,
          addedAt: dispatchItem.addedAt,
        })
        .from(dispatchItem)
        .innerJoin(
          bundle,
          and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)),
        )
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(
          and(
            eq(dispatchItem.dispatchId, row.id),
            eq(dispatchItem.companyId, ctx.companyId),
          ),
        )
        .orderBy(desc(dispatchItem.addedAt))
        .limit(500);

      const events = await ctx.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ctx.companyId),
            eq(auditLog.subjectType, "dispatch"),
            eq(auditLog.subjectId, row.id),
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(20);

      return { dispatch: row, customer: customerRow ?? null, items, events };
    }),

  update: actionProcedure("dispatch.update")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      if (existing.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft dispatches can be edited",
        });
      }

      if (input.customerId && input.customerId !== existing.customerId) {
        const newCustomer = await ctx.db.query.customer.findFirst({
          where: and(
            eq(customer.id, input.customerId),
            eq(customer.companyId, ctx.companyId),
            isNull(customer.deletedAt),
          ),
        });
        if (!newCustomer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatch)
          .set({
            customerId: input.customerId ?? existing.customerId,
            shipDate:
              input.shipDate === undefined
                ? existing.shipDate
                : input.shipDate === null
                  ? null
                  : new Date(input.shipDate),
            // undefined = leave as is; null clears (audit S18).
            notes: input.notes === undefined ? existing.notes : input.notes,
            serverSeq: seq,
          })
          .where(dispatchInStatus(ctx.companyId, existing.id, ["draft"])),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.update",
            subjectType: "dispatch",
            subjectId: existing.id,
            meta: {
              customerId: input.customerId ?? existing.customerId,
              shipDate: input.shipDate ?? null,
            },
          },
        ),
      ]);
      return { success: true };
    }),

  addBundle: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = async () => {
        const d = await ctx.db.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        }
        if (d.status !== "draft" && d.status !== "reserved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bundles can only be added in draft or reserved status",
          });
        }

        const b = await ctx.db.query.bundle.findFirst({
          where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
        });
        if (!b) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
        }

        // Already-added first (audit S13): a rescan on a held dispatch finds the
        // bundle reserved by this very dispatch, which is fine, not an error.
        const existingItem = await ctx.db.query.dispatchItem.findFirst({
          where: and(
            eq(dispatchItem.companyId, ctx.companyId),
            eq(dispatchItem.dispatchId, d.id),
            eq(dispatchItem.bundleId, b.id),
          ),
        });
        if (existingItem) {
          return { success: true, added: [] as string[], alreadyInDispatch: [b.serial] };
        }

        if (b.status !== "available") {
          const codes = await holdingDispatchCodes(ctx.db, ctx.companyId, [b]);
          throw new TRPCError({ code: "BAD_REQUEST", message: bundleBlockReason(b, codes) });
        }

        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const statements: SqliteBatchItem[] = [
          ctx.db.insert(dispatchItem).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            dispatchId: d.id,
            bundleId: b.id,
          }),
        ];

        if (d.status === "reserved") {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  eq(bundle.id, b.id),
                  eq(bundle.status, "available"),
                ),
              ),
            ctx.db.insert(bundleStatusEvent).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "available",
              toStatus: "reserved",
              reason: "dispatch.addBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            }),
          );
        }

        statements.push(
          auditInsert(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            {
              action: "dispatch.addBundle",
              subjectType: "dispatch",
              subjectId: d.id,
              meta: { bundleId: b.id, serial: b.serial, dispatchStatus: d.status },
            },
          ),
        );

        await atomicBatch(ctx.db, statements);
        return { success: true, added: [b.serial], alreadyInDispatch: [] as string[] };
      };

      try {
        return await run();
      } catch (e) {
        // A concurrent scan of the same bundle inserted first; the batch rolled
        // back, so re-read: this time it reports "already in this dispatch".
        if (isDuplicateItemError(e)) return run();
        throw e;
      }
    }),

  /**
   * Adds bundles by serial and reports per serial instead of all-or-nothing:
   * already-in-this-dispatch is split out before availability (audit S13), so a
   * rescan on a held dispatch is calm, and the valid serials still go in.
   */
  addBundlesBySerial: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), serials: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ ctx, input }): Promise<AddBundlesReport> => {
      const serials = Array.from(new Set(input.serials.map(normalizeSerial).filter(Boolean)));
      if (serials.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No serials provided" });
      }

      const run = async (): Promise<AddBundlesReport> => {
        const d = await ctx.db.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        }
        if (d.status !== "draft" && d.status !== "reserved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bundles can only be added in draft or reserved status",
          });
        }

        const bundles = await mapInChunks(serials, (chunkSerials) =>
          ctx.db
            .select()
            .from(bundle)
            .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.serial, chunkSerials))),
        );
        const bySerial = new Map(bundles.map((b) => [b.serial, b]));

        const existingItemRows = await mapInChunks(
          bundles.map((b) => b.id),
          (ids) =>
            ctx.db
              .select({ bundleId: dispatchItem.bundleId })
              .from(dispatchItem)
              .where(
                and(
                  eq(dispatchItem.companyId, ctx.companyId),
                  eq(dispatchItem.dispatchId, d.id),
                  inArray(dispatchItem.bundleId, ids),
                ),
              ),
        );
        const inThisDispatch = new Set(existingItemRows.map((r) => r.bundleId));
        const codes = await holdingDispatchCodes(
          ctx.db,
          ctx.companyId,
          bundles.filter((b) => !inThisDispatch.has(b.id)),
        );

        const report: AddBundlesReport = { added: [], alreadyInDispatch: [], notFound: [], unavailable: [] };
        const toAdd: typeof bundles = [];
        for (const serial of serials) {
          const b = bySerial.get(serial);
          if (!b) report.notFound.push(serial);
          else if (inThisDispatch.has(b.id)) report.alreadyInDispatch.push(serial);
          else if (b.status !== "available") report.unavailable.push({ serial, reason: bundleBlockReason(b, codes) });
          else toAdd.push(b);
        }
        if (toAdd.length === 0) return report;

        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const statements: SqliteBatchItem[] = [];
        pushChunkedInserts(
          statements,
          (rows) => ctx.db.insert(dispatchItem).values(rows),
          toAdd.map((b) => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            dispatchId: d.id,
            bundleId: b.id,
          })),
        );

        if (d.status === "reserved") {
          const addIds = toAdd.map((b) => b.id);
          for (const ids of chunk(addIds, IN_LIST_CHUNK)) {
            statements.push(
              ctx.db
                .update(bundle)
                .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
                .where(
                  and(
                    eq(bundle.companyId, ctx.companyId),
                    inArray(bundle.id, ids),
                    eq(bundle.status, "available"),
                  ),
                ),
            );
          }
          pushChunkedInserts(
            statements,
            (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
            addIds.map((bundleId) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId,
              fromStatus: "available" as const,
              toStatus: "reserved" as const,
              reason: "dispatch.addBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            })),
          );
        }

        statements.push(
          auditInsert(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            {
              action: "dispatch.addBundle",
              subjectType: "dispatch",
              subjectId: d.id,
              meta: {
                count: toAdd.length,
                serials: toAdd.map((b) => b.serial),
                dispatchStatus: d.status,
              },
            },
          ),
        );

        await atomicBatch(ctx.db, statements);
        report.added = toAdd.map((b) => b.serial);
        return report;
      };

      try {
        return await run();
      } catch (e) {
        // A concurrent scan inserted one of these first and the whole batch
        // rolled back; re-read once so it lands in alreadyInDispatch.
        if (isDuplicateItemError(e)) return run();
        throw e;
      }
    }),

  setItemGroupLabel: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), bundleId: z.string(), groupLabel: z.string().max(32).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      if (d.status !== "draft" && d.status !== "reserved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Packing groups can only be edited before completion" });
      }

      // Audit S18: an UPDATE on a missing item used to no-op silently.
      const existingItem = await ctx.db.query.dispatchItem.findFirst({
        where: and(
          eq(dispatchItem.companyId, ctx.companyId),
          eq(dispatchItem.dispatchId, d.id),
          eq(dispatchItem.bundleId, input.bundleId),
        ),
      });
      if (!existingItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not in this dispatch" });
      }

      const label = input.groupLabel?.trim().toUpperCase() || null;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatchItem)
          .set({ groupLabel: label })
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              eq(dispatchItem.bundleId, input.bundleId),
            ),
          ),
        ctx.db
          .update(dispatch)
          .set({ serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, EDITABLE_DISPATCH)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.setPackingGroup",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: input.bundleId, groupLabel: label },
          },
        ),
      ]);
      return { success: true };
    }),

  removeBundle: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      if (d.status !== "draft" && d.status !== "reserved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bundles can only be removed in draft or reserved status",
        });
      }

      const existingItem = await ctx.db.query.dispatchItem.findFirst({
        where: and(
          eq(dispatchItem.companyId, ctx.companyId),
          eq(dispatchItem.dispatchId, d.id),
          eq(dispatchItem.bundleId, input.bundleId),
        ),
      });
      if (!existingItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not in this dispatch" });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .delete(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              eq(dispatchItem.bundleId, input.bundleId),
            ),
          ),
      ];

      if (d.status === "reserved") {
        const b = await ctx.db.query.bundle.findFirst({
          where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
        });
        // Only release a hold that belongs to this dispatch (audit S6): the
        // bundle may be held by another dispatch that also lists it.
        if (b && b.status === "reserved" && b.currentDispatchId === d.id) {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  eq(bundle.id, b.id),
                  eq(bundle.status, "reserved"),
                  eq(bundle.currentDispatchId, d.id),
                ),
              ),
            ctx.db.insert(bundleStatusEvent).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "reserved",
              toStatus: "available",
              reason: "dispatch.removeBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            }),
          );
        }
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.removeBundle",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: input.bundleId, dispatchStatus: d.status },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  reserve: actionProcedure("dispatch.reserve")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "reserved");

      const items = await ctx.db
        .select({ bundleId: dispatchItem.bundleId })
        .from(dispatchItem)
        .where(
          and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
        );

      if (items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reserve an empty dispatch",
        });
      }

      const bundleIds = items.map((i) => i.bundleId);
      const bundles = await mapInChunks(bundleIds, (ids) =>
        ctx.db
          .select()
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
      );

      const notAvailable = bundles.filter((b) => b.status !== "available");
      if (notAvailable.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cannot reserve: ${notAvailable.length} bundle(s) no longer available (${notAvailable
            .slice(0, 3)
            .map((b) => `${b.serial}=${b.status}`)
            .join(", ")}${notAvailable.length > 3 ? "…" : ""})`,
        });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      const statements: SqliteBatchItem[] = [];
      for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
        statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.status, "available"),
              ),
            ),
        );
      }
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
        bundleIds.map((bid) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: bid,
          fromStatus: "available" as const,
          toStatus: "reserved" as const,
          reason: "dispatch.reserve",
          actorId: ctx.session.user.id,
          dispatchId: d.id,
        })),
      );
      statements.push(
        ctx.db
          .update(dispatch)
          .set({ status: "reserved", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("reserved"))),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.reserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        ),
      );
      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  unreserve: actionProcedure("dispatch.reserve")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "draft");

      const items = await ctx.db
        .select({ bundleId: dispatchItem.bundleId })
        .from(dispatchItem)
        .where(
          and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
        );

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dispatch)
          .set({ status: "draft", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("draft"))),
      ];

      if (items.length > 0) {
        const bundleIds = items.map((i) => i.bundleId);
        const reservedBundles = await mapInChunks(bundleIds, (ids) =>
          ctx.db
            .select()
            .from(bundle)
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.currentDispatchId, d.id),
              ),
            ),
        );
        const notReservedHere = reservedBundles.filter((b) => b.status !== "reserved");
        if (reservedBundles.length !== bundleIds.length || notReservedHere.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cannot unreserve: one or more bundles are no longer reserved for this dispatch",
          });
        }

        const releaseStatements: SqliteBatchItem[] = [];
        for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
          releaseStatements.push(
            ctx.db
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, ids),
                  eq(bundle.status, "reserved"),
                  eq(bundle.currentDispatchId, d.id),
                ),
              ),
          );
        }
        pushChunkedInserts(
          releaseStatements,
          (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
          bundleIds.map((bid) => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            bundleId: bid,
            fromStatus: "reserved" as const,
            toStatus: "available" as const,
            reason: "dispatch.unreserve",
            actorId: ctx.session.user.id,
            dispatchId: d.id,
          })),
        );
        statements.unshift(...releaseStatements);
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.unreserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  complete: actionProcedure("dispatch.complete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "completed");

      const items = await ctx.db
        .select({ bundleId: dispatchItem.bundleId })
        .from(dispatchItem)
        .where(
          and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
        );

      if (items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot complete an empty dispatch",
        });
      }

      const bundleIds = items.map((i) => i.bundleId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const completedAt = new Date();
      const bundles = await mapInChunks(bundleIds, (ids) =>
        ctx.db
          .select()
          .from(bundle)
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              inArray(bundle.id, ids),
              eq(bundle.currentDispatchId, d.id),
            ),
          ),
      );
      const notReservedHere = bundles.filter((b) => b.status !== "reserved");
      if (bundles.length !== bundleIds.length || notReservedHere.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot complete: one or more bundles are no longer reserved for this dispatch",
        });
      }

      const { statements: packingListStatements } = await appendPackingListWrites(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow: {
          id: d.id,
          code: d.code,
          customerId: d.customerId,
          shipDate: d.shipDate ?? null,
          notes: d.notes ?? null,
          status: "completed",
          completedAt,
        },
        session: ctx.session,
        impersonation: ctx.impersonation,
      });

      const statements: SqliteBatchItem[] = [];
      for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
        statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "dispatched", serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.status, "reserved"),
                eq(bundle.currentDispatchId, d.id),
              ),
            ),
        );
      }
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
        bundleIds.map((bid) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: bid,
          fromStatus: "reserved" as const,
          toStatus: "dispatched" as const,
          reason: "dispatch.complete",
          actorId: ctx.session.user.id,
          dispatchId: d.id,
        })),
      );
      statements.push(
        ctx.db
          .update(dispatch)
          .set({
            status: "completed",
            completedBy: ctx.session.user.id,
            completedAt,
            serverSeq: seq,
          })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("completed"))),
        ...packingListStatements,
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.complete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        ),
      );
      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  cancel: actionProcedure("dispatch.cancel")
    .input(z.object({ id: z.string(), reason: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "cancelled");

      const wasReserved = d.status === "reserved";
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      let releasedCount = 0;
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dispatch)
          .set({ status: "cancelled", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("cancelled"))),
      ];

      if (wasReserved) {
        const items = await ctx.db
          .select({ bundleId: dispatchItem.bundleId })
          .from(dispatchItem)
          .where(
            and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
          );
        if (items.length > 0) {
          const bundleIds = items.map((i) => i.bundleId);
          const reservedBundles = await mapInChunks(bundleIds, (ids) =>
            ctx.db
              .select()
              .from(bundle)
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, ids),
                  eq(bundle.currentDispatchId, d.id),
                ),
              ),
          );
          const notReservedHere = reservedBundles.filter((b) => b.status !== "reserved");
          if (reservedBundles.length !== bundleIds.length || notReservedHere.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot cancel: one or more bundles are no longer reserved for this dispatch",
            });
          }

          const releaseStatements: SqliteBatchItem[] = [];
          for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
            releaseStatements.push(
              ctx.db
                .update(bundle)
                .set({ status: "available", currentDispatchId: null, serverSeq: seq })
                .where(
                  and(
                    eq(bundle.companyId, ctx.companyId),
                    inArray(bundle.id, ids),
                    eq(bundle.status, "reserved"),
                    eq(bundle.currentDispatchId, d.id),
                  ),
                ),
            );
          }
          pushChunkedInserts(
            releaseStatements,
            (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
            bundleIds.map((bid) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: bid,
              fromStatus: "reserved" as const,
              toStatus: "available" as const,
              reason: input.reason ?? "dispatch.cancel",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            })),
          );
          statements.unshift(...releaseStatements);
          releasedCount = items.length;
        }
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.cancel",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status, releasedCount, reason: input.reason ?? null },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  softDelete: actionProcedure("dispatch.delete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      if (d.status === "reserved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Release the held stock first" });
      }
      if (d.status !== "draft" && d.status !== "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft or cancelled dispatches can be deleted",
        });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatch)
          .set({ deletedAt: new Date(), serverSeq: seq })
          // A concurrent reserve must not leave held stock on a deleted dispatch.
          .where(dispatchInStatus(ctx.companyId, d.id, ["draft", "cancelled"])),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.delete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status },
          },
        ),
      ]);
      return { success: true };
    }),
});
