/**
 * FP-PF-11 app distribution and devices (platform spec §4 Distribution, §6 Distribution gate;
 * ledger D8 minimum-build gate): `platform.release.publish`, public `release.check`,
 * `device.register / list / revoke / restore`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { appRelease, auditLog, device, session } from "@orrn/db/schema";
import { effectiveMinBuild, offlineGate } from "@orrn/domain";
import { and, eq, isNull } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const anon = () => env.caller(null);
const staff = (role: "super_admin" | "admin" | "support" = "admin") => env.caller({ platformRole: role });
let buildBase = 1000;
/** Fresh build numbers per test: app_release is platform-wide, tests share one database. */
const nextBuilds = () => {
  buildBase += 100;
  return buildBase;
};

describe("platform.release.publish", () => {
  test("super_admin and admin publish; support and plant roles cannot", async () => {
    const b = nextBuilds();
    const input = { platform: "android" as const, channel: "floor" as const, version: `9.${b}.0`, buildNumber: b, minBuild: b, notes: "Scale weights" };
    await expect(staff("support").platform.release.publish(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { companyId } = await env.seedCompany();
    await expect(env.caller({ role: "owner", companyId }).platform.release.publish(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await staff("super_admin").platform.release.publish(input);
    const row = await env.db.select().from(appRelease).where(eq(appRelease.id, id)).get();
    expect(row).toMatchObject({ platform: "android", channel: "floor", buildNumber: b, minBuild: b, mandatory: false, notes: "Scale weights" });
    const [audit] = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "app_release.publish"), eq(auditLog.subjectId, id)));
    expect(audit!.companyId).toBeNull();
    expect(audit!.meta).toMatchObject({ platform: "android", buildNumber: b });
  });

  test("build numbers only go up per platform; minBuild <= buildNumber; notes required, max 500; channel production|floor", async () => {
    const b = nextBuilds();
    const base = { platform: "ios" as const, channel: "production" as const, version: `7.${b}`, buildNumber: b, minBuild: b - 1, notes: "First" };
    await staff().platform.release.publish(base);
    await expect(staff().platform.release.publish({ ...base, version: `7.${b}.1` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(staff().platform.release.publish({ ...base, version: `7.${b}.2`, buildNumber: b - 5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      staff().platform.release.publish({ ...base, version: `7.${b}.3`, buildNumber: b + 1, minBuild: b + 2 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Minimum build cannot be above the build number" });
    await expect(staff().platform.release.publish({ ...base, version: `7.${b}.4`, buildNumber: b + 1, notes: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      staff().platform.release.publish({ ...base, version: `7.${b}.5`, buildNumber: b + 1, notes: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      staff().platform.release.publish({ ...base, version: `7.${b}.6`, buildNumber: b + 1, channel: "stable" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      staff().platform.release.publish({ ...base, version: `7.${b}.7`, buildNumber: b + 1, apkUrl: "https://r2.example/app.apk" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "An APK link is for Android only" });
    // The same version twice on a channel is a CONFLICT.
    await expect(staff().platform.release.publish({ ...base, buildNumber: b + 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await staff().platform.release.publish({ ...base, version: `7.${b}.8`, buildNumber: b + 1, notes: "x".repeat(500) });
  });
});

describe("release.check gate matrix (public, no company data)", () => {
  test("min build: below blocked, at and above open; the floor APK link and notes come back", async () => {
    const b = nextBuilds();
    await staff().platform.release.publish({
      platform: "android",
      channel: "floor",
      version: `5.${b}`,
      buildNumber: b,
      minBuild: b - 10,
      notes: "Floor build",
      apkUrl: "https://r2.example/floor.apk",
    });
    const below = await anon().release.check({ platform: "android", channel: "floor", buildNumber: b - 11 });
    expect(below).toMatchObject({ state: "blocked", reason: "below_min_build", blocked: true, minBuild: b - 10 });
    const at = await anon().release.check({ platform: "android", channel: "floor", buildNumber: b - 10 });
    expect(at).toMatchObject({ state: "open", blocked: false, notes: "Floor build", apkUrl: "https://r2.example/floor.apk" });
    expect(at.latest).toMatchObject({ version: `5.${b}`, buildNumber: b });
    expect(at.graceMs).toBe(24 * 3_600_000);
    expect(JSON.stringify(at)).not.toMatch(/company/i);
  });

  test("a mandatory older release keeps its higher floor even when the newest row is lower", async () => {
    const b = nextBuilds();
    await staff().platform.release.publish({ platform: "android", channel: "production", version: `m.${b}`, buildNumber: b, minBuild: b, mandatory: true, notes: "Must" });
    await staff().platform.release.publish({ platform: "android", channel: "production", version: `m.${b + 1}`, buildNumber: b + 1, minBuild: 1, notes: "Relaxed" });
    const res = await anon().release.check({ platform: "android", channel: "production", buildNumber: b - 1 });
    expect(res).toMatchObject({ blocked: true, minBuild: b });
  });

  test("revoked install blocked whatever the build; restore opens it again", async () => {
    const b = nextBuilds();
    await staff().platform.release.publish({ platform: "ios", channel: "floor", version: `r.${b}`, buildNumber: b, minBuild: b, notes: "R" });
    const { companyId } = await env.seedCompany();
    const operator = env.caller({ role: "operator", companyId });
    const admin = env.caller({ role: "admin", companyId });
    const installId = `install-${crypto.randomUUID()}`;
    const { id } = await operator.device.register({ installId, platform: "ios", appVersion: `r.${b}` });
    expect((await anon().release.check({ platform: "ios", channel: "floor", buildNumber: b, installId })).state).toBe("open");

    await admin.device.revoke({ id });
    const blocked = await anon().release.check({ platform: "ios", channel: "floor", buildNumber: b + 50, installId });
    expect(blocked).toMatchObject({ state: "blocked", reason: "revoked" });
    await expect(operator.device.register({ installId, platform: "ios" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await admin.device.restore({ id });
    expect((await anon().release.check({ platform: "ios", channel: "floor", buildNumber: b, installId })).state).toBe("open");
    await operator.device.register({ installId, platform: "ios" });
  });

  test("offline grace (24 h from the last Open check) and never-checked, on the answers release.check gives", async () => {
    const b = nextBuilds();
    await staff().platform.release.publish({ platform: "android", channel: "floor", version: `g.${b}`, buildNumber: b, minBuild: b, notes: "G" });
    const open = await anon().release.check({ platform: "android", channel: "floor", buildNumber: b });
    const last = { at: open.checkedAt, state: open.state, buildNumber: b };
    expect(offlineGate(last, { at: open.checkedAt + open.graceMs - 1, buildNumber: b }).state).toBe("open");
    expect(offlineGate(last, { at: open.checkedAt + open.graceMs, buildNumber: b })).toMatchObject({ state: "blocked", reason: "grace_expired" });
    expect(offlineGate(null, { at: open.checkedAt, buildNumber: b })).toMatchObject({ state: "blocked", reason: "never_checked" });
    // An OTA cannot clear a block: the gate reads the native build only.
    const old = await anon().release.check({ platform: "android", channel: "floor", buildNumber: b - 1 });
    expect(offlineGate({ at: old.checkedAt, state: old.state, buildNumber: b - 1 }, { at: old.checkedAt + 1, buildNumber: b - 1 }).state).toBe("blocked");
  });

  test("nothing published on a channel: nothing to gate (open)", async () => {
    expect(effectiveMinBuild([])).toBe(0);
    // This file's own D1: clear the one pair so nothing is published on it (the publish test above
    // wrote ios + production; nothing after this test reads that pair).
    const pair = and(eq(appRelease.platform, "ios"), eq(appRelease.channel, "production"));
    await env.db.delete(appRelease).where(pair);
    expect(await env.db.select({ id: appRelease.id }).from(appRelease).where(pair)).toHaveLength(0);
    for (const buildNumber of [0, 1, 999]) {
      const res = await anon().release.check({ platform: "ios", channel: "production", buildNumber });
      expect(res).toMatchObject({ state: "open", blocked: false, minBuild: 0, latest: null, notes: null, apkUrl: null });
    }
  });
});

describe("devices", () => {
  test("register upserts on (company, install), list is users.manage only and hides push tokens, revoke audits and never deletes", async () => {
    const { companyId } = await env.seedCompany();
    const packer = env.caller({ role: "packer", companyId });
    const installId = `install-${crypto.randomUUID()}`;
    const first = await packer.device.register({ installId, platform: "android", appVersion: "1.0 (10)", pushToken: "push-secret" });
    const second = await packer.device.register({ installId, platform: "android", appVersion: "1.1 (11)" });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });

    await expect(packer.device.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(env.caller({ role: "manager", companyId }).device.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const list = await env.caller({ role: "admin", companyId }).device.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: first.id, appVersion: "1.1 (11)", revokedAt: null });
    expect(JSON.stringify(list)).not.toContain("push-secret");

    await expect(packer.device.revoke({ id: first.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await env.caller({ role: "owner", companyId }).device.revoke({ id: first.id });
    const row = await env.db.select().from(device).where(eq(device.id, first.id)).get();
    expect(row!.revokedAt).not.toBeNull();
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "device.revoke"), eq(auditLog.subjectId, first.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.companyId).toBe(companyId);
  });

  test("revoke ends the session the device registered with; a revoked install's register ends the asking session", async () => {
    const { companyId, users } = await env.seedCompany();
    const addSession = async (userId: string) => {
      const id = crypto.randomUUID();
      await env.db.insert(session).values({
        id,
        userId,
        token: `tok-${id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      return id;
    };
    const live = async (id: string) => (await env.db.select({ id: session.id }).from(session).where(eq(session.id, id))).length === 1;

    const tablet = await addSession(users.packer.id);
    const phone = await addSession(users.packer.id);
    const installId = `install-${crypto.randomUUID()}`;
    const { id } = await env.caller({ role: "packer", companyId, sessionId: tablet }).device.register({ installId, platform: "android" });
    expect((await env.db.select().from(device).where(eq(device.id, id)).get())!.authSessionId).toBe(tablet);

    await env.caller({ role: "owner", companyId }).device.revoke({ id });
    expect(await live(tablet)).toBe(false);
    // The packer's other device keeps its session.
    expect(await live(phone)).toBe(true);
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "device.revoke"), eq(auditLog.subjectId, id))).get();
    expect(audit!.meta).toMatchObject({ sessionEnded: true });

    // Signing in again on that tablet: the register is refused and ends that new session too.
    const again = await addSession(users.packer.id);
    await expect(
      env.caller({ role: "packer", companyId, sessionId: again }).device.register({ installId, platform: "android" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await live(again)).toBe(false);
    expect(await live(phone)).toBe(true);

    // Restore: it registers again and records the new session.
    await env.caller({ role: "owner", companyId }).device.restore({ id });
    const fresh = await addSession(users.packer.id);
    await env.caller({ role: "packer", companyId, sessionId: fresh }).device.register({ installId, platform: "android" });
    expect((await env.db.select().from(device).where(eq(device.id, id)).get())!.authSessionId).toBe(fresh);
  });

  test("register race: a racing insert of the same install returns the row that landed, created false", async () => {
    const { companyId } = await env.seedCompany();
    const installId = `install-${crypto.randomUUID()}`;
    let winner: { id: string; created: boolean } | null = null;
    env.beforeNextBatch(async () => {
      winner = await env.caller({ role: "admin", companyId }).device.register({ installId, platform: "web", label: "Office" });
    });
    const loser = await env.caller({ role: "packer", companyId }).device.register({ installId, platform: "android" });
    expect(winner).toMatchObject({ created: true });
    expect(loser).toEqual({ id: winner!.id, created: false });
    const rows = await env.db.select().from(device).where(and(eq(device.companyId, companyId), eq(device.installId, installId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(winner!.id);
  });

  test("another plant's device is Not found", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const { id } = await env.caller({ role: "packer", companyId: a.companyId }).device.register({
      installId: `install-${crypto.randomUUID()}`,
      platform: "web",
    });
    await expect(env.caller({ role: "admin", companyId: b.companyId }).device.revoke({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const live = await env.db.select().from(device).where(and(eq(device.id, id), isNull(device.revokedAt))).get();
    expect(live).toBeTruthy();
  });
});
