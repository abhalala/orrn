/**
 * Die files (FP-DR-07/13), mounted as `dieInstance.files`. Upload in three steps (LEDGER D13, never
 * base64 in a tRPC body): `beginUpload` checks and signs a 10-minute PUT URL; the client PUTs the
 * bytes to `/files/dies/upload` (streamed into R2 by the Worker); `commit` checks the object and
 * writes the `die_file` row; a D1 failure deletes the object. One press drawing PDF per section: its
 * key is copied to `die.drawing_key` in the same batch (and cleared when removed). Reads are signed
 * GETs valid 10 minutes.
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
import { now as clockNow } from "../lib/clock";
import {
  checkDieFile,
  dieFilesBucket,
  dieFileUploadUrl,
  DIE_FILE_COMMIT_GRACE_MS,
  DIE_FILE_LIMITS,
  DIE_FILE_UPLOAD_TTL_MS,
  readUploadTicket,
  signDieFileUrl,
  signUploadTicket,
  ticketKey,
  type DieUploadTicket,
} from "../lib/dieFiles";
import { nextCompanySeq } from "../lib/sequence";

/** Die card editors: the die room, or masters holders. */
const fileEditor = anyActionProcedure("die.card", "masters.publish");

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

  /**
   * Step 1 of an upload (D13): check where the file goes, its kind, size and type, and hand back a
   * signed PUT URL valid 10 minutes. Nothing is stored yet. `copyId` = a copy's file (its section
   * is implied); `sectionId` alone = a section file. `pressDrawing` (PDF, section only) replaces the
   * section's press drawing on commit.
   */
  beginUpload: fileEditor
    .input(
      z
        .object({
          sectionId: z.string().min(1).optional(),
          copyId: z.string().min(1).optional(),
          kind: z.enum(dieFileKinds),
          name: z.string().trim().min(1).max(200),
          /** Bytes, as the browser's `File.size`. Checked against the kind's limit here and on the PUT. */
          size: z.number().int().min(0).max(DIE_FILE_LIMITS.cdr + 1),
          /** The browser's `File.type` ("" for CDR/DWG is fine). */
          mime: z.string().max(100).default(""),
          pressDrawing: z.boolean().default(false),
        })
        .refine((v) => Boolean(v.sectionId || v.copyId), { message: "Pick a section or a die copy", path: ["sectionId"] }),
    )
    .mutation(async ({ ctx, input }) => {
      let sectionId = input.sectionId ?? null;
      if (input.copyId) {
        const [copy] = await ctx.db
          .select({ id: dieInstance.id, sectionId: dieInstance.sectionId })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, input.copyId), eq(dieInstance.companyId, ctx.companyId)))
          .limit(1);
        if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
        if (sectionId && sectionId !== copy.sectionId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This die copy belongs to another section" });
        }
        sectionId = copy.sectionId;
      }
      const section = await loadSection(ctx.db, ctx.companyId, sectionId!);
      if (input.pressDrawing && input.kind !== "pdf") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The press drawing must be a PDF" });
      }
      if (input.pressDrawing && input.copyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The press drawing belongs to the section, not one copy" });
      }
      const contentType = checkDieFile(input.kind, { filename: input.name, contentType: input.mime, bytes: input.size });
      dieFilesBucket();

      const fileId = crypto.randomUUID();
      const expiresAt = clockNow().getTime() + DIE_FILE_UPLOAD_TTL_MS;
      const ticket: DieUploadTicket = {
        v: 1,
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        sectionId: section.id,
        dieInstanceId: input.copyId ?? null,
        fileId,
        kind: input.kind,
        name: input.name,
        size: input.size,
        contentType,
        pressDrawing: input.pressDrawing,
        exp: expiresAt,
      };
      const uploadId = await signUploadTicket(ticket);
      return {
        uploadId,
        fileId,
        key: ticketKey(ticket),
        uploadUrl: dieFileUploadUrl(ctx, uploadId),
        method: "PUT" as const,
        /** Send exactly these headers (plus Content-Length, which the browser sets from the body). */
        headers: { "content-type": contentType },
        expiresAt,
      };
    }),

  /**
   * Step 3 of an upload: after the PUT, record the file. Checks the object is in R2 with the declared
   * size (else it is deleted and nothing is written), then one batch: the `die_file` row, the press
   * drawing swap and `die.drawing_key`, the audit row. A failed batch deletes the object too.
   * Only the member who began the upload can commit it.
   */
  commit: fileEditor.input(z.object({ uploadId: z.string().min(1).max(4100) })).mutation(async ({ ctx, input }) => {
    const ticket = await readUploadTicket(input.uploadId, clockNow().getTime(), DIE_FILE_COMMIT_GRACE_MS);
    if (!ticket) throw new TRPCError({ code: "BAD_REQUEST", message: "This upload has expired; pick the file again" });
    if (ticket.companyId !== ctx.companyId || ticket.userId !== ctx.session.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
    }
    const bucket = dieFilesBucket();
    const key = ticketKey(ticket);
    const [already] = await ctx.db
      .select({ id: dieFile.id })
      .from(dieFile)
      .where(and(eq(dieFile.id, ticket.fileId), eq(dieFile.companyId, ctx.companyId)))
      .limit(1);
    if (already) throw new TRPCError({ code: "CONFLICT", message: "This file is already saved" });
    const head = await bucket.head(key);
    if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "The file has not arrived; upload it again" });
    if (head.size !== ticket.size) {
      await bucket.delete(key).catch(() => undefined);
      throw new TRPCError({ code: "BAD_REQUEST", message: "The file did not arrive whole; upload it again" });
    }
    const removeObject = () => bucket.delete(key).catch(() => undefined);
    let section: Awaited<ReturnType<typeof loadSection>>;
    try {
      section = await loadSection(ctx.db, ctx.companyId, ticket.sectionId);
      if (ticket.dieInstanceId) {
        const [copy] = await ctx.db
          .select({ id: dieInstance.id })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, ticket.dieInstanceId), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.sectionId, section.id)))
          .limit(1);
        if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
      }
    } catch (e) {
      await removeObject();
      throw e;
    }

    const id = ticket.fileId;
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [];
    if (ticket.pressDrawing) {
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
        dieInstanceId: ticket.dieInstanceId,
        kind: ticket.kind,
        r2Key: key,
        filename: ticket.name,
        bytes: head.size,
        pressDrawing: ticket.pressDrawing,
        createdBy: ctx.session.user.id,
      }),
    );
    if (ticket.pressDrawing) {
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
          meta: { fileId: id, kind: ticket.kind, filename: ticket.name, bytes: head.size, pressDrawing: ticket.pressDrawing, dieInstanceId: ticket.dieInstanceId },
        },
        { from: dieFile, where: eq(dieFile.id, id) },
      ),
    );
    try {
      await atomicBatch(ctx.db, statements);
    } catch (e) {
      // No orphan object: the row did not land, so the bytes go too.
      await removeObject();
      throw e;
    }
    return { id, key, bytes: head.size };
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
