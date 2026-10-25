import { atomicBatch, type createDb } from "@orrn/db";
import { appRelease, backupRun, supportRequest } from "@orrn/db/schema/platform";
import { device } from "@orrn/db/schema/sync";

type Db = ReturnType<typeof createDb>;

/**
 * FP-PF dev rows (idempotent: fixed ids, upserts): one published build per native platform (build
 * 12, minBuild 1: apps/native sets no versionCode / buildNumber, so a local build reports 1 and must
 * stay Open), the owner's pack tablet on the Devices tab, and one open support request for
 * Godseye's support inbox.
 */
export async function seedPlatformRows(
  db: Db,
  opts: { companyId: string; ownerId: string; operatorId: string; staffId: string; now: number },
) {
  const publishedAt = new Date(opts.now - 3 * 24 * 60 * 60 * 1000);
  const releases = [
    {
      id: "dev-release-android",
      platform: "android" as const,
      channel: "floor" as const,
      version: "1.2.0",
      buildNumber: 12,
      minBuild: 1,
      apkUrl: "https://example.invalid/orrn/floor/orrn-1.2.0-12.apk",
    },
    {
      id: "dev-release-ios",
      platform: "ios" as const,
      channel: "production" as const,
      version: "1.2.0",
      buildNumber: 12,
      minBuild: 1,
      apkUrl: null,
    },
  ];
  await atomicBatch(db, [
    ...releases.map((r) =>
      db
        .insert(appRelease)
        .values({
          id: r.id,
          platform: r.platform,
          channel: r.channel,
          version: r.version,
          buildNumber: r.buildNumber,
          minBuild: r.minBuild,
          mandatory: false,
          notes: "Pack weighs from the scale; Gujarati on the floor screens.",
          url: r.apkUrl,
          publishedAt,
          publishedBy: opts.staffId,
        })
        .onConflictDoUpdate({
          target: appRelease.id,
          set: { version: r.version, buildNumber: r.buildNumber, minBuild: r.minBuild, url: r.apkUrl, publishedAt },
        }),
    ),
    db
      .insert(device)
      .values({
        id: "dev-device-pack-tablet",
        companyId: opts.companyId,
        userId: opts.operatorId,
        platform: "android",
        osVersion: "14",
        appVersion: "1.2.0 (12)",
        installId: "dev-install-pack-tablet-1",
        label: "Pack tablet 1",
        lastSeenAt: new Date(opts.now - 15 * 60 * 1000),
      })
      .onConflictDoUpdate({
        target: device.id,
        set: { revokedAt: null, revokedBy: null, lastSeenAt: new Date(opts.now - 15 * 60 * 1000), label: "Pack tablet 1" },
      }),
    // The nightly export of two days ago succeeded (metadata only: never the bytes, no secrets).
    db
      .insert(backupRun)
      .values({
        id: "dev-backup-run-1",
        companyId: opts.companyId,
        kind: "scheduled",
        status: "succeeded",
        purpose: "export",
        r2Key: "backups/dev-company-orrn/dev-backup-run-1.json",
        bytes: 1_843_200,
        rowCount: 4_120,
        detail: { bundle: 130, dispatch: 6, sales_order: 10, press_run: 14 },
        startedAt: new Date(opts.now - 2 * 24 * 60 * 60 * 1000),
        finishedAt: new Date(opts.now - 2 * 24 * 60 * 60 * 1000 + 42_000),
        startedBy: opts.staffId,
      })
      .onConflictDoUpdate({
        target: backupRun.id,
        set: { status: "succeeded", error: null, startedAt: new Date(opts.now - 2 * 24 * 60 * 60 * 1000), finishedAt: new Date(opts.now - 2 * 24 * 60 * 60 * 1000 + 42_000) },
      }),
    db
      .insert(supportRequest)
      .values({
        id: "dev-support-1",
        companyId: opts.companyId,
        subject: "Label printer skips every second label",
        body: "Label printer skips every second label since this morning. Pack bay 2.",
        screen: "/printing",
        status: "open",
        createdBy: opts.ownerId,
      })
      .onConflictDoUpdate({
        target: supportRequest.id,
        set: { status: "open", reply: null, repliedAt: null, repliedBy: null },
      }),
  ]);
}
