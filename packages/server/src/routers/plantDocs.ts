/**
 * Document register (XE parity lane ADM, row 80). Mounted as `docs`. Plant documents (ISO
 * procedures, customer specs, drawings, certificates) with a title, kind, version, a review date
 * and one file. Every member reads the register; `docs.manage` writes it.
 *
 * Files use the die file path: `files.beginUpload` signs a 10-minute PUT into the `DIE_FILES` bucket
 * under `{companyId}/dies/_docs/{fileId}` (the die upload ticket with section `_docs` and the
 * document id in its copy slot), the client PUTs the bytes, `files.commit` checks the object and sets
 * the document's file. A stage without R2 refuses the upload (PRECONDITION_FAILED) and keeps the
 * register itself working, as die files do. The orphan purge keeps every key a document points at.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { plantDocument, plantDocumentKinds } from "@orrn/db/schema/admin";
import { dieFileKinds } from "@orrn/db/schema/dies";
import { company } from "@orrn/db/schema/tenant";
import { documentReviewDue, isYmd } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { companyTimezone, zonedYmd } from "../lib/dayWindow";
import {
  checkDieFile,
  DIE_FILE_COMMIT_GRACE_MS,
  DIE_FILE_LIMITS,
  DIE_FILE_UPLOAD_TTL_MS,
  dieFilesBucket,
  dieFileUploadUrl,
  readUploadTicket,
  signDieFileUrl,
  signUploadTicket,
  ticketKey,
  type DieUploadTicket,
} from "../lib/dieFiles";
import { nextCompanySeq } from "../lib/sequence";

/** The section slot of a document upload ticket: no section has this id, so die commits refuse it. */
export const DOC_TICKET_SECTION = "_docs";

const id = z.string().min(1).max(64);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const reviewOn = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isYmd(v), "Give the review date as a day");

const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
};

const pad2 = (n: number) => String(n).padStart(2, "0");

async function plantToday(db: OrrnDb, companyId: string): Promise<string> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const ymd = zonedYmd(companyTimezone(co?.settings ?? {}), clockNow().getTime());
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

async function loadDoc(db: OrrnDb, companyId: string, docId: string) {
  const [row] = await db
    .select()
    .from(plantDocument)
    .where(and(eq(plantDocument.id, docId), eq(plantDocument.companyId, companyId)))
    .limit(1);
  return row ?? notFound();
}

