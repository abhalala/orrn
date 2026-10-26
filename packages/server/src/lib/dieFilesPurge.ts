/**
 * Orphan die-file objects (BACKLOG 18). `files.beginUpload` hands out a 10-minute PUT ticket, the bytes
 * land in R2 under `{companyId}/dies/{sectionId}/{fileId}`, and `files.commit` writes the `die_file` row.
 * An upload that is begun and PUT but never committed (tab closed, phone dropped) leaves an object no row
 * points at. The daily cron (`apps/server` `scheduled`) deletes those once they are older than a day,
 * which is far past the ticket (10 min) and the commit grace (10 min), so a slow commit can never lose its file.
 *
 * Only keys of exactly the die-file shape are looked at; spectro files and anything else in the bucket
 * are left alone. The R2 `list` API is paged (<= 1000 per page); a run reads at most `maxPages` pages and
 * reports `truncated` when the bucket held more (the next day's run lists from the start again, so a
 * bucket that big needs a stored cursor; not needed at the plant's scale, thousands of files).
 * A bucket-level lifecycle rule could not do this: it cannot tell a committed object from an orphan.
 * Runbook: docs/R2_BUCKETS.md.
 */
import { dieFile } from "@orrn/db/schema/dies";
import { env } from "@orrn/env/server";
import { inArray } from "drizzle-orm";

import { chunk, IN_LIST_CHUNK, type OrrnDb } from "./atomic";

/** The part of an R2 bucket the purge uses (a fake implements it in tests). */
export type PurgeBucket = {
  list(options: { limit?: number; cursor?: string }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
};

/** An object younger than this is never touched (ticket 10 min + commit grace 10 min, with a wide margin). */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const ORPHAN_MAX_PAGES = 40;
const DIE_KEY = /^[^/]+\/dies\/[^/]+\/[^/]+$/;

export async function purgeOrphanDieFiles(
  db: OrrnDb,
  opts: { bucket?: PurgeBucket | null; nowMs?: number; maxPages?: number } = {},
): Promise<{ scanned: number; deleted: number; truncated: boolean }> {
  const bucket = opts.bucket === undefined ? ((env as unknown as { DIE_FILES?: PurgeBucket }).DIE_FILES ?? null) : opts.bucket;
  const out = { scanned: 0, deleted: 0, truncated: false };
  if (!bucket) return out;
  const nowMs = opts.nowMs ?? Date.now();
  const maxPages = opts.maxPages ?? ORPHAN_MAX_PAGES;
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    out.scanned += res.objects.length;
    const old = res.objects.filter((o) => DIE_KEY.test(o.key) && nowMs - o.uploaded.getTime() >= ORPHAN_MIN_AGE_MS).map((o) => o.key);
    const referenced = new Set<string>();
    for (const part of chunk(old, IN_LIST_CHUNK)) {
      const rows = await db.select({ key: dieFile.r2Key }).from(dieFile).where(inArray(dieFile.r2Key, part));
      for (const r of rows) referenced.add(r.key);
    }
    const orphans = old.filter((k) => !referenced.has(k));
    // R2 deletes up to 1000 keys per call.
    if (orphans.length > 0) {
      await bucket.delete(orphans);
      out.deleted += orphans.length;
    }
    if (!res.truncated || !res.cursor) return out;
    cursor = res.cursor;
  }
  out.truncated = true;
  return out;
}
