# Promoting the FP build: main, dev and prod

**These are the owner's commands. The build orchestrator and its agents never push, deploy or merge to `main` or `prod`**
(COMMON rule 1). The one exception is written down in decision D33 below: a peer session the owner named pushes green
`wt/FP` shas to `main`, which deploys **dev only**. Prod needs the owner's explicit go, every time. Paths are the Mac's: the
repo is `/Users/abhalala/Documents/business/fc/orrn`, the integration worktree is
`/Users/abhalala/Documents/business/fc/wt/FP` (branch `wt/FP`).

How deploys work (memory `orrn-c2-redesign-deploy`): a push to `main` runs `.github/workflows/deploy-dev.yml` (check-types,
then `bun run deploy:dev`, Alchemy to dev.orrn.app). A push to `prod` runs `deploy-prod.yml` (the same, stage `production`,
orrn.in). The convention for prod is a merge commit titled `chore: promote main to prod (...)`. GitHub Actions is the only
deploy route: there is no local `.env`. D1 migrations are applied by Alchemy during the deploy
(`migrationsDir: "../db/src/migrations"` in `packages/server/src/infra/alchemy.run.ts`), in file order, before the Worker is
updated.

## 0. Where things stand (2026-10-25, end of the FP build)

| Ref | Sha | What it is |
|---|---|---|
| `origin/prod` | `c6cb44b3` | The owner's hotfix promote ("preview-safe owner sign-in links"). Migration **0009**. Production has never run any of the FP schema. |
| `origin/main` | `b276f9cd` | `wt/FP` after the hotfix merge (a fast-forward from `39e9d462`, 636 commits), pushed 2026-10-25 16:14 UTC. Migrations 0010 to **0035**. |
| `wt/FP` | `fbe18910` | The **candidate**: everything built (foundry, ageing, share link, explorer and owner-tour fixes, polish). Migrations to **0041**. Descends from `main` (`git merge-base --is-ancestor origin/main wt/FP` holds), so it goes to `main` as a fast-forward; `main` is not an ancestor of `redesign/c2` until section 2. Gates at that sha: types 11/11; server 3005/0; domain 358; i18n 64; web 1375/0; native 901 + types + expo android; build `/` 223.5 kB of 250; e2e A 317 (+10 skips), B 431, C 489, 0 failed; chain alone 37/37. |
| `redesign/c2` | `08a3ead7` + uncommitted work | The owner's concepts checkout in `orrn/`. `wt/FP` was branched from it. Nothing in the FP build touched that working tree. |

**What dev is running.** The push of `b276f9cd` started Deploy Dev (run 40210729245). Check-types passed and the `database`
resource **applied migrations 0010 to 0035 to the dev D1**; the next resource then failed:
`Failed to create R2 bucket "orrn-die-files-dev" (403 Forbidden): [10000] Authentication error`. The Cloudflare API token in
the `dev` GitHub environment has no R2 write permission (or the account has R2 off). Alchemy stopped there, so the Worker and
the web app were not deployed: **dev serves the old code (`39e9d462`) on a schema at 0035**. The old code keeps working on it
(the migrations only add; 0026 turns an old 4-key module list into "every module on"). Details: `.fp-build/reports/promotion-20261025-0917.md`.
Look at the latest Deploy Dev run before you act on this table; it is a snapshot.

**Blocked on the owner:** enable R2 on the Cloudflare account and give the dev and production tokens "Workers R2 Storage: Edit"
(or create `orrn-die-files-dev` / `orrn-backups-dev` by hand; both are `adopt: true`, and the token still needs R2 rights to
bind them). Prod fails the same way until its token has the same right. `gh run rerun 40210729245`, or the next push, resumes
the deploy; migrations already applied are skipped.

**Queued for dev** (`.fp-build/PROMOTE_QUEUE.md`): `fbe18910`, which supersedes the earlier queued `cf7f3b77`. Migrations
**0036 to 0041** land with it (see "Migrations 0036 to 0041" below). Port 3001 on the Mac belongs to an unrelated
long-running app. Do not kill it.

### The dev-only rule (D33)

- After each green merge batch the orchestrator messages the peer session `PROMOTE <sha>` with gate counts and the highest
  migration; that session pushes the sha to `main` (fast-forward only). Dev redeploys; **prod is not touched**.