export const plantDocsRouter = router({
  /** The register, review date first (due ones on top), with `reviewDue` against the plant's today. */
  list: companyProcedure
    .input(z.object({ kind: z.enum(plantDocumentKinds).optional(), includeRetired: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const today = await plantToday(ctx.db, ctx.companyId);
      const rows = await ctx.db
        .select({
          id: plantDocument.id,
          title: plantDocument.title,
          kind: plantDocument.kind,
          version: plantDocument.version,
          reviewOn: plantDocument.reviewOn,
          notes: plantDocument.notes,
          filename: plantDocument.filename,
          bytes: plantDocument.bytes,
          hasFile: sql<number>`${plantDocument.r2Key} is not null`,
          active: plantDocument.active,
          updatedAt: plantDocument.updatedAt,
        })
        .from(plantDocument)
        .where(
          and(
            eq(plantDocument.companyId, ctx.companyId),
            input?.kind ? eq(plantDocument.kind, input.kind) : undefined,
            input?.includeRetired ? undefined : eq(plantDocument.active, true),
          ),
        )
        .orderBy(sql`${plantDocument.reviewOn} is null`, asc(plantDocument.reviewOn), asc(plantDocument.title))
        .limit(500);
      return { today, items: rows.map((r) => ({ ...r, hasFile: Boolean(r.hasFile), reviewDue: r.active && documentReviewDue(r.reviewOn, today) })) };
    }),

  create: actionProcedure("docs.manage")
    .input(
      z.object({
        title: z.string().trim().min(1, "Give the title").max(120),
        kind: z.enum(plantDocumentKinds),
        version: optText(30),
        reviewOn,
        notes: optText(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db.insert(plantDocument).values({
          id: rowId,
          companyId: ctx.companyId,
          serverSeq: seq,
          title: input.title,
          kind: input.kind,
          version: input.version,
          reviewOn: input.reviewOn,
          notes: input.notes,
          active: true,
          createdBy: ctx.session.user.id,
        }),
        auditInsert(ctx, { action: "plant_document.create", subjectType: "plant_document", subjectId: rowId, meta: { title: input.title, kind: input.kind, version: input.version } }),
      ]);
      return { id: rowId };
    }),

  update: actionProcedure("docs.manage")
    .input(
      z.object({
        id,
        title: z.string().trim().min(1, "Give the title").max(120),
        kind: z.enum(plantDocumentKinds),
        version: optText(30),
        reviewOn,
        notes: optText(500),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadDoc(ctx.db, ctx.companyId, input.id);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const active = input.active ?? row.active;
      await atomicBatch(ctx.db, [
        ctx.db
          .update(plantDocument)
          .set({ title: input.title, kind: input.kind, version: input.version, reviewOn: input.reviewOn, notes: input.notes, active, serverSeq: seq })
          .where(and(eq(plantDocument.id, row.id), eq(plantDocument.companyId, ctx.companyId))),
        auditInsert(ctx, {
          action: "plant_document.update",
          subjectType: "plant_document",
          subjectId: row.id,
          meta: { from: { title: row.title, version: row.version, reviewOn: row.reviewOn, active: row.active }, to: { title: input.title, version: input.version, reviewOn: input.reviewOn, active } },
        }),
      ]);
      return { id: row.id };
    }),

  files: router({
    /** Sign a 10-minute PUT for a document's file (image, PDF, CDR or DWG, the die file limits). */
    beginUpload: actionProcedure("docs.manage")
      .input(
        z.object({
          documentId: id,
          kind: z.enum(dieFileKinds),
          name: z.string().trim().min(1).max(200),
          size: z.number().int().min(0).max(DIE_FILE_LIMITS.cdr + 1),
          mime: z.string().max(100).default(""),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const doc = await loadDoc(ctx.db, ctx.companyId, input.documentId);
        const contentType = checkDieFile(input.kind, { filename: input.name, contentType: input.mime, bytes: input.size });
        dieFilesBucket();
        const fileId = crypto.randomUUID();
        const expiresAt = clockNow().getTime() + DIE_FILE_UPLOAD_TTL_MS;
        const ticket: DieUploadTicket = {
          v: 1,
          companyId: ctx.companyId,
          userId: ctx.session.user.id,
          sectionId: DOC_TICKET_SECTION,
          dieInstanceId: doc.id,
          fileId,
          kind: input.kind,
          name: input.name,
          size: input.size,
          contentType,
          pressDrawing: false,
          exp: expiresAt,
        };
        const uploadId = await signUploadTicket(ticket);
        return { uploadId, fileId, key: ticketKey(ticket), uploadUrl: dieFileUploadUrl(ctx, uploadId), method: "PUT" as const, headers: { "content-type": contentType }, expiresAt };
      }),

    /** Check the object arrived whole and make it the document's file (a new file replaces the old). */
    commit: actionProcedure("docs.manage")
      .input(z.object({ uploadId: z.string().min(1).max(4100) }))
      .mutation(async ({ ctx, input }) => {
        const ticket = await readUploadTicket(input.uploadId, clockNow().getTime(), DIE_FILE_COMMIT_GRACE_MS);
        if (!ticket) throw new TRPCError({ code: "BAD_REQUEST", message: "This upload has expired; pick the file again" });
        if (ticket.companyId !== ctx.companyId || ticket.userId !== ctx.session.user.id || ticket.sectionId !== DOC_TICKET_SECTION || !ticket.dieInstanceId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
        }
        const doc = await loadDoc(ctx.db, ctx.companyId, ticket.dieInstanceId);
        const bucket = dieFilesBucket();
        const key = ticketKey(ticket);
        const head = await bucket.head(key);
        if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "The file has not arrived; upload it again" });
        if (head.size !== ticket.size) {
          await bucket.delete(key).catch(() => undefined);
          throw new TRPCError({ code: "BAD_REQUEST", message: "The file did not arrive whole; upload it again" });
        }
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(plantDocument)
            .set({ r2Key: key, filename: ticket.name, bytes: ticket.size, contentType: ticket.contentType, serverSeq: seq })
            .where(and(eq(plantDocument.id, doc.id), eq(plantDocument.companyId, ctx.companyId))),
          auditInsert(ctx, { action: "plant_document.file", subjectType: "plant_document", subjectId: doc.id, meta: { filename: ticket.name, bytes: ticket.size, replaced: doc.r2Key !== null } }),
        ]);
        // The replaced object is no longer pointed at; the daily purge removes it.
        return { id: doc.id };
      }),

    /** A signed 10-minute link to read a document's file. */
    url: companyProcedure.input(z.object({ documentId: id })).query(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx.db, ctx.companyId, input.documentId);
      if (!doc.r2Key) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      return signDieFileUrl(ctx, ctx.companyId, doc.r2Key);
    }),
  }),
});
