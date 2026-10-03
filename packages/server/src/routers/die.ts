import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { die, dieStatuses } from "@orrn/db/schema/catalog";
import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { nextCompanySeq } from "../lib/sequence";

export const dimensionsSchema = z.object({
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  thicknessMm: z.number().optional(),
});

const optionalDieLength = z.number().int().min(0).nullable().optional();

/** Cap for dies per import call; matches bundle.bulkImport and customer.importCsv. */
const MAX_IMPORT_ROWS = 2000;

export const dieBaseSchema = z.object({
  series: z.string().min(1, "Series is required").max(500),
  sectionCode: z.string().min(1, "Section Code is required").max(500),
  name: z.string().max(500).nullable().optional(),
  obliqueMm: optionalDieLength,
  legMm: optionalDieLength,
  widthMm: optionalDieLength,
  thicknessMm: optionalDieLength,
  dimensions: dimensionsSchema.default({}),
  weightMinG: z.number().int().min(0, "Min weight must be >= 0"),
  weightMaxG: z.number().int().min(0, "Max weight must be >= 0"),
  status: z.enum(dieStatuses).default("active"),
  notes: z.string().max(500).nullable().optional(),
});

/**
 * The unique index on (company, series, section code) also covers soft-deleted dies, so reusing a
 * deleted die's code used to fail the insert with a 500 (audit S16). Say so instead.
 */
const DELETED_DIE_CONFLICT = {
  code: "CONFLICT",
  message: "A deleted die uses this code",
} as const;

