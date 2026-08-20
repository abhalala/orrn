import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { die, dieStatuses } from "@orrn/db/schema/catalog";
import { companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { nextCompanySeq } from "../lib/sequence";

export const dimensionsSchema = z.object({
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  thicknessMm: z.number().optional(),
  drawingUrl: z.string().optional(),
  drawingName: z.string().optional(),
  catalogueUrl: z.string().optional(),
}).passthrough();

const optionalDieLength = z.number().min(0).nullable().optional();

export const dieBaseSchema = z.object({
  series: z.string().min(1, "Series is required"),
  sectionCode: z.string().min(1, "Section Code is required"),
  name: z.string().nullable().optional(),
  obliqueMm: optionalDieLength,
  legMm: optionalDieLength,
  widthMm: optionalDieLength,
  thicknessMm: optionalDieLength,
  dimensions: dimensionsSchema.default({}),
  weightMinG: z.number().min(0, "Min weight must be >= 0"),
  weightMaxG: z.number().min(0, "Max weight must be >= 0"),
  status: z.enum(dieStatuses).default("active"),
  notes: z.string().nullable().optional(),
});

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

  create: companyProcedure
    .input(dieBaseSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      // Check duplicate
      const existing = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.companyId, ctx.companyId),
          eq(die.series, input.series),
          eq(die.sectionCode, input.sectionCode),
          isNull(die.deletedAt)
        )
      });

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

  update: companyProcedure
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
            isNull(die.deletedAt),
          ),
        });
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

  delete: companyProcedure
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

  validateImport: companyProcedure
    .input(z.array(dieBaseSchema))
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

  processImport: companyProcedure
    .input(z.object({
      newRows: z.array(dieBaseSchema),
      updatedRows: z.array(dieBaseSchema.extend({ existingId: z.string() }))
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.newRows.length === 0 && input.updatedRows.length === 0) {
        return { success: true, count: 0 };
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
        pushChunkedInserts(statements, (chunk) => ctx.db.insert(die).values(chunk), values, 100);
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
