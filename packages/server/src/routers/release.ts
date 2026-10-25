import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { session, user } from "@orrn/db/schema/auth";
import { appRelease } from "@orrn/db/schema/platform";
import { device } from "@orrn/db/schema/sync";
import { effectiveMinBuild, OFFLINE_GRACE_MS, RELEASE_CHANNELS, RELEASE_PLATFORMS, releaseGate } from "@orrn/domain";

import { actionProcedure, companyProcedure, publicProcedure, router } from "../index";
import { atomicBatch, atomicBatchLast } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { TRPCMetaError } from "../lib/errorMeta";
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

export type DeviceGateStatus = "revoked" | "blocked" | "current" | "web" | "unknown";

/** The build number in an app version like `1.1 (11)`, or null when there is none. */
export function buildNumberOf(appVersion: string | null | undefined): number | null {
  const m = /\((\d+)\)\s*$/.exec(appVersion ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Where a device stands against the distribution gate (Settings > Devices), worked out here so
 * the screen only shows it. A device's channel is not recorded, so it is Blocked only when below
 * the LOWEST published floor for its platform. Revoked beats everything; the web app has no build
 * gate; a device that never reported a build is Unknown, not Current.
 */
export function deviceGateStatus(
  d: { platform: string; appVersion: string | null; revokedAt: Date | null },
  floorOf: (platform: string) => number,
): DeviceGateStatus {
  if (d.revokedAt) return "revoked";
  if (d.platform === "web") return "web";
  const build = buildNumberOf(d.appVersion);
  if (build === null) return "unknown";
  return build < floorOf(d.platform) ? "blocked" : "current";
}

export const deviceRouter = router({
  /**
   * Native launch / web session start. Upserts on (company, install) and records the session that
   * registered, so a revoke can end it. A revoked install is FORBIDDEN, and the session that asked
   * is ended too (signing in again on a revoked tablet does not give it the API back).
   */
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
      const userId = ctx.session.user.id;
      const sessionId = ctx.session.session?.id ?? null;
      const findInstall = () =>
        ctx.db
          .select({ id: device.id, revokedAt: device.revokedAt })
          .from(device)
          .where(and(eq(device.companyId, ctx.companyId), eq(device.installId, input.installId)));
      const at = now();

      /** Refuse a revoked install, else refresh the row that is there. */
      const touch = async (existing: { id: string; revokedAt: Date | null }) => {
        if (existing.revokedAt) {
          if (sessionId) {
            await ctx.db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId)));
          }
          // `data.meta.reason` is the machine code the phone signs out on (it must not match this English sentence).
          throw new TRPCMetaError({ code: "FORBIDDEN", message: "This device has been turned off for this plant", meta: { reason: "device_revoked" } });
        }
        await ctx.db
          .update(device)
          .set({
            userId,
            platform: input.platform,
            osVersion: input.osVersion ?? null,
            appVersion: input.appVersion ?? null,
            ...(input.pushToken !== undefined ? { pushToken: input.pushToken } : {}),
            authSessionId: sessionId,
            lastSeenAt: at,
          })
          .where(and(eq(device.id, existing.id), eq(device.companyId, ctx.companyId)));
        return { id: existing.id, created: false };
      };

      const existing = await findInstall().get();
      if (existing) return touch(existing);

      const id = createId(at.getTime());
      // Insert-or-nothing and read back in one batch: a racing register of the same install may
      // have landed first, and then its row (not ours) is the device.
      const [landed] = await atomicBatchLast<{ id: string; revokedAt: Date | null }>(ctx.db, [
        ctx.db
          .insert(device)
          .values({
            id,
            companyId: ctx.companyId,
            userId,
            platform: input.platform,
            osVersion: input.osVersion ?? null,
            appVersion: input.appVersion ?? null,
            installId: input.installId,
            pushToken: input.pushToken ?? null,
            label: input.label ?? null,
            authSessionId: sessionId,
            lastSeenAt: at,
          })
          .onConflictDoNothing(),
        findInstall().limit(1),
      ]);
      if (!landed) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not register this device" });
      if (landed.id === id) return { id, created: true };
      return touch(landed);
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
    const releases = await ctx.db
      .select({
        platform: appRelease.platform,
        channel: appRelease.channel,
        buildNumber: appRelease.buildNumber,
        minBuild: appRelease.minBuild,
        mandatory: appRelease.mandatory,
      })
      .from(appRelease)
      .where(isNotNull(appRelease.buildNumber))
      .limit(1000);
    const floors = new Map<string, number>();
    for (const platform of ["android", "ios"]) {
      const perChannel = RELEASE_CHANNELS.map((channel) =>
        releases
          .filter((r) => r.platform === platform && r.channel === channel)
          .map((r) => ({ buildNumber: r.buildNumber ?? 0, minBuild: r.minBuild ?? 0, mandatory: r.mandatory })),
      )
        .filter((rs) => rs.length > 0)
        .map((rs) => effectiveMinBuild(rs));
      floors.set(platform, perChannel.length ? Math.min(...perChannel) : 0);
    }
    return rows.map((r) => ({
      ...r,
      gate: deviceGateStatus(r, (platform) => floors.get(platform) ?? 0),
      lastSeenAt: r.lastSeenAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }),

  /**
   * Turn a device off: the session it registered with ends now, its next register is refused and
   * its release check answers Blocked. Never deletes the row.
   */
  revoke: actionProcedure("users.manage")
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: device.id, revokedAt: device.revokedAt, userId: device.userId, authSessionId: device.authSessionId })
        .from(device)
        .where(and(eq(device.id, input.id), eq(device.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (row.revokedAt) return { success: true, changed: false };
      // The session it last registered with (only that one: the person's other devices stay
      // signed in). Scoped to the device's user so a stale id can never end someone else's.
      const ownSession = row.authSessionId ? and(eq(session.id, row.authSessionId), eq(session.userId, row.userId)) : null;
      const sessionEnded = ownSession ? Boolean(await ctx.db.select({ id: session.id }).from(session).where(ownSession).get()) : false;
      await atomicBatch(ctx.db, [
        ctx.db
          .update(device)
          .set({ revokedAt: now(), revokedBy: ctx.session.user.id, authSessionId: null })
          .where(and(eq(device.id, row.id), eq(device.companyId, ctx.companyId))),
        ...(ownSession ? [ctx.db.delete(session).where(ownSession)] : []),
        auditInsert(ctx, { action: "device.revoke", subjectType: "device", subjectId: row.id, meta: { sessionEnded } }),
      ]);
      return { success: true, changed: true };
    }),

  /**
   * Name a device ("Packing bay tablet"). Blank clears the name. The register call only sets the
   * label when the device is first seen, so the Devices tab is where staff fix it afterwards.
   */
  rename: actionProcedure("users.manage")
    .input(z.object({ id: z.string().min(1).max(64), label: z.string().trim().max(60) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: device.id, label: device.label })
        .from(device)
        .where(and(eq(device.id, input.id), eq(device.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const label = input.label === "" ? null : input.label;
      if ((row.label ?? null) === label) return { success: true, changed: false };
      await atomicBatch(ctx.db, [
        ctx.db
          .update(device)
          .set({ label })
          .where(and(eq(device.id, row.id), eq(device.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "device.rename", subjectType: "device", subjectId: row.id, meta: { from: row.label, to: label } }),
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
