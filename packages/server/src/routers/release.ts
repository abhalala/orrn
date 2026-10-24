import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { appRelease } from "@orrn/db/schema/platform";
import { device } from "@orrn/db/schema/sync";
import { effectiveMinBuild, OFFLINE_GRACE_MS, RELEASE_CHANNELS, RELEASE_PLATFORMS, releaseGate } from "@orrn/domain";

import { actionProcedure, companyProcedure, publicProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now } from "../lib/clock";
import { createId } from "../lib/id";

/**
 * App distribution (FP-PF-11; platform spec §4 Distribution, §6 Distribution gate).
 * `release.check` is public and carries no company data. The native app calls it before the tab
 * bar; on no network it applies `offlineGate` (@orrn/domain) to the last answer for 24 h.
 */
export const releaseRouter = router({
  check: publicProcedure
    .input(
      z.object({
        platform: z.enum(RELEASE_PLATFORMS),
        channel: z.enum(RELEASE_CHANNELS),
        buildNumber: z.number().int().min(0).max(1_000_000_000),
        /** The install asking; a revoked install is blocked whatever its build. */
        installId: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const releases = await ctx.db
        .select({
          version: appRelease.version,
          buildNumber: appRelease.buildNumber,
          minBuild: appRelease.minBuild,
          mandatory: appRelease.mandatory,
          notes: appRelease.notes,
          url: appRelease.url,
          publishedAt: appRelease.publishedAt,
        })
        .from(appRelease)
        .where(
          and(eq(appRelease.platform, input.platform), eq(appRelease.channel, input.channel), isNotNull(appRelease.buildNumber)),
        )
        .orderBy(desc(appRelease.buildNumber))
        .limit(200);
      const floors = releases.map((r) => ({ buildNumber: r.buildNumber ?? 0, minBuild: r.minBuild ?? 0, mandatory: r.mandatory }));
      const minBuild = effectiveMinBuild(floors);

      let revoked = false;
      if (input.installId) {
        const rows = await ctx.db
          .select({ revokedAt: device.revokedAt })
          .from(device)
          .where(eq(device.installId, input.installId))
          .limit(20);
        // Revoked when every plant that knows this install has turned it off.
        revoked = rows.length > 0 && rows.every((r) => r.revokedAt !== null);
      }

      const gate = releaseGate({ buildNumber: input.buildNumber, minBuild, revoked });
      const latest = releases[0] ?? null;
      return {
        state: gate.state,
        reason: gate.reason,
        blocked: gate.state === "blocked",
        minBuild,
        latest: latest
          ? { version: latest.version, buildNumber: latest.buildNumber ?? 0, publishedAt: latest.publishedAt.toISOString() }
          : null,
        notes: latest?.notes ?? null,
        apkUrl: input.platform === "android" ? (latest?.url ?? null) : null,
        /** The device stores this; offline, the answer holds until checkedAt + graceMs. */
        checkedAt: now().getTime(),
        graceMs: OFFLINE_GRACE_MS,
      };
    }),
});

const DEVICE_PLATFORMS = ["android", "ios", "web"] as const;

export const deviceRouter = router({
  /** Native launch / web session start. Upserts on (company, install). A revoked install is FORBIDDEN. */
  register: companyProcedure
    .input(
      z.object({
        installId: z.string().trim().min(8).max(128),
        platform: z.enum(DEVICE_PLATFORMS),
        osVersion: z.string().trim().max(64).optional(),
        appVersion: z.string().trim().max(64).optional(),
        pushToken: z.string().trim().max(512).optional(),
        label: z.string().trim().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: device.id, revokedAt: device.revokedAt })
        .from(device)
        .where(and(eq(device.companyId, ctx.companyId), eq(device.installId, input.installId)))
        .get();
      if (existing?.revokedAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This device has been turned off for this plant" });
      }
      const at = now();
      if (existing) {
        await ctx.db
          .update(device)
          .set({
            userId: ctx.session.user.id,
            platform: input.platform,
            osVersion: input.osVersion ?? null,
            appVersion: input.appVersion ?? null,
            ...(input.pushToken !== undefined ? { pushToken: input.pushToken } : {}),
            lastSeenAt: at,
          })
          .where(and(eq(device.id, existing.id), eq(device.companyId, ctx.companyId)));
        return { id: existing.id, created: false };
      }
      const id = createId(at.getTime());
      await ctx.db
        .insert(device)
        .values({
          id,
          companyId: ctx.companyId,
          userId: ctx.session.user.id,
          platform: input.platform,
          osVersion: input.osVersion ?? null,
          appVersion: input.appVersion ?? null,
          installId: input.installId,
          pushToken: input.pushToken ?? null,
          label: input.label ?? null,
          lastSeenAt: at,
        })
        .onConflictDoNothing();
      return { id, created: true };
    }),

  /** Devices tab (`users.manage`). Push tokens are never returned. */
  list: actionProcedure("users.manage").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: device.id,
        platform: device.platform,
        label: device.label,
        appVersion: device.appVersion,
        osVersion: device.osVersion,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
        createdAt: device.createdAt,
        userId: device.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(device)
      .leftJoin(user, eq(user.id, device.userId))
      .where(eq(device.companyId, ctx.companyId))
      .orderBy(desc(device.lastSeenAt))
      .limit(500);
    return rows.map((r) => ({
      ...r,
      lastSeenAt: r.lastSeenAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }),

  /** Turn a device off: its next register and release check are refused. Never deletes the row. */
  revoke: actionProcedure("users.manage")
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: device.id, revokedAt: device.revokedAt, installId: device.installId })
        .from(device)
        .where(and(eq(device.id, input.id), eq(device.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (row.revokedAt) return { success: true, changed: false };
      await atomicBatch(ctx.db, [
        ctx.db
          .update(device)
          .set({ revokedAt: now(), revokedBy: ctx.session.user.id })
          .where(and(eq(device.id, row.id), eq(device.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "device.revoke", subjectType: "device", subjectId: row.id, meta: {} }),
      ]);
      return { success: true, changed: true };
    }),

  /** Undo a revoke (the device registers again on its next launch). */
  restore: actionProcedure("users.manage")
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: device.id, revokedAt: device.revokedAt })
        .from(device)
        .where(and(eq(device.id, input.id), eq(device.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (!row.revokedAt) return { success: true, changed: false };
      await atomicBatch(ctx.db, [
        ctx.db
          .update(device)
          .set({ revokedAt: null, revokedBy: null })
          .where(and(eq(device.id, row.id), eq(device.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "device.restore", subjectType: "device", subjectId: row.id, meta: {} }),
      ]);
      return { success: true, changed: true };
    }),
});