- Migrations are strictly additive from now on, and any step that changes existing data is flagged in the message so it can
  be held. There are two such steps today (below).
- The D33 directive reached the orchestrator through the peer session, not from the owner directly. If in doubt, the owner's
  own message wins.
- **Prod is an explicit go.** Nobody pushes `prod` until the owner says so in so many words. Never cut over prod from `wt/FP`
  or from a task branch; prod only ever receives `main`.

### Migrations 0036 to 0041 (the candidate adds six)

| File | Adds | Data step? |
|---|---|---|
| `0036_foundry` | furnace readings (`melt_reading`), melt alloy reason and correction link, billet length and diameter on outputs, spectro source and entry reason, cast tail reason | no (additive) |
| `0037_die_share` | `die_share` for the die share link | no |
| `0038_label_stale` | `bundle.sticker_stale`; the partial unique index `reason_code_live_label_unique` (company, kind, lower(trim(label)) among live rows) | **yes, see below** |
| `0039_ageing` | ovens, trolleys, recipes, batches, rows, temperature log, hardness | no |
| `0040_ageing_2` | `ageing_temp_log.device_id`, the feed unique widened by it (a looser key, so no existing row can violate it), four indexes | no |
| `0041_ageing_3` | `ageing_hardness.pass` nullable | **yes, see below** |

The chain is consecutive and the snapshots chain (`0036` b2c4af85, `0037` f39c4256, `0038` 42dfa4ff, `0039` e2b87a1f, `0040`
359c96a1, `0041` fb478748); `bun run db:generate` writes nothing.

**DATA STEP 1, 0038.** Before it builds the unique index it sets `active = 0` on every later duplicate **live** reason code
(same company, same kind, same lower-cased trimmed label; the oldest row stays live; the `other` row is exempt). A retired
reason keeps its history; screens only offer live ones. It is safe on dev and a no-op on a database without duplicates. Check
first on a real plant database:

```sql
SELECT company_id, kind, lower(trim(label)) AS label, count(*) AS n
FROM reason_code WHERE active = 1 AND code <> 'other'
GROUP BY company_id, kind, lower(trim(label)) HAVING count(*) > 1;
```

Production has no `reason_code` rows before the first FP deploy (the table arrives in 0023 and is filled on first read), so
there it cannot find any.

**DATA STEP 2, 0041.** It rebuilds `ageing_hardness` (`PRAGMA foreign_keys=OFF`, create the new table, copy every row, drop the
old, rename, `PRAGMA foreign_keys=ON`). On any database that gets 0039 and 0041 in one deploy, which is dev and prod, the table
is created empty by 0039, so nothing is copied. A database that ran 0039 earlier and holds hardness rows keeps them (the copy
lists every column). The same PRAGMA pattern is in `0028_fp_wave2` and applied cleanly to the dev D1 in the failed run above.

**Still true from before:** `0028` rebuilds `melt` and **refuses to run when any `melt` row exists** (NOT NULL failure on
`__w2_melt_guard`). Production has never had a melt; the dev D1 is already past it.

### What to do now, in order

1. Owner: fix the R2 permission (above). Optional: create the dev buckets by hand.
2. Re-run the failed Deploy Dev, or push `fbe18910` to `main` (below). Watch it apply 0036 to 0041.
3. Smoke dev (section 3). The owner-only list is `docs/OWNER_HANDOVER.md`.
4. Only then think about prod (sections 1 and 4).

## 1. Preconditions (owner)

1. R2 works on the account and the `dev` and `production` tokens can write it (section 0). The infra items in "Bindings that
   must exist" below are understood. Most are config in `alchemy.run.ts` that the deploy itself creates (the R2 buckets
   adopt-or-create, the cron). Secrets and variables already exist in the `dev` and `production` GitHub environments
   (`ALCHEMY_PASSWORD`, `ALCHEMY_STATE_TOKEN`, `BETTER_AUTH_SECRET`, `CLOUDFLARE_*`, `ORRN_MASTER_KEY`, `RESEND_API_KEY`,
   `WEBHOOK_BASE_URL`). `ORRN_MASTER_KEY` is also what signs die-file URLs and spectro upload tickets: a stage without it
   refuses those uploads (503), it never uses an empty secret.
