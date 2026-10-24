import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { BUNDLE_NUMBER_POLICIES } from "@orrn/domain";
import { customer } from "@orrn/db/schema/customers";
import { actionProcedure, companyProcedure, router } from "../index";
import { pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { paginatedList, scopedFindOrThrow, withAudit } from "../lib/helpers";
import { digitsOnly, likeContains, phoneDigits } from "../lib/search";

const customerBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(500),
  phone: z.string().max(500).nullable().optional(),
  email: z.string().max(500).email().nullable().optional().or(z.literal("")),
  billingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  shippingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  taxId: z.string().max(500).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Order kg tolerance in basis points (500 = 5 %); null = company default (PL-8, Review Focus 5). */
  kgToleranceBp: z.number().int().min(0).max(10_000).nullable().optional(),
});

/**
 * FP-PK-07 (C25): the customer's own bundle numbers. null = the company serial; monthly (26J12),
 * fy (2026-27/12) or lifelong (4086). A change applies to bundles packed from then on; bundles
 * already packed keep their party number (never renumbered).
 */
const bundleNumberPolicySchema = z.enum(BUNDLE_NUMBER_POLICIES).nullable().optional();

/** Same cap as bundle.bulkImport: a larger import must be split into batches (D1 + Worker CPU). */
const MAX_IMPORT_ROWS = 2000;

type Customer = typeof customer.$inferSelect;

export const customerRouter = router({
  list: companyProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.number().optional(),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(customer.companyId, ctx.companyId),
        isNull(customer.deletedAt),
      ];

      const search = input.search?.trim();
      if (search) {
        // Name, phone or GSTIN (what the list and the add-customer guide promise). LIKE is
        // case-insensitive for ASCII, so a GSTIN typed in lower case still matches; % and _ in
        // the term are matched literally. A term that looks like a phone number is also compared
        // digits to digits, so "9825011234" finds "+91 98250 11234".
        const digits = phoneDigits(search);
        const matches = [likeContains(customer.name, search), likeContains(customer.phone, search), likeContains(customer.taxId, search)];
        if (digits) matches.push(sql`${digitsOnly(customer.phone)} LIKE ${`%${digits}%`}`);
        conditions.push(sql`(${sql.join(matches, sql` OR `)})`);
      }

      const result = await paginatedList<Customer>(ctx.db, {
        table: customer,
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(customer.createdAt)],
      });

      return {
        items: result.items,
        total: result.total,
      };
    }),

  get: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return scopedFindOrThrow<Customer>(
        ctx.db,
        customer,
        input.id,
        ctx.companyId,
        { softDeleteField: "deletedAt", message: "Customer not found" },
      );
    }),

  create: actionProcedure("customer.create")
    .input(customerBaseSchema)
    .mutation(async ({ ctx, input }) => {
      const { id } = await withAudit(
        ctx,
        {
          action: "customer.create",
          subjectType: "customer",
          meta: { name: input.name },
        },
        ({ id, serverSeq }) => [
          ctx.db.insert(customer).values({
            id,
            companyId: ctx.companyId,
            serverSeq,
            name: input.name,
            phone: input.phone,
            email: input.email || null,
            billingAddress: input.billingAddress,
            shippingAddress: input.shippingAddress,
            taxId: input.taxId,
            notes: input.notes,
            kgToleranceBp: input.kgToleranceBp ?? null,
          }),
        ],
      );

      return { success: true, id };
    }),

  update: actionProcedure("customer.update")
    .input(customerBaseSchema.extend({ id: z.string(), bundleNumberPolicy: bundleNumberPolicySchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await scopedFindOrThrow<Customer>(
        ctx.db,
        customer,
        input.id,
        ctx.companyId,
        { softDeleteField: "deletedAt", message: "Customer not found" },
      );

      await withAudit(
        ctx,
        {
          action: "customer.update",
          subjectType: "customer",
          subjectId: input.id,
          meta: {
            name: input.name,
            ...(input.bundleNumberPolicy !== undefined && input.bundleNumberPolicy !== existing.bundleNumberPolicy
              ? { bundleNumberPolicy: { from: existing.bundleNumberPolicy ?? null, to: input.bundleNumberPolicy } }
              : {}),
          },
        },
        ({ serverSeq }) => [
          ctx.db
            .update(customer)
            .set({
              // undefined leaves the policy as it is; null returns to the company serial.
              bundleNumberPolicy: input.bundleNumberPolicy,
              name: input.name,
              phone: input.phone,
              email: input.email || null,
              billingAddress: input.billingAddress,
              shippingAddress: input.shippingAddress,
              taxId: input.taxId,
              notes: input.notes,
              // undefined leaves the tolerance as it is; null returns to the company default.
              kgToleranceBp: input.kgToleranceBp,
              serverSeq,
            })
            .where(and(eq(customer.id, input.id), eq(customer.companyId, ctx.companyId))),
        ],
      );

      return { success: true };
    }),

  delete: actionProcedure("customer.delete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await scopedFindOrThrow<Customer>(
        ctx.db,
        customer,
        input.id,
        ctx.companyId,
        { softDeleteField: "deletedAt", message: "Customer not found" },
      );

      await withAudit(
        ctx,
        {
          action: "customer.delete",
          subjectType: "customer",
          subjectId: input.id,
          meta: { name: existing.name },
        },
        ({ serverSeq }) => [
          ctx.db
            .update(customer)
            .set({
              deletedAt: new Date(),
              serverSeq,
            })
            .where(and(eq(customer.id, input.id), eq(customer.companyId, ctx.companyId))),
        ],
      );

      return { success: true };
    }),

  importCsv: actionProcedure("customer.import")
    .input(z.array(customerBaseSchema).max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"))
    .mutation(async ({ ctx, input }) => {
      if (input.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No rows provided" });
      }

      await withAudit(
        ctx,
        {
          action: "customer.import",
          subjectType: "customer",
          meta: { count: input.length },
        },
        ({ serverSeq }) => {
          const values = input.map((row) => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq,
            name: row.name,
            phone: row.phone,
            email: row.email || null,
            billingAddress: row.billingAddress,
            shippingAddress: row.shippingAddress,
            taxId: row.taxId,
            notes: row.notes,
            kgToleranceBp: row.kgToleranceBp ?? null,
          }));

          const statements: SqliteBatchItem[] = [];
          pushChunkedInserts(statements, (rows) => ctx.db.insert(customer).values(rows), values);
          return statements;
        },
      );

      return { success: true, count: input.length };
    }),
});
