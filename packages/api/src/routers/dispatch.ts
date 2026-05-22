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

import { companyProcedure, router } from "../index";
import { writeAudit } from "../lib/audit";
import { formatDispatchCode } from "../lib/dispatchCode";
import { nextCompanySeq } from "../lib/sequence";

const ALLOWED_DISPATCH_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  draft: ["reserved", "cancelled"],
  reserved: ["draft", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function assertDispatchTransition(from: DispatchStatus, to: DispatchStatus) {
  const allowed = ALLOWED_DISPATCH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Dispatch transition ${from} -> ${to} is not allowed.`,
    });
  }
}

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
  create: companyProcedure
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

      const created = await ctx.db.transaction(async (tx) => {
        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        const code = formatDispatchCode(seq);

        await tx.insert(dispatch).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          code,
          customerId: input.customerId,
          status: "draft",
          shipDate: input.shipDate ? new Date(input.shipDate) : null,
          notes: input.notes ?? null,
          createdBy: userId,
        });

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.create",
            subjectType: "dispatch",
            subjectId: id,
            meta: { code, customerId: input.customerId },
          },
        );

        return { id, code };
      });

      return { success: true, ...created };
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

  update: companyProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const existing = await tx.query.dispatch.findFirst({
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
          const newCustomer = await tx.query.customer.findFirst({
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

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .update(dispatch)
          .set({
            customerId: input.customerId ?? existing.customerId,
            shipDate:
              input.shipDate === undefined
                ? existing.shipDate
                : input.shipDate === null
                  ? null
                  : new Date(input.shipDate),
            notes: input.notes ?? existing.notes,
            serverSeq: seq,
          })
          .where(eq(dispatch.id, existing.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.update",
            subjectType: "dispatch",
            subjectId: existing.id,
            meta: {
              customerId: input.customerId ?? existing.customerId,
              shipDate: input.shipDate ?? null,
            },
          },
        );
      });
      return { success: true };
    }),

  addBundle: companyProcedure
    .input(z.object({ id: z.string(), bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
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

        const b = await tx.query.bundle.findFirst({
          where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
        });
        if (!b) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
        }
        if (b.status !== "available") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Bundle ${b.serial} is not available (currently ${b.status})`,
          });
        }

        const existingItem = await tx.query.dispatchItem.findFirst({
          where: and(
            eq(dispatchItem.companyId, ctx.companyId),
            eq(dispatchItem.dispatchId, d.id),
            eq(dispatchItem.bundleId, b.id),
          ),
        });
        if (existingItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bundle is already in this dispatch",
          });
        }

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx.insert(dispatchItem).values({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          dispatchId: d.id,
          bundleId: b.id,
        });

        if (d.status === "reserved") {
          await tx
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(eq(bundle.id, b.id));

          await tx.insert(bundleStatusEvent).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            bundleId: b.id,
            fromStatus: "available",
            toStatus: "reserved",
            reason: "dispatch.addBundle",
            actorId: ctx.session.user.id,
            dispatchId: d.id,
          });
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.addBundle",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: b.id, serial: b.serial, dispatchStatus: d.status },
          },
        );
      });
      return { success: true };
    }),

  addBundlesBySerial: companyProcedure
    .input(z.object({ id: z.string(), serials: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const trimmed = Array.from(new Set(input.serials.map((s) => s.trim()).filter(Boolean)));
      if (trimmed.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No serials provided" });
      }

      const result = await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
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

        const bundles = await tx
          .select()
          .from(bundle)
          .where(
            and(eq(bundle.companyId, ctx.companyId), inArray(bundle.serial, trimmed)),
          );

        const found = new Map(bundles.map((b) => [b.serial, b]));
        const missing = trimmed.filter((s) => !found.has(s));
        const unavailable = bundles.filter((b) => b.status !== "available");

        if (missing.length > 0 || unavailable.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              missing.length > 0
                ? `Unknown serials: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`
                : `Bundles not available: ${unavailable
                    .slice(0, 5)
                    .map((b) => `${b.serial} (${b.status})`)
                    .join(", ")}${unavailable.length > 5 ? "…" : ""}`,
          });
        }

        // Reject duplicates already in this dispatch
        const existingItemRows = await tx
          .select({ bundleId: dispatchItem.bundleId })
          .from(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              inArray(
                dispatchItem.bundleId,
                bundles.map((b) => b.id),
              ),
            ),
          );
        const alreadyAdded = new Set(existingItemRows.map((r) => r.bundleId));
        const toAdd = bundles.filter((b) => !alreadyAdded.has(b.id));
        if (toAdd.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "All provided serials are already in this dispatch",
          });
        }

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx.insert(dispatchItem).values(
          toAdd.map((b) => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            dispatchId: d.id,
            bundleId: b.id,
          })),
        );

        if (d.status === "reserved") {
          await tx
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(
                  bundle.id,
                  toAdd.map((b) => b.id),
                ),
              ),
            );
          await tx.insert(bundleStatusEvent).values(
            toAdd.map((b) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "available" as const,
              toStatus: "reserved" as const,
              reason: "dispatch.addBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            })),
          );
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
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
        );

        return { added: toAdd.length };
      });

      return { success: true, ...result };
    }),

  removeBundle: companyProcedure
    .input(z.object({ id: z.string(), bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
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

        const existingItem = await tx.query.dispatchItem.findFirst({
          where: and(
            eq(dispatchItem.companyId, ctx.companyId),
            eq(dispatchItem.dispatchId, d.id),
            eq(dispatchItem.bundleId, input.bundleId),
          ),
        });
        if (!existingItem) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not in this dispatch" });
        }

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .delete(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              eq(dispatchItem.bundleId, input.bundleId),
            ),
          );

        if (d.status === "reserved") {
          const b = await tx.query.bundle.findFirst({
            where: and(
              eq(bundle.id, input.bundleId),
              eq(bundle.companyId, ctx.companyId),
            ),
          });
          if (b && b.status === "reserved") {
            await tx
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(eq(bundle.id, b.id));

            await tx.insert(bundleStatusEvent).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "reserved",
              toStatus: "available",
              reason: "dispatch.removeBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            });
          }
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.removeBundle",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: input.bundleId, dispatchStatus: d.status },
          },
        );
      });
      return { success: true };
    }),

  reserve: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        assertDispatchTransition(d.status, "reserved");

        const items = await tx
          .select({ bundleId: dispatchItem.bundleId })
          .from(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
            ),
          );

        if (items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot reserve an empty dispatch",
          });
        }

        const bundleIds = items.map((i) => i.bundleId);
        const bundles = await tx
          .select()
          .from(bundle)
          .where(
            and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, bundleIds)),
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

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .update(bundle)
          .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
          .where(
            and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, bundleIds)),
          );

        await tx.insert(bundleStatusEvent).values(
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

        await tx
          .update(dispatch)
          .set({ status: "reserved", serverSeq: seq })
          .where(eq(dispatch.id, d.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.reserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        );
      });
      return { success: true };
    }),

  unreserve: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        assertDispatchTransition(d.status, "draft");

        const items = await tx
          .select({ bundleId: dispatchItem.bundleId })
          .from(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
            ),
          );

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        if (items.length > 0) {
          const bundleIds = items.map((i) => i.bundleId);
          const reservedBundles = await tx
            .select()
            .from(bundle)
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, bundleIds),
                eq(bundle.currentDispatchId, d.id),
              ),
            );
          const notReservedHere = reservedBundles.filter((b) => b.status !== "reserved");
          if (reservedBundles.length !== bundleIds.length || notReservedHere.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot unreserve: one or more bundles are no longer reserved for this dispatch",
            });
          }

          await tx
            .update(bundle)
            .set({ status: "available", currentDispatchId: null, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, bundleIds),
                eq(bundle.status, "reserved"),
                eq(bundle.currentDispatchId, d.id),
              ),
            );

          await tx.insert(bundleStatusEvent).values(
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
        }

        await tx
          .update(dispatch)
          .set({ status: "draft", serverSeq: seq })
          .where(eq(dispatch.id, d.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.unreserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        );
      });
      return { success: true };
    }),

  complete: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        assertDispatchTransition(d.status, "completed");

        const items = await tx
          .select({ bundleId: dispatchItem.bundleId })
          .from(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
            ),
          );

        if (items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot complete an empty dispatch",
          });
        }

        const bundleIds = items.map((i) => i.bundleId);
        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        const bundles = await tx
          .select()
          .from(bundle)
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              inArray(bundle.id, bundleIds),
              eq(bundle.currentDispatchId, d.id),
            ),
          );
        const notReservedHere = bundles.filter((b) => b.status !== "reserved");
        if (bundles.length !== bundleIds.length || notReservedHere.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cannot complete: one or more bundles are no longer reserved for this dispatch",
          });
        }

        await tx
          .update(bundle)
          .set({ status: "dispatched", serverSeq: seq })
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              inArray(bundle.id, bundleIds),
              eq(bundle.status, "reserved"),
              eq(bundle.currentDispatchId, d.id),
            ),
          );

        await tx.insert(bundleStatusEvent).values(
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

        await tx
          .update(dispatch)
          .set({
            status: "completed",
            completedBy: ctx.session.user.id,
            completedAt: new Date(),
            serverSeq: seq,
          })
          .where(eq(dispatch.id, d.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.complete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        );
      });
      return { success: true };
    }),

  cancel: companyProcedure
    .input(z.object({ id: z.string(), reason: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        assertDispatchTransition(d.status, "cancelled");

        const wasReserved = d.status === "reserved";
        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        let releasedCount = 0;
        if (wasReserved) {
          const items = await tx
            .select({ bundleId: dispatchItem.bundleId })
            .from(dispatchItem)
            .where(
              and(
                eq(dispatchItem.companyId, ctx.companyId),
                eq(dispatchItem.dispatchId, d.id),
              ),
            );
          if (items.length > 0) {
            const bundleIds = items.map((i) => i.bundleId);
            const reservedBundles = await tx
              .select()
              .from(bundle)
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, bundleIds),
                  eq(bundle.currentDispatchId, d.id),
                ),
              );
            const notReservedHere = reservedBundles.filter((b) => b.status !== "reserved");
            if (reservedBundles.length !== bundleIds.length || notReservedHere.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot cancel: one or more bundles are no longer reserved for this dispatch",
              });
            }

            await tx
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, bundleIds),
                  eq(bundle.status, "reserved"),
                  eq(bundle.currentDispatchId, d.id),
                ),
              );
            await tx.insert(bundleStatusEvent).values(
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
            releasedCount = items.length;
          }
        }

        await tx
          .update(dispatch)
          .set({ status: "cancelled", serverSeq: seq })
          .where(eq(dispatch.id, d.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.cancel",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status, releasedCount, reason: input.reason ?? null },
          },
        );
      });
      return { success: true };
    }),

  softDelete: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const d = await tx.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        if (d.status !== "draft" && d.status !== "cancelled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only draft or cancelled dispatches can be deleted",
          });
        }

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        await tx
          .update(dispatch)
          .set({ deletedAt: new Date(), serverSeq: seq })
          .where(eq(dispatch.id, d.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.delete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status },
          },
        );
      });
      return { success: true };
    }),
});
