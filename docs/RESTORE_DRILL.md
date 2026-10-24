# Restore drill (FP-PF-12)

Run this once a quarter for every live plant. It is the acceptance bar (report N11). The button is
there every day, so run it after any big import too. Rules come from
`docs/superpowers/specs/2026-10-24-orrn-fp-platform-design.md` §4 Backups and §6 Backup. Code:
`packages/server/src/lib/backup.ts`. Tests: `packages/server/test/platform-w1-backup.test.ts`.

## What exists

- **Daily export.** The worker cron (`30 21 * * *` UTC = 03:00 IST, `packages/server/src/infra/alchemy.run.ts`)
  writes one JSON object per active company to the private R2 bucket bound as `BACKUPS`, at
  `backups/{companyId}/{YYYY-MM-DD}/{runId}.json`. A company that already has a successful export
  that IST day is skipped.
- **What an export leaves out.** It never includes session, account, verification, two-factor,
  invite (token hashes), spool deployment (wrapped tunnel and shared secrets) or `backup_run` rows,
  and it drops any `*_wrapped`, `*_hash`, token, secret or password column, for example
  `company.spool_api_key_wrapped` and `device.push_token`. Settings, masters, documents, the
  ledger and the audit log are included.
- **`backup_run` rows.** Every export or drill writes one: `running`, then `succeeded` (shown as
  Ok) or `failed` with the reason in `error`. A failed export never touches an earlier object.
- **The plant's view.** Settings → Backup (`backup.status`, owner and admin) shows the last Ok
  export, a newer failed attempt if there is one, and the last drill. It never shows the R2 key
  or a download. A plant cannot download or restore its own backup.

## Quarterly procedure (platform staff: `super_admin` or `admin`)

1. **Check the export.** In Godseye → Backups (`platform.backup.list { companyId }`), confirm the
   newest `export` row is Ok and finished after yesterday's last shift. If it failed or is old,
   run one now with `platform.backup.run { companyId }` and check that it ends Ok.
2. **Run the drill.** `platform.backup.drill { companyId }`, or pass `sourceRunId` to restore a
   particular export. The drill:
   - reads that export from R2;
   - creates a new company named `restore-drill-{YYYY-MM-DD}`, status **suspended**, with the
     export's settings and modules (never the live company, and never a membership or an
     impersonation grant, so no real user gets a second plant);
   - re-issues every primary key, points every reference at the new ids and inserts the rows
     parent tables first;
   - counts `customer`, `die`, `bundle` and `dispatch` in the scratch company and compares them
     with the counts the export recorded when it ran.
3. **Read the result.** `status = ok` (DrillOk): the counts match and `detail` holds
   `{ expected, restored, scratchCompanyId, sourceRunId }`. `status = failed` (DrillFailed):
   `error` names the problem, for example `Counts differ: bundle`, `Restore of customer failed: …`,
   `No successful export to restore` or `The export object is missing from the bucket`.
   The audit log of the live plant has a `backup.drill` row either way.
4. **Leave the scratch company alone.** Keep it suspended. Do not point a spool at it, do not
   impersonate it in a demo, and do not reactivate it.
5. **Record it.** Note the date, the plant, the drill run id and Ok or Failed in the ops log. A
   failure is an incident: fix the cause and run the drill again the same week.

## Restoring for real

The drill proves an export can be restored. A real restore after data loss is the same code
path, run by an engineer with the owner on the call. Restore into a new company first, compare it
with the plant's paper records, then decide with the owner how to switch over. Never write into
the live company from a backup.

## Owner set-up (once)

- Deploy creates the private R2 bucket `backups` and binds it as `BACKUPS` (alchemy). Until it is
  bound, every export fails with "No backup bucket is bound (BACKUPS)" and the Backup card shows it.
- Locally, `apps/server/wrangler.local.jsonc` binds a local bucket `orrn-backups-local`.