export const dieRouter = router({
  list: companyProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      let conditions = [
        eq(die.companyId, ctx.companyId),
        isNull(die.deletedAt)
      ];

      if (input.search) {
        conditions.push(
          sql`(${die.name} LIKE ${`%${input.search}%`} OR ${die.series} LIKE ${`%${input.search}%`} OR ${die.sectionCode} LIKE ${`%${input.search}%`})`
        );
      }

      const items = await ctx.db.query.die.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(die.createdAt)],
      });

      const result = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(die)
        .where(and(...conditions));

      return {
        items,
        total: result[0]?.count ?? 0,
      };
    }),

  get: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.id, input.id),
          eq(die.companyId, ctx.companyId),
          isNull(die.deletedAt)
        ),
      });

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      return item;
    }),

  create: actionProcedure("die.create")
    .input(dieBaseSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      // Check duplicate (including soft-deleted dies: they still hold the unique code)
      const existing = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.companyId, ctx.companyId),
          eq(die.series, input.series),
          eq(die.sectionCode, input.sectionCode),
        )
      });

      if (existing?.deletedAt) {
        throw new TRPCError(DELETED_DIE_CONFLICT);
      }
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A die with this series and section code already exists" });
      }

      const id = crypto.randomUUID();
      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db.insert(die).values({
          id,
          companyId: ctx.companyId,
          serverSeq,
          series: input.series,
          sectionCode: input.sectionCode,
          name: input.name,
          obliqueMm: input.obliqueMm ?? null,
          legMm: input.legMm ?? null,
          widthMm: input.widthMm ?? null,
          thicknessMm: input.thicknessMm ?? null,
          dimensions: {
            ...input.dimensions,
            widthMm: input.widthMm ?? input.dimensions.widthMm,
            thicknessMm: input.thicknessMm ?? input.dimensions.thicknessMm,
          },
          weightMinG: input.weightMinG,
          weightMaxG: input.weightMaxG,
          status: input.status,
          notes: input.notes,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.create",
            subjectType: "die",
            subjectId: id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          },
        ),
      ]);

      return { success: true, id };
    }),

  update: actionProcedure("die.update")
    .input(dieBaseSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      const existing = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, input.id), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      if (existing.series !== input.series || existing.sectionCode !== input.sectionCode) {
        const duplicate = await ctx.db.query.die.findFirst({
          where: and(
            eq(die.companyId, ctx.companyId),
            eq(die.series, input.series),
            eq(die.sectionCode, input.sectionCode),
          ),
        });
        if (duplicate?.deletedAt) {
          throw new TRPCError(DELETED_DIE_CONFLICT);
        }
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another die with this series and section code already exists",
          });
        }
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(die)
          .set({
            series: input.series,
            sectionCode: input.sectionCode,
            name: input.name,
            obliqueMm: input.obliqueMm ?? null,
            legMm: input.legMm ?? null,
            widthMm: input.widthMm ?? null,
            thicknessMm: input.thicknessMm ?? null,
            dimensions: {
              ...input.dimensions,
              widthMm: input.widthMm ?? input.dimensions.widthMm,
              thicknessMm: input.thicknessMm ?? input.dimensions.thicknessMm,
            },
            weightMinG: input.weightMinG,
            weightMaxG: input.weightMaxG,
            status: input.status,
            notes: input.notes,
            serverSeq,
          })
          .where(eq(die.id, input.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.update",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          },
        ),
      ]);

      return { success: true };
    }),

  delete: actionProcedure("die.delete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, input.id), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(die)
          .set({
            deletedAt: new Date(),
            serverSeq,
          })
          .where(eq(die.id, input.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.delete",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: existing.series, sectionCode: existing.sectionCode },
          },
        ),
      ]);

      return { success: true };
    }),

  validateImport: actionProcedure("die.import")
    .input(z.array(dieBaseSchema).max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"))
    .mutation(async ({ ctx, input }) => {
      // Find duplicates
      const validRows: z.infer<typeof dieBaseSchema>[] = [];
      const duplicates: (z.infer<typeof dieBaseSchema> & { existingId: string })[] = [];

      for (const row of input) {
        const existing = await ctx.db.query.die.findFirst({
          where: and(
            eq(die.companyId, ctx.companyId),
            eq(die.series, row.series),
            eq(die.sectionCode, row.sectionCode),
            isNull(die.deletedAt)
          )
        });

        if (existing) {
          duplicates.push({ ...row, existingId: existing.id });
        } else {
          validRows.push(row);
        }
      }

      return { validRows, duplicates };
    }),

  processImport: actionProcedure("die.import")
    .input(z.object({
      newRows: z.array(dieBaseSchema).max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"),
      updatedRows: z
        .array(dieBaseSchema.extend({ existingId: z.string() }))
        .max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.newRows.length === 0 && input.updatedRows.length === 0) {
        return { success: true, count: 0 };
      }

      if (input.newRows.length > 0) {
        const codes = [...new Set(input.newRows.map((row) => row.sectionCode))];
        const deleted = await mapInChunks(codes, (slice) =>
          ctx.db
            .select({ series: die.series, sectionCode: die.sectionCode })
            .from(die)
            .where(
              and(
                eq(die.companyId, ctx.companyId),
                isNotNull(die.deletedAt),
                inArray(die.sectionCode, slice),
              ),
            ),
        );
        const taken = new Set(deleted.map((d) => `${d.series}\u0000${d.sectionCode}`));
        if (input.newRows.some((row) => taken.has(`${row.series}\u0000${row.sectionCode}`))) {
          throw new TRPCError(DELETED_DIE_CONFLICT);
        }
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [];

      if (input.newRows.length > 0) {
        const values = input.newRows.map((row) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq,
          series: row.series,
          sectionCode: row.sectionCode,
          name: row.name,
          obliqueMm: row.obliqueMm ?? null,
          legMm: row.legMm ?? null,
          widthMm: row.widthMm ?? null,
          thicknessMm: row.thicknessMm ?? null,
          dimensions: {
            ...row.dimensions,
            widthMm: row.widthMm ?? row.dimensions.widthMm,
            thicknessMm: row.thicknessMm ?? row.dimensions.thicknessMm,
          },
          weightMinG: row.weightMinG,
          weightMaxG: row.weightMaxG,
          status: row.status,
          notes: row.notes,
        }));
        pushChunkedInserts(statements, (rows) => ctx.db.insert(die).values(rows), values);
      }

      for (const row of input.updatedRows) {
        statements.push(
          ctx.db
            .update(die)
            .set({
              name: row.name,
              obliqueMm: row.obliqueMm ?? null,
              legMm: row.legMm ?? null,
              widthMm: row.widthMm ?? null,
              thicknessMm: row.thicknessMm ?? null,
              dimensions: {
                ...row.dimensions,
                widthMm: row.widthMm ?? row.dimensions.widthMm,
                thicknessMm: row.thicknessMm ?? row.dimensions.thicknessMm,
              },
              weightMinG: row.weightMinG,
              weightMaxG: row.weightMaxG,
              status: row.status,
              notes: row.notes,
              serverSeq,
            })
            .where(and(eq(die.id, row.existingId), eq(die.companyId, ctx.companyId))),
        );
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.import",
            subjectType: "die",
            meta: { newCount: input.newRows.length, updateCount: input.updatedRows.length },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);

      return { success: true, count: input.newRows.length + input.updatedRows.length };
    }),
});
