import { TRPCError } from "@trpc/server";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { appRelease, backupRun, supportRequest, supportRequestStatuses } from "@orrn/db/schema/platform";
import { company } from "@orrn/db/schema/tenant";
import { MAX_RELEASE_NOTES, RELEASE_CHANNELS, RELEASE_PLATFORMS, releasePublishErrors } from "@orrn/domain";

import { platformGuard, router } from "../../index";
import { atomicBatch } from "../../lib/atomic";
import { auditInsert } from "../../lib/audit";
import { runDrill, runExport } from "../../lib/backup";
import { now } from "../../lib/clock";
import { createId } from "../../lib/id";
import { supportNext } from "../../lib/support";

/** `platform.release.*` (FP-PF-11): publish a native build; super_admin and admin, not support. */
export const platformReleaseRouter = router({
  publish: platformGuard("platform.release.publish")
    .input(
      z.object({
        platform: z.enum(RELEASE_PLATFORMS),
        channel: z.enum(RELEASE_CHANNELS),
        version: z.string().trim().min(1).max(32),
        buildNumber: z.number().int().min(1).max(1_000_000_000),
        minBuild: z.number().int().min(0).max(1_000_000_000),
        mandatory: z.boolean().default(false),
        notes: z.string().trim().min(1).max(MAX_RELEASE_NOTES),
        /** Floor channel: the signed APK in R2. Never on iOS. */
        apkUrl: z.string().trim().url().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const errors = releasePublishErrors(input);
      if (errors.includes("min_build_above_build")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Minimum build cannot be above the build number" });
      }
      if (errors.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Check the build number and notes" });
      if (input.apkUrl && input.platform === "ios") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An APK link is for Android only" });
      }
      // Build numbers only go up per platform (across channels: one app id, one build counter).
      const [top] = await ctx.db
        .select({ n: max(appRelease.buildNumber) })
        .from(appRelease)
        .where(eq(appRelease.platform, input.platform));
      if (top?.n != null && input.buildNumber <= top.n) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Build ${input.buildNumber} is not above the last published build ${top.n}` });
      }
      const clash = await ctx.db
        .select({ id: appRelease.id })
        .from(appRelease)
        .where(and(eq(appRelease.platform, input.platform), eq(appRelease.channel, input.channel), eq(appRelease.version, input.version)))
        .get();
      if (clash) throw new TRPCError({ code: "CONFLICT", message: "That version is already published on this channel" });

      const id = createId();
      const at = now();
      await atomicBatch(ctx.db, [
        ctx.db.insert(appRelease).values({
          id,
          platform: input.platform,
          channel: input.channel,
          version: input.version,
          buildNumber: input.buildNumber,
          minBuild: input.minBuild,
          minSupportedVersion: null,
          mandatory: input.mandatory,
          notes: input.notes,
          url: input.apkUrl ?? null,
          publishedAt: at,
          publishedBy: ctx.session.user.id,
        }),
        auditInsert(
          { ...ctx, companyId: null },
          {
            action: "app_release.publish",
            subjectType: "app_release",
            subjectId: id,
            meta: {
              platform: input.platform,
              channel: input.channel,
              version: input.version,
              buildNumber: input.buildNumber,
              minBuild: input.minBuild,
              mandatory: input.mandatory,
            },
          },
        ),
      ]);
      return { id };
    }),

  list: platformGuard("platform.company.manage").query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(appRelease).orderBy(desc(appRelease.publishedAt)).limit(200);
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      channel: r.channel,
      version: r.version,
      buildNumber: r.buildNumber,
      minBuild: r.minBuild,
      mandatory: r.mandatory,
      notes: r.notes,
      apkUrl: r.url,
      publishedAt: r.publishedAt.toISOString(),
    }));
  }),
});

const backupView = (r: typeof backupRun.$inferSelect) => ({
  id: r.id,
  companyId: r.companyId,
  kind: r.kind,
  purpose: r.purpose,
  status: r.status === "succeeded" ? ("ok" as const) : r.status,
  bytes: r.bytes,
  rowCount: r.rowCount,
  error: r.error,
  sourceRunId: r.sourceRunId,
  scratchCompanyId: r.scratchCompanyId,
  detail: r.detail ?? null,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
});

async function assertCompany(db: Parameters<typeof runExport>[0]["db"], companyId: string) {
  const row = await db.select({ id: company.id }).from(company).where(eq(company.id, companyId)).get();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
}

/** `platform.backup.*` (FP-PF-12): export now, restore drill, history. The r2Key stays staff-side. */
export const platformBackupRouter = router({
  run: platformGuard("platform.backup.run")
    .input(z.object({ companyId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertCompany(ctx.db, input.companyId);
      return backupView(await runExport(ctx, { companyId: input.companyId, kind: "manual", at: now() }));
    }),

  drill: platformGuard("platform.backup.run")
    .input(z.object({ companyId: z.string().min(1).max(64), sourceRunId: z.string().min(1).max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCompany(ctx.db, input.companyId);
      return backupView(await runDrill(ctx, { companyId: input.companyId, at: now(), sourceRunId: input.sourceRunId }));
    }),

  list: platformGuard("platform.backup.run")
    .input(z.object({ companyId: z.string().min(1).max(64).optional(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(backupRun)
        .where(input.companyId ? eq(backupRun.companyId, input.companyId) : undefined)
        .orderBy(desc(backupRun.startedAt), desc(backupRun.id))
        .limit(input.limit);
      return rows.map(backupView);
    }),
});

/** `platform.support.*` (FP-PF-14): list is `platform.company.manage`, reply/close `platform.support.reply`. */
export const platformSupportRouter = router({
  list: platformGuard("platform.company.manage")
    .input(
      z.object({
        status: z.enum(supportRequestStatuses).optional(),
        companyId: z.string().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.status) filters.push(eq(supportRequest.status, input.status));
      if (input.companyId) filters.push(eq(supportRequest.companyId, input.companyId));
      const rows = await ctx.db
        .select({
          id: supportRequest.id,
          companyId: supportRequest.companyId,
          companyName: company.name,
          subject: supportRequest.subject,
          body: supportRequest.body,
          screen: supportRequest.screen,
          status: supportRequest.status,
          reply: supportRequest.reply,
          repliedAt: supportRequest.repliedAt,
          createdBy: supportRequest.createdBy,
          createdAt: supportRequest.createdAt,
        })
        .from(supportRequest)
        .innerJoin(company, eq(company.id, supportRequest.companyId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(supportRequest.createdAt), desc(supportRequest.id))
        .limit(input.limit);
      return rows.map((r) => ({
        ...r,
        repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
    }),

  /** Open -> Answered (reply), Answered -> Closed, Open -> Closed (close without reply). */
  reply: platformGuard("platform.support.reply")
    .input(
      z
        .object({
          id: z.string().min(1).max(64),
          reply: z.string().trim().min(1).max(2000).optional(),
          close: z.boolean().default(false),
        })
        .refine((v) => v.reply !== undefined || v.close, { message: "Write a reply or close the request" }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.select().from(supportRequest).where(eq(supportRequest.id, input.id)).get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const next = supportNext(row.status, { reply: input.reply !== undefined, close: input.close });
      if (!next) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: row.status === "closed" ? "This request is closed" : "This request already has a reply",
        });
      }
      const at = now();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(supportRequest)
          .set({
            status: next,
            ...(input.reply !== undefined ? { reply: input.reply, repliedAt: at, repliedBy: ctx.session.user.id } : {}),
            serverSeq: row.serverSeq + 1,
          })
          .where(and(eq(supportRequest.id, row.id), eq(supportRequest.status, row.status))),
        auditInsert(
          { ...ctx, companyId: row.companyId },
          {
            action: input.reply !== undefined ? "support_request.reply" : "support_request.close",
            subjectType: "support_request",
            subjectId: row.id,
            meta: { from: row.status, to: next },
          },
        ),
      ]);
      return { id: row.id, status: next };
    }),
});
