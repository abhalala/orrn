/**
 * `foundry.spectroInbox.*` (FP-FD-12): files the plant's spectro watcher uploaded, waiting for a
 * person. Files arrive only through the node-signed `POST /collector/spectro/ingest` + signed PUT
 * (lib/spectroInbox.ts). Nothing here attaches automatically: `attach` is a cast.enter action that
 * names the melt. A simulated file is listed (marked `simulated`) but can only be dismissed.
 */
import { TRPCError } from "@trpc/server";
import { normalizeSpectroValues } from "@orrn/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { spectroInbox, spectroInboxStatuses } from "@orrn/db/schema/collector";
import { melt, spectroResult } from "@orrn/db/schema/foundry";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch } from "../lib/atomic";
import { spectroJudge } from "../lib/foundryKit";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);

export const spectroInboxRouter = router({
  list: companyProcedure
    .input(z.object({ status: z.array(z.enum(spectroInboxStatuses)).min(1).default(["pending_review"]) }).default({ status: ["pending_review"] }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: spectroInbox.id,
          status: spectroInbox.status,
          fileName: spectroInbox.fileName,
          mime: spectroInbox.mime,
          sizeBytes: spectroInbox.sizeBytes,
          sha256: spectroInbox.sha256,
          simulated: spectroInbox.simulated,
          capturedAt: spectroInbox.capturedAt,
          sampleRef: spectroInbox.sampleRef,
          instrument: spectroInbox.instrument,
          valuesPpm: spectroInbox.valuesPpm,
          uploadedAt: spectroInbox.uploadedAt,
          meltId: spectroInbox.meltId,
          spectroResultId: spectroInbox.spectroResultId,
          dismissReason: spectroInbox.dismissReason,
          createdAt: spectroInbox.createdAt,
        })
        .from(spectroInbox)
        .where(and(eq(spectroInbox.companyId, ctx.companyId), inArray(spectroInbox.status, input.status)))
        .orderBy(desc(spectroInbox.createdAt))
        .limit(100);
    }),

  /**
   * Attach a received file to a melt: writes a spectro_result (file stays in R2, `file_key`; the
   * watcher's parsed values become the result's values) and marks the inbox row attached.
   */
  attach: actionProcedure("cast.enter")
    .input(z.object({ id, meltId: id }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spectroInbox)
        .where(and(eq(spectroInbox.id, input.id), eq(spectroInbox.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      if (row.status !== "pending_review") {
        throw new TRPCError({ code: "CONFLICT", message: row.status === "uploading" ? "The file has not arrived yet" : "This file is already handled" });
      }
      // I-4: a spectro result has no simulated mark, so a simulator's file never becomes one. It
      // stays in the inbox, marked simulated, until someone dismisses it.
      if (row.simulated) throw new TRPCError({ code: "BAD_REQUEST", message: "Simulated file — demo only" });
      const m = await ctx.db
        .select({ id: melt.id, castId: melt.castId, cancelledAt: melt.cancelledAt, alloy: melt.alloy, alloyId: melt.alloyId })
        .from(melt)
        .where(and(eq(melt.id, input.meltId), eq(melt.companyId, ctx.companyId)))
        .get();
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Melt not found" });
      if (m.cancelledAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This melt is cancelled" });

      // W2-FD-S: the watcher's values are judged against the melt's alloy limits like a typed result.
      const judged = await spectroJudge(ctx.db, ctx.companyId, { alloyId: m.alloyId, alloyCode: m.alloy }, row.valuesPpm ?? {});

      // Claim the row first so two people cannot attach the same file twice.
      const claimed = await ctx.db
        .update(spectroInbox)
        .set({ status: "attached", meltId: m.id, reviewedBy: ctx.session.user.id, reviewedAt: new Date() })
        .where(and(eq(spectroInbox.id, row.id), eq(spectroInbox.status, "pending_review")))
        .returning({ id: spectroInbox.id });
      if (claimed.length === 0) throw new TRPCError({ code: "CONFLICT", message: "This file is already handled" });

      const resultId = crypto.randomUUID();
      try {
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db.insert(spectroResult).values({
            id: resultId,
            companyId: ctx.companyId,
            serverSeq: seq,
            meltId: m.id,
            castId: m.castId,
            fileName: row.fileName,
            mime: row.mime,
            sizeBytes: row.sizeBytes,
            dataBase64: "",
            fileKey: row.fileKey,
            valuesPpm: normalizeSpectroValues(row.valuesPpm),
            ...judged,
            source: "import",
            createdBy: ctx.session.user.id,
          }),
          ctx.db.update(spectroInbox).set({ spectroResultId: resultId }).where(eq(spectroInbox.id, row.id)),
          auditInsert(ctx, {
            action: "spectro.attach",
            subjectType: "spectro_result",
            subjectId: resultId,
            meta: { meltId: m.id, castId: m.castId, source: "collector", inboxId: row.id, sha256: row.sha256, simulated: row.simulated, verdict: judged.verdict },
          }),
        ]);
      } catch (error) {
        await ctx.db
          .update(spectroInbox)
          .set({ status: "pending_review", meltId: null, reviewedBy: null, reviewedAt: null })
          .where(eq(spectroInbox.id, row.id));
        throw error;
      }
      return { id: row.id, spectroResultId: resultId, verdict: judged.verdict };
    }),

  dismiss: actionProcedure("cast.enter")
    .input(z.object({ id, reason: z.string().trim().min(1, "Give a reason").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: spectroInbox.id, status: spectroInbox.status })
        .from(spectroInbox)
        .where(and(eq(spectroInbox.id, input.id), eq(spectroInbox.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      if (row.status === "attached" || row.status === "dismissed") throw new TRPCError({ code: "CONFLICT", message: "This file is already handled" });
      await atomicBatch(ctx.db, [
        ctx.db
          .update(spectroInbox)
          .set({ status: "dismissed", dismissReason: input.reason, reviewedBy: ctx.session.user.id, reviewedAt: new Date() })
          .where(and(eq(spectroInbox.id, row.id), inArray(spectroInbox.status, ["uploading", "pending_review"]))),
        auditInsert(ctx, { action: "spectro.inbox.dismiss", subjectType: "spectro_inbox", subjectId: row.id, meta: { reason: input.reason } }),
      ]);
      return { id: row.id };
    }),
});
