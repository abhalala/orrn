/**
 * BACKLOG 18: orphan die-file objects. `begin upload -> PUT -> never commit` leaves an object in the
 * DIE_FILES bucket with no `die_file` row. The daily cron deletes those once they are a day old
 * (ticket 10 min + commit grace 10 min + a wide margin). It touches only `{company}/dies/{section}/{file}`
 * keys, never a committed file, a fresh upload, or another prefix (spectro files share the bucket).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { dieFile } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let lib: typeof import("../src/lib/dieFilesPurge");
beforeAll(async () => {
  env = await createTestEnv();
  lib = await import("../src/lib/dieFilesPurge");
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const NOW = Date.parse("2026-10-25T06:00:00.000Z");
const HOUR = 3_600_000;

/** An R2 stand-in with `list` (paged, with a cursor) and `delete`. */
function fakeBucket(objects: { key: string; uploaded: number }[], pageSize = 3) {
  const live = new Map(objects.map((o) => [o.key, o.uploaded]));
  const deleted: string[] = [];
  return {
    live,
    deleted,
    pages: 0,
    async list(opts: { prefix?: string; limit?: number; cursor?: string }) {
      this.pages += 1;
      // The cursor is the last key listed (stable while earlier keys are deleted, like R2's).
      const keys = [...live.keys()].filter((k) => k.startsWith(opts.prefix ?? "") && (!opts.cursor || k > opts.cursor)).sort();
      const slice = keys.slice(0, Math.min(opts.limit ?? 1000, pageSize));
      const more = slice.length < keys.length;
      return {
        objects: slice.map((key) => ({ key, uploaded: new Date(live.get(key)!) })),
        truncated: more,
        cursor: more ? slice.at(-1) : undefined,
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        live.delete(k);
        deleted.push(k);
      }
    },
  };
}

async function plantWithFile() {
  const { companyId } = await env.seedCompany();
  const sectionId = await env.seedDie(companyId, {});
  const committedKey = `${companyId}/dies/${sectionId}/${crypto.randomUUID()}`;
  await env.db.insert(dieFile).values({
    id: crypto.randomUUID(),
    companyId,
    sectionId,
    kind: "pdf",
    r2Key: committedKey,
    filename: "a.pdf",
    bytes: 10,
  });
  return { companyId, sectionId, committedKey };
}

describe("purgeOrphanDieFiles", () => {
  test("deletes an old object with no die_file row; keeps committed files, fresh uploads and other prefixes", async () => {
    const p = await plantWithFile();
    const orphan = `${p.companyId}/dies/${p.sectionId}/${crypto.randomUUID()}`;
    const fresh = `${p.companyId}/dies/${p.sectionId}/${crypto.randomUUID()}`;
    const spectro = `${p.companyId}/spectro/${crypto.randomUUID()}`;
    const odd = `${p.companyId}/dies/${crypto.randomUUID()}`; // not a die file key
    const bucket = fakeBucket([
      { key: p.committedKey, uploaded: NOW - 40 * 24 * HOUR },
      { key: orphan, uploaded: NOW - 30 * HOUR },
      { key: fresh, uploaded: NOW - 2 * HOUR },
      { key: spectro, uploaded: NOW - 90 * 24 * HOUR },
      { key: odd, uploaded: NOW - 90 * 24 * HOUR },
    ]);
    const out = await lib.purgeOrphanDieFiles(env.db, { bucket, nowMs: NOW });
    expect(bucket.deleted).toEqual([orphan]);
    expect([...bucket.live.keys()].sort()).toEqual([p.committedKey, fresh, spectro, odd].sort());
    expect(out).toMatchObject({ deleted: 1, truncated: false });
  });

  test("walks every page of the listing and checks rows in chunks (more keys than one IN list)", async () => {
    const p = await plantWithFile();
    const old = NOW - 3 * 24 * HOUR;
    const orphans = Array.from({ length: 200 }, () => `${p.companyId}/dies/${p.sectionId}/${crypto.randomUUID()}`);
    const bucket = fakeBucket(orphans.map((key) => ({ key, uploaded: old })), 100);
    const out = await lib.purgeOrphanDieFiles(env.db, { bucket, nowMs: NOW });
    expect(out.deleted).toBe(200);
    expect(bucket.pages).toBeGreaterThanOrEqual(2);
    expect(bucket.live.size).toBe(0);
  });

  test("a company's row protects only its own key; a listing cap stops the run and says so", async () => {
    const a = await plantWithFile();
    const b = await plantWithFile();
    const old = NOW - 3 * 24 * HOUR;
    // b's key under a's company prefix is not a's file.
    const foreign = `${a.companyId}/dies/${a.sectionId}/${b.committedKey.split("/").pop()}`;
    const bucket = fakeBucket([{ key: a.committedKey, uploaded: old }, { key: b.committedKey, uploaded: old }, { key: foreign, uploaded: old }]);
    const out = await lib.purgeOrphanDieFiles(env.db, { bucket, nowMs: NOW });
    expect(bucket.deleted).toEqual([foreign]);
    expect(out.deleted).toBe(1);
    const many = fakeBucket(Array.from({ length: 10 }, () => ({ key: `${a.companyId}/dies/${a.sectionId}/${crypto.randomUUID()}`, uploaded: old })), 2);
    const capped = await lib.purgeOrphanDieFiles(env.db, { bucket: many, nowMs: NOW, maxPages: 2 });
    expect(capped.truncated).toBe(true);
    expect(capped.scanned).toBe(4);
  });

  test("no bucket on this stage: nothing to do", async () => {
    expect(await lib.purgeOrphanDieFiles(env.db, { bucket: null, nowMs: NOW })).toEqual({ scanned: 0, deleted: 0, truncated: false });
  });
});
