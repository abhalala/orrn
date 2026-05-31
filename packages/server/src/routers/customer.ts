import { and, desc, eq, isNull, like } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { customer } from "@orrn/db/schema/customers";
import { companyProcedure, router } from "../index";
import { pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { paginatedList, scopedFindOrThrow, withAudit } from "../lib/helpers";

const customerBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  billingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  shippingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  taxId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

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

      if (input.search) {
        conditions.push(like(customer.name, `%${input.search}%`));
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

  create: companyProcedure
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
          }),
        ],
      );

      return { success: true, id };
    }),

  update: companyProcedure
    .input(customerBaseSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await scopedFindOrThrow<Customer>(
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
          meta: { name: input.name },
        },
        ({ serverSeq }) => [
          ctx.db
            .update(customer)
            .set({
              name: input.name,
              phone: input.phone,
              email: input.email || null,
              billingAddress: input.billingAddress,
              shippingAddress: input.shippingAddress,
              taxId: input.taxId,
              notes: input.notes,
              serverSeq,
            })
            .where(and(eq(customer.id, input.id), eq(customer.companyId, ctx.companyId))),
        ],
      );

      return { success: true };
    }),

  delete: companyProcedure
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

  importCsv: companyProcedure
    .input(z.array(customerBaseSchema))
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
          }));

          const statements: SqliteBatchItem[] = [];
          pushChunkedInserts(
            statements,
            (chunk) => ctx.db.insert(customer).values(chunk),
            values,
            100,
          );
          return statements;
        },
      );

      return { success: true, count: input.length };
    }),
});
