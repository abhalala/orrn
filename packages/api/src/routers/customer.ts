import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { customer } from "@orrn/db/schema/customers";
import { companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { nextCompanySeq } from "../lib/sequence";

const customerBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  billingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  shippingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  taxId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const customerRouter = router({
  list: companyProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.number().optional(), // Using offset/cursor pagination. For simplicity, let's use offset.
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      let conditions = [
        eq(customer.companyId, ctx.companyId),
        isNull(customer.deletedAt)
      ];

      if (input.search) {
        conditions.push(like(customer.name, `%${input.search}%`));
      }

      const items = await ctx.db.query.customer.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(customer.createdAt)],
      });

      const result = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(customer)
        .where(and(...conditions));

      return {
        items,
        total: result[0]?.count ?? 0,
      };
    }),

  get: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.query.customer.findFirst({
        where: and(
          eq(customer.id, input.id),
          eq(customer.companyId, ctx.companyId),
          isNull(customer.deletedAt)
        ),
      });

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      return item;
    }),

  create: companyProcedure
    .input(customerBaseSchema)
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
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
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "customer.create",
            subjectType: "customer",
            subjectId: id,
            meta: { name: input.name },
          },
        ),
      ]);

      return { success: true, id };
    }),

  update: companyProcedure
    .input(customerBaseSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.customer.findFirst({
        where: and(
          eq(customer.id, input.id),
          eq(customer.companyId, ctx.companyId),
          isNull(customer.deletedAt),
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
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
          .where(eq(customer.id, input.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "customer.update",
            subjectType: "customer",
            subjectId: input.id,
            meta: { name: input.name },
          },
        ),
      ]);

      return { success: true };
    }),

  delete: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.customer.findFirst({
        where: and(
          eq(customer.id, input.id),
          eq(customer.companyId, ctx.companyId),
          isNull(customer.deletedAt),
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(customer)
          .set({
            deletedAt: new Date(),
            serverSeq,
          })
          .where(eq(customer.id, input.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "customer.delete",
            subjectType: "customer",
            subjectId: input.id,
            meta: { name: existing.name },
          },
        ),
      ]);

      return { success: true };
    }),

  importCsv: companyProcedure
    .input(z.array(customerBaseSchema))
    .mutation(async ({ ctx, input }) => {
      if (input.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No rows provided" });
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

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
      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "customer.import",
            subjectType: "customer",
            meta: { count: values.length },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);

      return { success: true, count: input.length };
    }),
});