2. Prod email works (Resend). It failed in Oct 2026 and invite and reset links depend on it; Godseye shows copyable sign-in
   details meanwhile (memory `orrn-prod-email-failing`).
3. Take a D1 backup of production before the first FP deploy (Cloudflare dashboard, D1, the production database, Time Travel
   shows the restore point; or `bunx wrangler d1 export <production database name> --remote --output prod-before-fp.sql`
   from `apps/server`; find the physical name in the dashboard). The FP migrations are additive apart from the two data steps
   in section 0, and there is no down migration. The wrangler login on the Mac that ran the dev promotion listed only an
   unrelated D1, so check `wrangler whoami` first.
4. Dev has been smoked (section 3) on the sha you are about to promote, and the data-step query in section 0 returned no rows
   or you accept what it will retire.
5. The prod go is yours: write it down (a message to the session that will push) with the sha.

## 2. Keeping redesign/c2 in step (optional, after the dev deploy)

`main` is now ahead of `redesign/c2` (it carries every FP commit; `wt/FP` was branched from `redesign/c2` @08a3ead7). The
promotion no longer goes through `redesign/c2`; this step only brings the owner's concepts checkout up to date so the two do
not drift. The `orrn/` working tree has uncommitted work (at the time of writing `.codex/config.toml`,
`apps/web/package.json`, `apps/web/src/routeTree.gen.ts`, `apps/web/tests/e2e/marketing.spec.ts`, `bun.lock` and new files).
Git refuses a merge that would overwrite it, and a merge must never run over uncommitted work.

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git status --short                       # read it; this is the concepts work

# Pick ONE: commit it, or stash it (untracked files included).
git add -A && git commit -m "wip(concepts): preserve before merging main"
#   or:
git stash push -u -m "concepts work before merging main"

git fetch origin
git switch redesign/c2                   # already on it
git merge --no-ff origin/main -m "merge: main (FP plant build) into redesign/c2"

# If you stashed: bring the concepts work back.
git stash pop
```

- `routeTree.gen.ts` is generated: if the merge or `git stash pop` conflicts in it, take either side and regenerate it with
  `bun run --cwd apps/web build`, then `git add` it.
- `bun.lock` conflicts: take the main side, run `bun install`, commit the lockfile.
- Migrations must stay chained and consecutive. If the concepts work added a migration, renumber it after the head (0041 or
  later) and regenerate its snapshot (`bun run db:generate`); see the numbering map in `docs/LOCAL_DEV.md`.
- Prove the merged tree before anything else is built on it (in `orrn/`, not in `wt/FP`):

```bash
bun install --frozen-lockfile
bun run check-types
bun run test:server:files                 # or: bun run --cwd packages/server test
bun run --cwd packages/domain test && bun run --cwd packages/i18n test
bun run --cwd apps/web test && bun run --cwd apps/web build
```

Use your own port pair for any e2e (`docs/LOCAL_DEV.md`), never 3001, and `unset CI` first.

## 3. main: the dev deploy (automatic, dev only)

`wt/FP` descends from `origin/main`, so main moves forward without a merge commit. Pushing it starts Deploy Dev. Use the
sha, not a branch name, so you push exactly what was gated:

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git fetch origin
git merge-base --is-ancestor origin/main fbe18910 && echo "fast-forward"   # must print it; otherwise stop
git push origin fbe18910:main             # starts "Deploy Dev" (dev.orrn.app); refuses if it is not a fast-forward
```

Watch the run in GitHub Actions (check-types, then Alchemy). It applies the migrations after the dev head (0036 to 0041 from
the 0035 that dev holds now) to the dev D1, creates or adopts `die-files` and `backups`, attaches the cron `30 21 * * *`, and
deploys the Worker and the web app. If it fails, fix forward; do not touch prod. A new green sha later is the same command
with that sha, after the orchestrator's `PROMOTE <sha>` message names its gates and highest migration.

Smoke test dev.orrn.app before prod (dev has no `/dev/seed`: it refuses without the local-only `ORRN_LOCAL_PASSWORD`):

