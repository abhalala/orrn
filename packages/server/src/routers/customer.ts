import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { customer } from "@orrn/db/schema/customers";
import { actionProcedure, companyProcedure, router } from "../index";
import { pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { clientRequestIdSchema, replayProbe, replayState, REQUEST_ID_CONFLICT, requestRowIds } from "../lib/importReplay";
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
});

/** Same cap as bundle.bulkImport: a larger import must be split into batches (D1 + Worker CPU). */
const MAX_IMPORT_ROWS = 2000;

const customerImportRows = z
  .array(customerBaseSchema)
  .max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches");

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
          }),
        ],
      );

      return { success: true, id };
    }),

  update: actionProcedure("customer.update")
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
    .input(
      z.union([
        customerImportRows,
        // Same id, same rows: a resend answers `replayed` instead of adding the customers twice (lib/importReplay).
        z.object({ rows: customerImportRows, clientRequestId: clientRequestIdSchema.optional() }),
      ]),
    )
    .mutation(async ({ ctx, input: raw }) => {
      const { rows: input, clientRequestId } = Array.isArray(raw) ? { rows: raw, clientRequestId: undefined } : raw;
      if (input.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No rows provided" });
      }

      const rowIds = clientRequestId
        ? await requestRowIds(ctx.companyId, "customer.import", clientRequestId, input.length)
        : null;
      const landed = async (ids: string[]) =>
        replayState(
          ids,
          (
            await ctx.db
              .select({ id: customer.id })
              .from(customer)
              .where(and(eq(customer.companyId, ctx.companyId), inArray(customer.id, replayProbe(ids))))
          ).map((r) => r.id),
        );
      if (rowIds) {
        const state = await landed(rowIds);
        if (state === "replayed") return { success: true, count: input.length, replayed: true };
        if (state === "conflict") throw new TRPCError(REQUEST_ID_CONFLICT);
      }

      const racedReplay = await withAudit(
        ctx,
        {
          action: "customer.import",
          subjectType: "customer",
          meta: { count: input.length },
        },
        ({ serverSeq }) => {
          const values = input.map((row, i) => ({
            id: rowIds?.[i] ?? crypto.randomUUID(),
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
          pushChunkedInserts(statements, (rows) => ctx.db.insert(customer).values(rows), values);
          return statements;
        },
      ).then(
        () => false,
        // An identical request landed a moment earlier: its ids are taken, so this batch rolled back.
        async (error: unknown) => {
          if (rowIds && (await landed(rowIds)) === "replayed") return true;
          throw error;
        },
      );
      if (racedReplay) return { success: true, count: input.length, replayed: true };

      return { success: true, count: input.length, replayed: false };
    }),
});
