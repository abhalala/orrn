import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { BUNDLE_NUMBER_POLICIES } from "@orrn/domain";
import { customer, customerAlias } from "@orrn/db/schema/customers";
import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { sourceMeta } from "../lib/ingest/merge/provenance";
import { liveCustomersByKey } from "../lib/ingest/merge/rowchecks";
import { nameKey } from "../lib/purchase";
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

const customerImportRows = z
  .array(customerBaseSchema)
  .max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches");

/** Most aliases one `addAliases` call adds (plan A5: the merge sends 500 rows per call). */
const MAX_ALIAS_ROWS = 500;

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
            // The import finds customers by this key (Infinity Portal, B-new-2).
            nameKey: nameKey(input.name),
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
            ...sourceMeta(ctx),
          },
        },
        ({ serverSeq }) => [
          ctx.db
            .update(customer)
            .set({
              // undefined leaves the policy as it is; null returns to the company serial.
              bundleNumberPolicy: input.bundleNumberPolicy,
              name: input.name,
              ...(input.name !== undefined ? { nameKey: nameKey(input.name) } : {}),
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
        if (state === "replayed") return { success: true, count: input.length, replayed: true, ids: rowIds };
        if (state === "conflict") throw new TRPCError(REQUEST_ID_CONFLICT);
      }

      // The new customers' ids in input order (the merge records what it wrote, plan A5).
      const ids = rowIds ?? input.map(() => crypto.randomUUID());
      const racedReplay = await withAudit(
        ctx,
        {
          action: "customer.import",
          subjectType: "customer",
          meta: { count: input.length, ...sourceMeta(ctx) },
        },
        ({ serverSeq }) => {
          const values = input.map((row, i) => ({
            id: ids[i]!,
            companyId: ctx.companyId,
            serverSeq,
            name: row.name,
            nameKey: nameKey(row.name),
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
      ).then(
        () => false,
        // An identical request landed a moment earlier: its ids are taken, so this batch rolled back.
        async (error: unknown) => {
          if (rowIds && (await landed(rowIds)) === "replayed") return true;
          throw error;
        },
      );
      if (racedReplay) return { success: true, count: input.length, replayed: true, ids };

      return { success: true, count: input.length, replayed: false, ids };
    }),

  /**
   * Other names a customer is known by (plan B4, `customer_aliases`). One alias key (`nameKey`) belongs
   * to one customer of the plant, and never equals another live customer's own name. An alias the
   * customer already has is left as it is. Same id, same rows: a resend answers `replayed`.
   */
  addAliases: actionProcedure("customer.update")
    .input(
      z.object({
        rows: z
          .array(z.object({ customerId: z.string().min(1).max(64), alias: z.string().trim().min(1).max(200) }))
          .min(1, "No rows provided")
          .max(MAX_ALIAS_ROWS, `At most ${MAX_ALIAS_ROWS} names per call`),
        clientRequestId: clientRequestIdSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = input.rows.map((r) => ({ ...r, key: nameKey(r.alias) }));
      const blankKey = rows.find((r) => !r.key);
      if (blankKey) throw new TRPCError({ code: "BAD_REQUEST", message: `${blankKey.alias} needs letters or digits` });
      // Request-derived ids: two identical calls racing end on the primary key, and the loser finds
      // every alias already there (the plan below then adds nothing and answers `replayed`).
      const rowIds = input.clientRequestId
        ? await requestRowIds(ctx.companyId, "customer.alias", input.clientRequestId, rows.length)
        : rows.map(() => crypto.randomUUID());

      // Only the rows' customers and keys are read, 90 a statement, never the whole plant (B-new-2).
      const keys = [...new Set(rows.map((r) => r.key))];
      const plan = async () => {
        const named = await liveCustomersByKey(ctx, keys);
        const nameOwner = new Map<string, string>();
        for (const c of named) if (!nameOwner.has(c.key)) nameOwner.set(c.key, c.id);
        const existing = await mapInChunks(keys, (part) =>
          ctx.db
            .select({ id: customerAlias.id, key: customerAlias.aliasKey, customerId: customerAlias.customerId })
            .from(customerAlias)
            .where(and(eq(customerAlias.companyId, ctx.companyId), inArray(customerAlias.aliasKey, part))),
        );
        const aliasOwner = new Map(existing.map((a) => [a.key, a]));
        const nameOf = new Map(named.map((c) => [c.id, c.name]));
        const others = [...new Set([...rows.map((r) => r.customerId), ...existing.map((a) => a.customerId)])].filter((id) => !nameOf.has(id));
        const live = await mapInChunks(others, (part) =>
          ctx.db
            .select({ id: customer.id, name: customer.name })
            .from(customer)
            .where(and(eq(customer.companyId, ctx.companyId), inArray(customer.id, part), isNull(customer.deletedAt))),
        );
        for (const c of live) nameOf.set(c.id, c.name);
        const ids: string[] = [];
        const inserts: (typeof customerAlias.$inferInsert)[] = [];
        const fresh = new Map<string, { id: string; customerId: string }>();
        for (const [i, r] of rows.entries()) {
          if (!nameOf.has(r.customerId)) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
          const own = nameOwner.get(r.key);
          if (own && own !== r.customerId) {
            throw new TRPCError({ code: "CONFLICT", message: `${r.alias} is already the name of ${nameOf.get(own)}` });
          }
          const had = aliasOwner.get(r.key) ?? fresh.get(r.key);
          if (had) {
            if (had.customerId !== r.customerId) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `${r.alias} already belongs to ${nameOf.get(had.customerId) ?? "another customer"}`,
              });
            }
            ids.push(had.id);
            continue;
          }
          // An alias equal to the customer's own name adds nothing; the row points at the customer.
          if (own) {
            ids.push(r.customerId);
            continue;
          }
          const id = rowIds[i]!;
          fresh.set(r.key, { id, customerId: r.customerId });
          ids.push(id);
          inserts.push({ id, companyId: ctx.companyId, customerId: r.customerId, alias: r.alias, aliasKey: r.key, createdBy: ctx.session.user.id });
        }
        return { ids, inserts };
      };

      const first = await plan();
      if (first.inserts.length === 0) return { success: true, count: rows.length, added: 0, replayed: true, ids: first.ids };
      const statements: SqliteBatchItem[] = [];
      pushChunkedInserts(statements, (part) => ctx.db.insert(customerAlias).values(part), first.inserts);
      statements.push(
        auditInsert(ctx, {
          action: "customer.aliases.add",
          subjectType: "customer",
          meta: { count: first.inserts.length, ...sourceMeta(ctx) },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (error) {
        // A name added meanwhile: plan again; the same rows already there answer `replayed`.
        const again = await plan();
        if (again.inserts.length === 0) return { success: true, count: rows.length, added: 0, replayed: true, ids: again.ids };
        throw error;
      }
      return { success: true, count: rows.length, added: first.inserts.length, replayed: false, ids: first.ids };
    }),
});
