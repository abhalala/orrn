/**
 * Die files (FP-DR-07/13), mounted as `dieInstance.files`. Upload goes through the worker (base64
 * body), R2 first, then the `die_file` row; a D1 failure deletes the object. One press drawing PDF
 * per section: its key is copied to `die.drawing_key` in the same batch (and cleared when removed).
 * Reads are signed GETs valid 10 minutes.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dieFile, dieFileKinds, dieInstance } from "@orrn/db/schema/dies";

import { anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { auditCtx, loadSection } from "../lib/dieRoom";
import { checkDieFile, decodeBase64, dieFileKey, dieFilesBucket, DIE_FILE_LIMITS, signDieFileUrl } from "../lib/dieFiles";
import { nextCompanySeq } from "../lib/sequence";

/** Die card editors: the die room, or masters holders. */
const fileEditor = anyActionProcedure("die.card", "masters.publish");

/** 40 MB of bytes is about 53.4 M base64 characters. */
const MAX_BASE64 = Math.ceil((DIE_FILE_LIMITS.cdr * 4) / 3) + 1024;

export const dieFileRouter = router({
  /** Files of a section (and of one copy with `dieInstanceId`: the copy's plus the section's). Any member. */
  list: companyProcedure
    .input(z.object({ sectionId: z.string().min(1), dieInstanceId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      await loadSection(ctx.db, ctx.companyId, input.sectionId, { includeDeleted: true });
      return ctx.db
        .select()
        .from(dieFile)
        .where(
          and(
            eq(dieFile.companyId, ctx.companyId),
            eq(dieFile.sectionId, input.sectionId),
            input.dieInstanceId ? or(isNull(dieFile.dieInstanceId), eq(dieFile.dieInstanceId, input.dieInstanceId)) : undefined,
          ),
        )
        .orderBy(desc(dieFile.createdAt));
    }),

  add: fileEditor
    .input(
      z.object({
        sectionId: z.string().min(1),
        dieInstanceId: z.string().min(1).optional(),
        kind: z.enum(dieFileKinds),
        filename: z.string().trim().min(1).max(200),
        contentType: z.string().max(100).nullable().optional(),
        /** File bytes, base64 (a `data:` URL is fine). */
        body: z.string().min(1).max(MAX_BASE64),
        /** The press drawing (PDF only): replaces the section's previous one. */
        pressDrawing: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId);
      if (input.dieInstanceId) {
        const [copy] = await ctx.db
          .select({ id: dieInstance.id })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.sectionId, section.id)))
          .limit(1);
        if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
      }
      if (input.pressDrawing && input.kind !== "pdf") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The press drawing must be a PDF" });
      }
      if (input.pressDrawing && input.dieInstanceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The press drawing belongs to the section, not one copy" });
      }
      const bytes = decodeBase64(input.body);
      const contentType = checkDieFile(input.kind, { filename: input.filename, contentType: input.contentType, bytes: bytes.byteLength });
      const bucket = dieFilesBucket();

      const id = crypto.randomUUID();
      const key = dieFileKey(ctx.companyId, section.id, id);
      await bucket.put(key, bytes, {
        httpMetadata: { contentType, contentDisposition: `inline; filename="${input.filename.replace(/["\\\r\n]/g, "_")}"` },
        customMetadata: { companyId: ctx.companyId, sectionId: section.id, fileId: id },
      });

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [];
      if (input.pressDrawing) {
        statements.push(
          ctx.db
            .update(dieFile)
            .set({ pressDrawing: false, serverSeq: seq })
            .where(and(eq(dieFile.companyId, ctx.companyId), eq(dieFile.sectionId, section.id), eq(dieFile.pressDrawing, true))),
        );
      }
      statements.push(
        ctx.db.insert(dieFile).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          sectionId: section.id,
          dieInstanceId: input.dieInstanceId ?? null,
          kind: input.kind,
          r2Key: key,
          filename: input.filename,
          bytes: bytes.byteLength,
          pressDrawing: input.pressDrawing,
          createdBy: ctx.session.user.id,
        }),
      );
      if (input.pressDrawing) {
        statements.push(
          ctx.db
            .update(die)
            .set({ drawingKey: key, serverSeq: seq })
            .where(and(eq(die.id, section.id), eq(die.companyId, ctx.companyId), sql`exists (select 1 from die_file f where f.id = ${id})`)),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_file.add",
            subjectType: "die",
            subjectId: section.id,
            meta: { fileId: id, kind: input.kind, filename: input.filename, bytes: bytes.byteLength, pressDrawing: input.pressDrawing, dieInstanceId: input.dieInstanceId ?? null },
          },
          { from: dieFile, where: eq(dieFile.id, id) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        // No orphan object: the row did not land, so the bytes go too.
        await bucket.delete(key).catch(() => undefined);
        throw e;
      }
      return { id, key, bytes: bytes.byteLength };
    }),

  /** Delete the row and the object. Removing the press drawing clears `die.drawing_key`. */
  remove: fileEditor.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(dieFile)
      .where(and(eq(dieFile.id, input.id), eq(dieFile.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
    const bucket = dieFilesBucket();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ctx.db.delete(dieFile).where(and(eq(dieFile.id, row.id), eq(dieFile.companyId, ctx.companyId))),
      ...(row.pressDrawing
        ? [
            ctx.db
              .update(die)
              .set({ drawingKey: null, serverSeq: seq })
              .where(and(eq(die.id, row.sectionId), eq(die.companyId, ctx.companyId), eq(die.drawingKey, row.r2Key))),
          ]
        : []),
      auditInsertGuarded(
        auditCtx(ctx),
        {
          action: "die_file.remove",
          subjectType: "die",
          subjectId: row.sectionId,
          meta: { fileId: row.id, kind: row.kind, filename: row.filename, pressDrawing: row.pressDrawing },
        },
        { from: die, where: and(eq(die.id, row.sectionId), eq(die.companyId, ctx.companyId)) },
      ),
    ]);
    await bucket.delete(row.r2Key);
    return { success: true };
  }),

  /** Signed GET for one file of this company, valid 10 minutes. Any member. */
  url: companyProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ r2Key: dieFile.r2Key, filename: dieFile.filename })
      .from(dieFile)
      .where(and(eq(dieFile.id, input.id), eq(dieFile.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
    const signed = await signDieFileUrl(ctx, ctx.companyId, row.r2Key);
    return { ...signed, filename: row.filename };
  }),
});
