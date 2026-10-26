# R2 buckets

Config notes for the buckets in `packages/server/src/infra/alchemy.run.ts`. Nothing here is deployed by
this file; the settings below are applied by hand in the Cloudflare dashboard (or by the next deploy
from `main` for the cron).

| Bucket (binding) | What is in it | Public? | Cleanup |
|---|---|---|---|
| `die-files` (`DIE_FILES`) | Die drawings, photos, trial sheets under `{companyId}/dies/{sectionId}/{fileId}`; the spectro watcher's result files under `{companyId}/spectro/{inboxId}` | No. Read through a signed worker URL (10 minutes) | Orphan die-file purge below. Spectro files are kept (the inbox row points at them). |
| `backups` (`BACKUPS`) | Daily per-company JSON export, `backups/{companyId}/{YYYY-MM-DD}/{runId}.json` | No | None. Never set `empty: true`. See `docs/RESTORE_DRILL.md`. |

## Deploying before R2 is enabled

R2 is optional: `optionalR2Bucket` probes the account before creating either Alchemy resource. An
HTTP 403 with Cloudflare code `10042` (enable R2), or a 10000-series error explicitly saying R2
is not enabled/subscribed, skips both buckets. `ORRN_SKIP_R2=1` explicitly skips without an R2 API
call. Other authentication, permission, network and provider errors fail the deploy; a generic
403 is not evidence of a missing subscription.

Each skipped bucket produces a `[deploy] R2 bucket "…" not created: …` warning. Its Worker binding
is omitted entirely. Its Alchemy state entry is forgotten, not the remote bucket: existing objects
are not deleted. Do not use this flag as a bucket-deletion mechanism.

Without `BACKUPS`, Settings says backups are not switched on, retains any previous backup history,
and hides staff run/drill actions. Export and drill RPCs refuse `PRECONDITION_FAILED` before writing
a run. Without `DIE_FILES`, die-file upload, commit, removal and signed-link RPCs refuse the existing
storage-not-set-up precondition; previously issued HTTP upload/download links return 503. Public
die shares omit unavailable drawings. The daily cron logs the missing R2 steps as skipped, writes
no failed backup rows, and still performs collector-frame retention in D1.

To restore these features, the owner enables R2 on the intended Cloudflare account, removes
`ORRN_SKIP_R2=1` from the deployment environment, and redeploys the same stage. Both buckets are
created or adopted and rebound; no runtime code change or migration is required. Check Settings
and a real upload/backup after redeploy. This document does not authorize a deployment.

## Uncommitted die-file uploads (BACKLOG 18)

A die file goes up in three steps: `files.beginUpload` (a 10-minute signed ticket), a `PUT /files/dies/upload`
that streams the bytes into R2, and `files.commit` (checks the object, writes the `die_file` row). If the
person closes the tab or loses the connection after the PUT and before the commit, the object stays in
the bucket with no row. The commit accepts a ticket for 10 more minutes after it expires
(`DIE_FILE_COMMIT_GRACE_MS`), so nothing legitimate is more than 20 minutes old and uncommitted.

### What cleans it up

The worker's daily cron (`30 21 * * *` UTC, the same one as the backup) runs `purgeOrphanDieFiles`
(`packages/server/src/lib/dieFilesPurge.ts`, tests `packages/server/test/die-file-purge.test.ts`):

- It lists the `DIE_FILES` bucket (R2 `list`, 1000 per page, at most 40 pages a run).
- It looks only at keys of the exact die-file shape `{companyId}/dies/{sectionId}/{fileId}`, uploaded at
  least 24 hours ago. Spectro files and any other prefix are never touched.
- It deletes those that no `die_file.r2_key` row points at. Committed files, fresh uploads and files of
  another company's row are kept.
- The cron log line `orphan die files purged {"scanned":n,"deleted":n,"truncated":bool}` is the evidence.
  `truncated: true` means the bucket had more than 40,000 objects; at that size store a list cursor
  between runs (the plant keeps a few thousand die files, so this is not needed now).

### Why not a lifecycle rule alone

An R2 lifecycle rule works on object age and prefix only. It cannot tell a committed die file from an
orphan, so a rule that expires `dies/` objects would delete real drawings. Do not add a lifecycle rule
that expires the `{companyId}/dies/` prefix.

### Dashboard setting to add (config only, no deploy)

One safe lifecycle rule remains useful as a backstop for multipart uploads that never finished
(the PUT streams a single object, so this only matters if a client ever switches to multipart):

1. Cloudflare dashboard -> R2 -> `die-files` -> Settings -> Object lifecycle rules -> Add rule.
2. Name: `abort-incomplete-multipart`. Prefix: leave empty (whole bucket).
3. Action: "Abort incomplete multipart uploads" after 1 day.
4. Do not add a "delete objects" action to this bucket.

Record the date the rule was added in the ops log. Until it is added nothing breaks; the purge above is
the control that matters.

### Checking it by hand

Make an upload that is never committed (begin, PUT, close the tab), wait 24 hours, run the cron (or
wait for 03:00 IST) and look for the key in the bucket and for the `orphan die files purged` log line.
