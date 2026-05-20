import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { die, dieStatuses } from "@orrn/db/schema/catalog";
import { companyProcedure, router } from "../index";
import { writeAudit } from "../lib/audit";
import { nextCompanySeq } from "../lib/sequence";

export const dimensionsSchema = z.object({
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  thicknessMm: z.number().optional(),
});

export const dieBaseSchema = z.object({
  series: z.string().min(1, "Series is required"),
  sectionCode: z.string().min(1, "Section Code is required"),
  name: z.string().nullable().optional(),
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
      
      await ctx.db.transaction(async (tx) => {
        const serverSeq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        
        await tx.insert(die).values({
          id,
          companyId: ctx.companyId,
          serverSeq,
          series: input.series,
          sectionCode: input.sectionCode,
          name: input.name,
          dimensions: input.dimensions,
          weightMinG: input.weightMinG,
          weightMaxG: input.weightMaxG,
          status: input.status,
          notes: input.notes,
        });

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "die.create",
            subjectType: "die",
            subjectId: id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          }
        );
      });

      return { success: true, id };
    }),

  update: companyProcedure
    .input(dieBaseSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      await ctx.db.transaction(async (tx) => {
        const existing = await tx.query.die.findFirst({
          where: and(
            eq(die.id, input.id),
            eq(die.companyId, ctx.companyId),
            isNull(die.deletedAt)
          )
        });

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
        }

        // Check duplicate on change
        if (existing.series !== input.series || existing.sectionCode !== input.sectionCode) {
          const duplicate = await tx.query.die.findFirst({
            where: and(
              eq(die.companyId, ctx.companyId),
              eq(die.series, input.series),
              eq(die.sectionCode, input.sectionCode),
              isNull(die.deletedAt)
            )
          });
          if (duplicate) {
            throw new TRPCError({ code: "CONFLICT", message: "Another die with this series and section code already exists" });
          }
        }

        const serverSeq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .update(die)
          .set({
            series: input.series,
            sectionCode: input.sectionCode,
            name: input.name,
            dimensions: input.dimensions,
            weightMinG: input.weightMinG,
            weightMaxG: input.weightMaxG,
            status: input.status,
            notes: input.notes,
            serverSeq,
          })
          .where(eq(die.id, input.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "die.update",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          }
        );
      });

      return { success: true };
    }),

  delete: companyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const existing = await tx.query.die.findFirst({
          where: and(
            eq(die.id, input.id),
            eq(die.companyId, ctx.companyId),
            isNull(die.deletedAt)
          )
        });

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
        }

        const serverSeq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .update(die)
          .set({
            deletedAt: new Date(),
            serverSeq,
          })
          .where(eq(die.id, input.id));

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "die.delete",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: existing.series, sectionCode: existing.sectionCode },
          }
        );
      });

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

      await ctx.db.transaction(async (tx) => {
        const serverSeq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        
        // Insert new
        if (input.newRows.length > 0) {
          const values = input.newRows.map(row => ({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq,
            series: row.series,
            sectionCode: row.sectionCode,
            name: row.name,
            dimensions: row.dimensions,
            weightMinG: row.weightMinG,
            weightMaxG: row.weightMaxG,
            status: row.status,
            notes: row.notes,
          }));

          const chunkSize = 100;
          for (let i = 0; i < values.length; i += chunkSize) {
            const chunk = values.slice(i, i + chunkSize);
            await tx.insert(die).values(chunk);
          }
        }

        // Update existing
        for (const row of input.updatedRows) {
          await tx.update(die).set({
            name: row.name,
            dimensions: row.dimensions,
            weightMinG: row.weightMinG,
            weightMaxG: row.weightMaxG,
            status: row.status,
            notes: row.notes,
            serverSeq,
          }).where(and(
             eq(die.id, row.existingId),
             eq(die.companyId, ctx.companyId)
          ));
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "die.import",
            subjectType: "die",
            meta: { newCount: input.newRows.length, updateCount: input.updatedRows.length },
          }
        );
      });

      return { success: true, count: input.newRows.length + input.updatedRows.length };
    }),
});
