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
import { company } from "@orrn/db/schema/tenant";

import { companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { chunk } from "../lib/d1-in";
import { defaultGroupLabel, packingGroupKeyFromSettings } from "../lib/packing-group";
import { formatDispatchCode } from "../lib/dispatchCode";
import { nextCompanySeq } from "../lib/sequence";
import { appendPackingListWrites } from "./packingList";

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
          dieName: die.name,
          poNumber: bundle.poNumber,
          createdAt: bundle.createdAt,
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
            notes: input.notes ?? existing.notes,
            serverSeq: seq,
          })
          .where(eq(dispatch.id, existing.id)),
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

  addBundle: companyProcedure
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
          message: "Bundles can only be added in draft or reserved status",
        });
      }

      const b = await ctx.db.query.bundle.findFirst({
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

      const existingItem = await ctx.db.query.dispatchItem.findFirst({
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

      const [companyRow, dieRow] = await Promise.all([
        ctx.db.query.company.findFirst({ where: eq(company.id, ctx.companyId) }),
        ctx.db.query.die.findFirst({ where: and(eq(die.id, b.dieId), eq(die.companyId, ctx.companyId)) }),
      ]);
      if (!dieRow) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      const groupLabel = defaultGroupLabel(dieRow, b, packingGroupKeyFromSettings(companyRow?.settings));

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(dispatchItem).values({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          dispatchId: d.id,
          bundleId: b.id,
          ...(groupLabel ? { groupLabel } : {}),
        }),
      ];

      if (d.status === "reserved") {
        statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(eq(bundle.id, b.id)),
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
            meta: { bundleId: b.id, serial: b.serial, dispatchStatus: d.status, ...(groupLabel ? { groupLabel } : {}) },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  addBundlesBySerial: companyProcedure
    .input(z.object({ id: z.string(), serials: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const trimmed = Array.from(new Set(input.serials.map((s) => s.trim()).filter(Boolean)));
      if (trimmed.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No scan tokens provided" });
      }

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

      const bundles = [] as Array<typeof bundle.$inferSelect>;
      for (const tokens of chunk(trimmed)) {
        bundles.push(...await ctx.db.select().from(bundle).where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, tokens))));
      }
      const foundIds = new Set(bundles.map((row) => row.id));
      const remaining = trimmed.filter((token) => !foundIds.has(token));
      for (const tokens of chunk(remaining)) {
        bundles.push(...await ctx.db.select().from(bundle).where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.serial, tokens))));
      }

      const byId = new Map(bundles.map((b) => [b.id, b]));
      const bySerial = new Map(bundles.map((b) => [b.serial, b]));
      const resolved = trimmed.map((token) => ({
        token,
        bundle: byId.get(token) ?? bySerial.get(token),
      }));
      const missing = resolved.filter((item) => !item.bundle).map((item) => item.token);
      const unavailable = resolved.filter(
        (item): item is typeof item & { bundle: NonNullable<typeof item.bundle> } =>
          item.bundle !== undefined && item.bundle.status !== "available",
      );

      if (missing.length > 0 || unavailable.length > 0) {
        const errors = [];
        if (missing.length > 0) {
          errors.push(
            `Unknown scan tokens: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
          );
        }
        if (unavailable.length > 0) {
          errors.push(
            `Unavailable scan tokens: ${unavailable
              .slice(0, 5)
              .map(({ token, bundle: b }) => `${token} (${b.status})`)
              .join(", ")}${unavailable.length > 5 ? "…" : ""}`,
          );
        }
        throw new TRPCError({
          code: missing.length > 0 ? "BAD_REQUEST" : "CONFLICT",
          message: errors.join("; "),
        });
      }

      const resolvedBundles = resolved.flatMap((item) => (item.bundle ? [item.bundle] : []));
      const uniqueBundles = Array.from(new Map(resolvedBundles.map((b) => [b.id, b])).values());

      const existingItemRows: Array<{ bundleId: string }> = [];
      for (const ids of chunk(uniqueBundles.map((b) => b.id))) {
        existingItemRows.push(...await ctx.db.select({ bundleId: dispatchItem.bundleId }).from(dispatchItem).where(and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id), inArray(dispatchItem.bundleId, ids))));
      }
      const alreadyAdded = new Set(existingItemRows.map((r) => r.bundleId));
      const toAdd = uniqueBundles.filter((b) => !alreadyAdded.has(b.id));
      if (toAdd.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "All scanned bundles are already in this dispatch",
        });
      }

      const companyRow = await ctx.db.query.company.findFirst({ where: eq(company.id, ctx.companyId) });
      const packingGroupKey = packingGroupKeyFromSettings(companyRow?.settings);
      const dieRows: Array<typeof die.$inferSelect> = [];
      for (const ids of chunk(Array.from(new Set(toAdd.map((b) => b.dieId))))) {
        dieRows.push(...await ctx.db.select().from(die).where(and(eq(die.companyId, ctx.companyId), inArray(die.id, ids))));
      }
      const diesById = new Map(dieRows.map((row) => [row.id, row]));
      const groupLabels = new Map(toAdd.map((b) => {
        const dieRow = diesById.get(b.dieId);
        return [b.id, dieRow ? defaultGroupLabel(dieRow, b, packingGroupKey) : null];
      }));

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [];
      pushChunkedInserts(statements, (values) => ctx.db.insert(dispatchItem).values(values),
          toAdd.map((b) => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            dispatchId: d.id,
            bundleId: b.id,
            ...(groupLabels.get(b.id) ? { groupLabel: groupLabels.get(b.id)! } : {}),
          })), 50);

      if (d.status === "reserved") {
        for (const ids of chunk(toAdd.map((b) => b.id))) statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
              ),
            ),
        );
        pushChunkedInserts(statements, (values) => ctx.db.insert(bundleStatusEvent).values(values),
            toAdd.map((b) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "available" as const,
              toStatus: "reserved" as const,
              reason: "dispatch.addBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            })), 50);
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
              groupLabels: Object.fromEntries(Array.from(groupLabels).filter((entry): entry is [string, string] => entry[1] !== null)),
            },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);

      return { success: true, added: toAdd.length };
    }),

  setItemGroupLabel: companyProcedure
    .input(z.object({ id: z.string(), bundleId: z.string(), groupLabel: z.string().max(80, "Packing group must be 80 characters or fewer").nullable() }))
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

      const label = input.groupLabel?.trim() || null;
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
        ctx.db.update(dispatch).set({ serverSeq: seq }).where(eq(dispatch.id, d.id)),
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

  removeBundle: companyProcedure
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
        if (b && b.status === "reserved") {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(eq(bundle.id, b.id)),
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

  reserve: companyProcedure
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
      const bundles = await ctx.db
        .select()
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, bundleIds)));

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

      await atomicBatch(ctx.db, [
        ctx.db
          .update(bundle)
          .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, bundleIds))),
        ctx.db.insert(bundleStatusEvent).values(
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
        ),
        ctx.db.update(dispatch).set({ status: "reserved", serverSeq: seq }).where(eq(dispatch.id, d.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.reserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        ),
      ]);
      return { success: true };
    }),

  unreserve: companyProcedure
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
        ctx.db.update(dispatch).set({ status: "draft", serverSeq: seq }).where(eq(dispatch.id, d.id)),
      ];

      if (items.length > 0) {
        const bundleIds = items.map((i) => i.bundleId);
        const reservedBundles = await ctx.db
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

        statements.unshift(
          ctx.db
            .update(bundle)
            .set({ status: "available", currentDispatchId: null, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, bundleIds),
                eq(bundle.status, "reserved"),
                eq(bundle.currentDispatchId, d.id),
              ),
            ),
          ctx.db.insert(bundleStatusEvent).values(
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
          ),
        );
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

  complete: companyProcedure
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
      const bundles = await ctx.db
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

      await atomicBatch(ctx.db, [
        ctx.db
          .update(bundle)
          .set({ status: "dispatched", serverSeq: seq })
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              inArray(bundle.id, bundleIds),
              eq(bundle.status, "reserved"),
              eq(bundle.currentDispatchId, d.id),
            ),
          ),
        ctx.db.insert(bundleStatusEvent).values(
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
        ),
        ctx.db
          .update(dispatch)
          .set({
            status: "completed",
            completedBy: ctx.session.user.id,
            completedAt,
            serverSeq: seq,
          })
          .where(eq(dispatch.id, d.id)),
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
      ]);
      return { success: true };
    }),

  cancel: companyProcedure
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
          .where(eq(dispatch.id, d.id)),
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
          const reservedBundles = await ctx.db
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

          statements.unshift(
            ctx.db
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, bundleIds),
                  eq(bundle.status, "reserved"),
                  eq(bundle.currentDispatchId, d.id),
                ),
              ),
            ctx.db.insert(bundleStatusEvent).values(
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
            ),
          );
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

  softDelete: companyProcedure
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
          .where(eq(dispatch.id, d.id)),
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