1. Sign in as a plant owner (Godseye approval or an invite); `/today` loads and `/guides` lists the guides (44 slugs).
2. Create a customer and a die with a copy; book and confirm an order; plan and release; issue a die; open the press
   station; pack a bundle; start a dispatch from the order; complete it; open the packing list.
3. Godseye: the plant's modules (an old plant on the old 4-key list now reads every module on), Backups (one manual export
   writes `backups/{companyId}/{date}/...json` into the `BACKUPS` bucket and an audit row), Settings > Devices.
4. Upload a die drawing (needs `DIE_FILES` and `ORRN_MASTER_KEY`); make a share link for a section and open it in a private
   window (`/share/die/<token>`), then revoke it.
5. Foundry: open a cast, save a melt draft, type spectro numbers with a reason, lock; close the cast on a billet count.
   Ageing: the Masters pages (oven, trolley, recipe), then a load, start and take-out. Neither needs a device.
6. The cron: after 21:30 UTC check the worker log for the backup run and the line `orphan die files purged`.

## 4. Promote main to prod (the owner's explicit go)

Only with the preconditions in section 1 met and the go written down.

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git fetch origin
git switch prod
git pull --ff-only origin prod
git merge --no-ff <the main sha you smoked on dev> -m "chore: promote main to prod (FP plant build: die room, orders, press, foundry, ageing, pack, dispatch, portal, platform)"
git push origin prod                      # starts "Deploy Production" (orrn.in), environment: production
```

Never cut over prod from `wt/FP` or from a task branch; prod only ever receives `main`. `deploy-prod.yml` is skipped for any
ref other than `refs/heads/prod`. The deploy applies migrations 0010 to the head (0041) to the production D1:

- 0026 rewrites the old Godseye default module list `[customers, dies, bundles, dispatches]` to `[]` (every module on) so no
  existing plant loses a screen.
- 0028 rebuilds `melt` and refuses to run if any `melt` row exists. Production has none (melts were never deployed).
- 0038 and 0041 are the two data steps in section 0; both are empty operations on a database that comes from 0009.
- Everything else is additive.

After the deploy: run the same smoke test on orrn.in with a real plant owner, then take one manual backup and run one restore
drill into a scratch plant (`docs/RESTORE_DRILL.md`). Real plant data (die copies, sections, legacy bundles, opening balances
for return streams) is the owner's import work, not part of this promotion: see `docs/OWNER_HANDOVER.md`.

## 5. Bindings and settings that must exist

| What | Where | Notes |
|---|---|---|
| `DIE_FILES` R2 bucket (`die-files`; physical `orrn-die-files-{stage}`) | `alchemy.run.ts`, `adopt: true` | Die drawings, photos, trial sheets under `{companyId}/dies/{sectionId}/{fileId}`; the spectro inbox files under `{companyId}/spectro/{inboxId}`. Without the binding die file calls answer PRECONDITION_FAILED and the collector upload refuses. Reads are signed Worker URLs (10 minutes). |
| `BACKUPS` R2 bucket (`backups`; physical `orrn-backups-{stage}`) | `alchemy.run.ts`, `adopt: true, delete: false` | Daily per-company JSON export and restore-drill source. Private. Never set `empty: true`; never delete it from the dashboard casually. |
| Cron `30 21 * * *` UTC (03:00 IST) | `crons` on the `server` Worker | One backup per active plant per IST day, removal of drill scratch plants older than 7 days, the orphan die-file purge, collector frame retention (simulated 24 h, real 90 days). |
| Optional R2 lifecycle rule | Cloudflare dashboard | "Abort incomplete multipart uploads" after 1 day on `die-files` only; no "delete objects" rule on that bucket (`docs/R2_BUCKETS.md`, from the masters follow-ups). |
| `ORRN_MASTER_KEY` | GitHub environment secret | Signs die-file URLs, spectro upload tickets and wraps spool secrets. |
| `RESEND_API_KEY`, `WEBHOOK_BASE_URL` | GitHub environment | Invite, reset and sign-in emails; spool webhooks. |
| `SCALE_SIMULATOR` | local `.dev.vars` only | Never set on dev or production; the simulator refuses `NODE_ENV=production`. |
| `OVEN_SIMULATOR`, `OVEN_SIMULATOR_PROFILE` | `wrangler.local.jsonc` / local `.dev.vars` only | Ageing oven curve (W3-AG-C). Never set on dev or production; refused when `NODE_ENV=production`. |
| `FOUNDRY_SIMULATOR` | local `.dev.vars` only | Furnace curve for `foundry.readings.simulate`. Never set on dev or production. |

### R2 is optional during subscription setup

`optionalR2Bucket` skips each bucket on `ORRN_SKIP_R2=1` or a precise Cloudflare R2
not-enabled/not-subscribed response (HTTP 403, code `10042`, or a 10000-series code explicitly
naming the missing R2 subscription). Generic 403/auth, network and other provider failures still
fail deployment. Each skipped bucket logs its name and disabled feature; `DIE_FILES` / `BACKUPS`
are omitted, never bound to `undefined`. Skipping forgets the Alchemy resource state entry to avoid
orphan deletion on finalize; it does not delete remote buckets or data.

Without R2, die-file operations refuse the existing storage-not-set-up precondition (issued HTTP
links return 503); Settings Backups says storage is not switched on and keeps historical runs.
Manual backup/drill calls refuse `PRECONDITION_FAILED` without recording failed runs. The daily
cron skips backup and orphan-file cleanup but **still purges collector frames in D1**.

After the owner enables R2 on the intended account, remove `ORRN_SKIP_R2=1` if set and redeploy
the same stage to create/adopt and attach the buckets. Confirm Settings and an upload/backup;
enabling the subscription alone cannot add bindings to an already-deployed Worker.
See `docs/R2_BUCKETS.md`. No deploy or subscription change is authorized by this runbook.

Nothing else in the FP build needs a new Cloudflare resource: no queue, no extra database, no Durable Object.

## 6. Native: a new development build is required (POST-FINAL, owner decision O9)

Device bring-up comes after the web is complete and dev is deployed; no agent time goes into SDKs or device builds. What is
needed when it starts: the phone app gained native modules in the FP passes: `expo-application` (build number for the release
gate), `expo-crypto` (replay ids and the install id) and `expo-speech` (spoken refusals), on top of `expo-camera` and
`expo-haptics`. An over-the-air update cannot add them, and Expo Go does not carry them. Before the plant uses the phone app:

```bash
cd /Users/abhalala/Documents/business/fc/orrn/apps/native
bunx expo run:android            # development build on a connected Android device (JDK 17, Android SDK)
# production builds go through EAS: bunx eas build --platform android --profile production
```

Set `EXPO_PUBLIC_SERVER_URL` (the API) and `EXPO_PUBLIC_WEB_URL` in `apps/native/.env`. Publish the build in Godseye under App
builds (version, build number, minimum build, release notes) so the update gate lets it in; a build below the minimum is
blocked everywhere. Run the 10 Maestro flows (`.maestro/flows`, `apps/native/README.md`) on a real phone: none has ever been run.
The device-only checks (camera capture at 2.2 MP on the foundry phone, haptics, spoken refusals, a label printed from the phone)
are listed in `docs/OWNER_HANDOVER.md`.

## 7. Rollback

- Web and Worker: revert the promote merge on `prod` (`git revert -m 1 <merge sha>`) and push; GitHub Actions redeploys
  the previous code. The code revert does not undo migrations.
- Data: migrations are additive (the two data steps in section 0 only retire duplicate reason codes and copy a table), so the
  old code keeps working against the new schema except where it never knew a column. For a real data problem use D1 Time Travel
  to the restore point taken in step 1.3, or the daily `BACKUPS` export through the drill procedure. A reason code that 0038
  retired is brought back with `UPDATE reason_code SET active = 1 WHERE id = ...`, after renaming its twin (the unique index
  refuses two live rows with one label).
- A bad dev deploy: fix forward and push the next green sha to `main` again; prod is untouched until section 4.

## 8. Not part of this promotion

The Go spool (orrn-spool branches `fp/scale-reader` and `fp/collectors` are merged by the owner in that repo), real hardware
bring-up (scale indicator, press PLC, spectrometer, label printer, oven sensor), device builds (section 6), real data import,
opening balances for the foundry's return streams, the Gujarati review, the Postgres rebuild. The owner-only list with
pointers is `docs/OWNER_HANDOVER.md`; open build work is `TODO.md`.
