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

## 0. Deployment snapshot before continuation (2026-10-25)

| Ref | Sha | What it is |
|---|---|---|
| `origin/prod` | `c6cb44b3` | The owner's hotfix promote ("preview-safe owner sign-in links"). Migration **0009**. Production has never run any of the FP schema. |
| `origin/main` | `b276f9cd` | `wt/FP` after the hotfix merge (a fast-forward from `39e9d462`, 636 commits), pushed 2026-10-25 16:14 UTC. Migrations 0010 to **0035**. |
| `wt/FP` | `fbe18910` | The **candidate**: everything built (foundry, ageing, share link, explorer and owner-tour fixes, polish). Migrations to **0041**. Descends from `main` (`git merge-base --is-ancestor origin/main wt/FP` holds), so it goes to `main` as a fast-forward; `main` is not an ancestor of `redesign/c2` until section 2. Gates at that sha: types 11/11; server 3005/0; domain 358; i18n 64; web 1375/0; native 901 + types + expo android; build `/` 223.5 kB of 250; e2e A 317 (+10 skips), B 431, C 489, 0 failed; chain alone 37/37. |
| `redesign/c2` | `08a3ead7` + uncommitted work | The owner's concepts checkout in `orrn/`. `wt/FP` was branched from it. Nothing in the FP build touched that working tree. |

This table is historical, not the current promotion candidate. The continuation integrates FINAL-FIXES-4/5, docs, optional R2, the test sweep, transactional email handling and the cinematic homepage through migration **0042**. Current revision, checks and live deployment evidence are in `.fp-build/FINAL_REPORT.md` and `.fp-build/LEDGER.md`.

**Last failed dev deployment before continuation.** The push of `b276f9cd` started Deploy Dev (run 40210729245). Check-types passed and the `database`
resource **applied migrations 0010 to 0035 to the dev D1**; the next resource then failed:
`Failed to create R2 bucket "orrn-die-files-dev" (403 Forbidden): [10000] Authentication error`. The Cloudflare API token in
the `dev` GitHub environment has no R2 write permission (or the account has R2 off). Alchemy stopped there, so the Worker and
the web app were not deployed: **dev serves the old code (`39e9d462`) on a schema at 0035**. The old code keeps working on it
(the migrations only add; 0026 turns an old 4-key module list into "every module on"). Details: `.fp-build/reports/promotion-20261025-0917.md`.
Look at the latest Deploy Dev run before you act on this table; it is a snapshot.

**Storage enablement still needs the intended account:** enable R2 and give the token Workers R2 Storage: Edit.
The continuation can deploy **dev only without storage** by setting its explicit `ORRN_SKIP_R2` environment variable
(section 5). It does not suppress generic authentication errors, change billing, or enable storage.
Remove the override and redeploy once the approved subscription and token permissions are ready.

**Historical queued candidate** (`.fp-build/PROMOTE_QUEUE.md`): `fbe18910`, superseding `cf7f3b77`, added
**0036 to 0041**. The continuation also adds **0042_cast_legacy_code** (additive, unique per plant). Port 3001 belongs to an unrelated
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

### Migrations 0036 to 0042 (the continuation adds seven)

| File | Adds | Data step? |
|---|---|---|
| `0036_foundry` | furnace readings (`melt_reading`), melt alloy reason and correction link, billet length and diameter on outputs, spectro source and entry reason, cast tail reason | no (additive) |
| `0037_die_share` | `die_share` for the die share link | no |
| `0038_label_stale` | `bundle.sticker_stale`; the partial unique index `reason_code_live_label_unique` (company, kind, lower(trim(label)) among live rows) | **yes, see below** |
| `0039_ageing` | ovens, trolleys, recipes, batches, rows, temperature log, hardness | no |
| `0040_ageing_2` | `ageing_temp_log.device_id`, the feed unique widened by it (a looser key, so no existing row can violate it), four indexes | no |
| `0041_ageing_3` | `ageing_hardness.pass` nullable | **yes, see below** |
| `0042_cast_legacy_code` | Legacy paper cast codes, unique per plant | no (additive) |

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

1. Either enable R2 with the required token scope, or explicitly set the **dev** GitHub environment variable `ORRN_SKIP_R2=1` while storage is unavailable. A generic 403 authentication error is never silently treated as a missing subscription.
2. Push the verified integration SHA to `main` (below). The workflow passes that dev-only override to Alchemy and applies the pending migrations before updating the app.
3. Smoke dev (section 3). The owner-only list is `docs/OWNER_HANDOVER.md`.
4. Only then think about prod (sections 1 and 4).

## 1. Preconditions (owner)

1. The infra items in "Bindings that must exist" below are understood. Most are config in `alchemy.run.ts` that the deploy
   itself creates (the R2 buckets adopt-or-create, the cron). Secrets and variables already exist in the `dev` and
   `production` GitHub environments (`ALCHEMY_PASSWORD`, `ALCHEMY_STATE_TOKEN`, `BETTER_AUTH_SECRET`, `CLOUDFLARE_*`,
   `ORRN_MASTER_KEY`, `RESEND_API_KEY`, `WEBHOOK_BASE_URL`). `ORRN_MASTER_KEY` is also what signs die-file URLs and spectro
   upload tickets: a stage without it refuses those uploads (503), it never uses an empty secret.
2. Verify real email delivery before **production** promotion. Resend remains the deployed provider; its October 2026 failure is not
   repaired merely by adding the optional Cloudflare code path. Invite/reset/sign-in links depend on delivery; tenant
   invitations and Godseye retain copyable links when delivery fails. Dev may be evaluated with this limitation explicitly recorded.
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
git merge --no-ff "${GATED_SHA:?Set GATED_SHA to the immutable commit recorded in the current final report}" -m "merge: verified FP plant build into redesign/c2"

# If you stashed: bring the concepts work back.
git stash pop
```

- `routeTree.gen.ts` is generated: if the merge or `git stash pop` conflicts in it, take either side and regenerate it with
  `bun run --cwd apps/web build`, then `git add` it.
- `bun.lock` conflicts: take the main side, run `bun install`, commit the lockfile.
- Migrations must stay chained and consecutive. If the concepts work added a migration, renumber it after the current head
  (0042 for this continuation) and regenerate its snapshot (`bun run db:generate`); see `docs/LOCAL_DEV.md`.
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

`wt/FP` descends from `origin/main`, so main moves forward without a merge commit. Pushing it starts Deploy Dev.
Set `GATED_SHA` to the immutable commit recorded in the current `.fp-build/FINAL_REPORT.md`, not a branch name
or the historical candidate in section 0. The commands resolve it once and refuse a non-fast-forward:

```bash
cd /Users/abhalala/Documents/business/fc/wt/FP
git fetch origin main prod &&
GATED_SHA="$(git rev-parse --verify "${GATED_SHA:?Set GATED_SHA from the current verified final report}^{commit}")" &&
git merge-base --is-ancestor origin/main "$GATED_SHA" &&
git push origin "$GATED_SHA:main"
```

Watch Deploy Dev in GitHub Actions (check-types, then Alchemy). It applies pending migrations through **0042**
to dev D1 and attaches the cron `30 21 * * *`. With `ORRN_SKIP_R2=1`, it omits the storage resources/bindings;
otherwise it creates or adopts them. It then deploys the Worker and web app. If it fails, fix forward; do not
touch prod. A later green candidate uses the same procedure with its own immutable SHA and recorded gates.

Smoke test dev.orrn.app before prod (dev has no `/dev/seed`: it refuses without the local-only `ORRN_LOCAL_PASSWORD`):

1. Sign in as a plant owner (Godseye approval or an invite); `/today` loads and `/guides` lists the guides (44 slugs).
2. Create a customer and a die with a copy; book and confirm an order; plan and release; issue a die; open the press
   station; pack a bundle; start a dispatch from the order; complete it; open the packing list.
3. Godseye: modules, Backups and Settings > Devices. Storage-free dev must show storage off while retaining historical
   backup runs. On an enabled stage, a manual export writes `backups/{companyId}/{date}/...json` and an audit row.
4. On an enabled stage, upload a drawing (`DIE_FILES` and `ORRN_MASTER_KEY`), share it in a private window, then revoke it.
   Storage-free dev must explicitly refuse unavailable storage; do not claim an upload/restore smoke passed there.
5. Foundry: open a cast, save a melt draft, type spectro numbers with a reason, lock; close the cast on a billet count.
   Ageing: the Masters pages (oven, trolley, recipe), then a load, start and take-out. Neither needs a device.
6. The cron: after 21:30 UTC check the worker log for the backup run and the line `orphan die files purged`.

## 4. Promote main to prod (the owner's explicit go)

Only with the preconditions in section 1 met and the go written down.

```bash
cd /Users/abhalala/Documents/business/fc/wt/FP
git fetch origin main prod &&
GATED_SHA="$(git rev-parse --verify "${GATED_SHA:?Set GATED_SHA to the exact main commit smoked on dev}^{commit}")" &&
git merge-base --is-ancestor "$GATED_SHA" origin/main &&
PROMOTE_DIR="../PROMOTE-${GATED_SHA:0:12}" &&
git worktree add -b "promote/${GATED_SHA:0:12}" "$PROMOTE_DIR" origin/prod &&
git -C "$PROMOTE_DIR" merge --no-ff "$GATED_SHA" -m "chore: promote main to prod (verified FP plant build)" &&
git -C "$PROMOTE_DIR" diff --quiet "$GATED_SHA" HEAD &&
git -C "$PROMOTE_DIR" push origin HEAD:prod
```

The tree-identity guard deliberately stops if the prod merge differs from the dev-smoked candidate. Resolve and verify
those changes on dev before any production push; do not discard existing prod work or bypass the guard.
Never cut over prod from a task branch: the candidate must already be on `main`. `deploy-prod.yml` is skipped for any
ref other than `refs/heads/prod`. The deploy applies migrations 0010 through **0042** to production D1:

- 0026 rewrites the old Godseye default module list `[customers, dies, bundles, dispatches]` to `[]` (every module on) so no
  existing plant loses a screen.
- 0028 rebuilds `melt` and refuses to run if any `melt` row exists. Production has none (melts were never deployed).
- 0038 and 0041 are the two data steps in section 0; both are empty operations on a database that comes from 0009.
- Everything else is additive.

After the deploy: run the same smoke test on orrn.in with a real plant owner, then take one manual backup and run one restore
drill into a scratch plant (`docs/RESTORE_DRILL.md`). Real plant data (die copies, sections, legacy bundles, opening balances
for return streams) is the owner's import work, not part of this promotion: see `docs/OWNER_HANDOVER.md`.

### Automated production database gate

The production workflow now runs `packages/server/scripts/production-safety.ts` before Alchemy.
It resolves the database from the **currently deployed `api.orrn.in` Worker's `DB` binding**, reads its actual migration
history, captures a Time Travel bookmark and exports the database. The export and recovery metadata are archived,
encrypted with AES-256-GCM using a domain-separated key derived from the production `ORRN_MASTER_KEY`, and decrypted
again to verify the archive checksum before upload. Only `backup.enc` is uploaded as
`production-d1-before-<GitHub run id>` (30-day retention). This repository is public: never upload raw SQL, metadata,
command logs or a decrypted archive. Keep the historical production master key available for recovery.

The next step restores the export into **local D1 on the runner**, applies every pending SQL migration in order with
Alchemy-compatible history rows, and checks every pre-existing table count and foreign keys. Unknown migration names,
gaps, a nonempty melt before 0028, lost rows or invalid foreign keys stop the deployment before production writes.
The guards themselves are tested against a populated 0009 fixture, including preservation of legacy oblique notes,
stock weight and the old module-list upgrade. After Alchemy, read-only checks confirm all migrations are recorded,
protected production document counts did not decrease and foreign keys still pass. Live traffic may add documents.

For recovery, download the encrypted artifact into a private directory and obtain the **historical production master
key through the existing secure credential store**, then run:

```bash
bun packages/server/scripts/production-safety.ts decrypt backup.enc backup.tar.gz
# Extract only in a private directory: the archive contains production.sql, before.json and wrangler.json.
tar -xzf backup.tar.gz
```

`before.json` records the database id, pre-deploy revision and Time Travel bookmark. A real restore is a separate,
explicitly authorized operation against that database; do not replay SQL or run Time Travel blindly while live users
may have added newer work. GitHub removes temporary plaintext files even when a workflow step fails.

## 5. Bindings and settings that must exist

| What | Where | Notes |
|---|---|---|
| `DIE_FILES` R2 bucket (`die-files`; physical `orrn-die-files-{stage}`) | `alchemy.run.ts`, `adopt: true` | Die drawings, photos, trial sheets under `{companyId}/dies/{sectionId}/{fileId}`; the spectro inbox files under `{companyId}/spectro/{inboxId}`. Without the binding die file calls answer PRECONDITION_FAILED and the collector upload refuses. Reads are signed Worker URLs (10 minutes). |
| `BACKUPS` R2 bucket (`backups`; physical `orrn-backups-{stage}`) | `alchemy.run.ts`, `adopt: true, delete: false` | Daily per-company JSON export and restore-drill source. Private. Never set `empty: true`; never delete it from the dashboard casually. |
| Cron `30 21 * * *` UTC (03:00 IST) | `crons` on the `server` Worker | One backup per active plant per IST day, removal of drill scratch plants older than 7 days, the orphan die-file purge, collector frame retention (simulated 24 h, real 90 days). |
| Optional R2 lifecycle rule | Cloudflare dashboard | "Abort incomplete multipart uploads" after 1 day on `die-files` only; no "delete objects" rule on that bucket (`docs/R2_BUCKETS.md`, from the masters follow-ups). |
| `ORRN_MASTER_KEY` | GitHub environment secret | Signs die-file URLs, spectro upload tickets and wraps spool secrets. |
| `RESEND_API_KEY`, `WEBHOOK_BASE_URL` | GitHub environment | Invite, reset and sign-in emails; spool webhooks. |
| Optional `EMAIL` Email Sending binding | Not enabled by current Alchemy configuration | Runtime prefers it when present, otherwise uses `RESEND_API_KEY`. Missing providers fail explicitly; they never report a mock delivery. See prerequisites below. |
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

The dev workflow reads `vars.ORRN_SKIP_R2`. Set the variable in the GitHub **dev environment**, not production, for an explicitly storage-free dev deployment. Remove it after subscription and token permissions are ready. This override disables drawing storage and backups; it does not repair invalid Cloudflare credentials.

Without R2, die-file operations refuse the existing storage-not-set-up precondition (issued HTTP
links return 503); Settings Backups says storage is not switched on and keeps historical runs.
Manual backup/drill calls refuse `PRECONDITION_FAILED` without recording failed runs. The daily
cron skips backup and orphan-file cleanup but **still purges collector frames in D1**.

After the owner enables R2 on the intended account, remove `ORRN_SKIP_R2=1` if set and redeploy
the same stage to create/adopt and attach the buckets. Confirm Settings and an upload/backup;
enabling the subscription alone cannot add bindings to an already-deployed Worker.
See `docs/R2_BUCKETS.md`. No deploy or subscription change is authorized by this runbook.

Nothing else in the FP build needs a new Cloudflare resource: no queue, no extra database, no Durable Object.

### Transactional email readiness and handover

Auth reset/magic-link mail and tenant, Godseye and party-portal invitations share the sender in
`packages/auth/src/email-delivery.ts`. It calls the real structured Workers API:
`EMAIL.send({ from: { email: "no-reply@orrn.in", name: "ORRN" }, to, subject, html, text })`,
and uses its returned `messageId`. Installed `@cloudflare/workers-types` 4.20260518.1 supports this overload.
Without `EMAIL`, it uses the existing Resend endpoint and configured `RESEND_API_KEY`. A failed Cloudflare send is **not**
retried through Resend (delivery may already have been accepted); binding/network exceptions propagate, and Resend HTTP
failures retain their status without logging provider response bodies.

No provider is enabled or provisioned by this change. In particular, installed Alchemy 0.91.2 has neither a `send_email`
binding type nor a serializer branch in `src/cloudflare/{bindings,worker-metadata}.ts`. Adding an object cast or an
`EMAIL_ENABLED` variable would not wire a real binding. Alchemy and local Wrangler therefore intentionally contain no
`EMAIL` binding; there is no working deployment opt-in in this revision. Do not add Email Routing resources or manually
patch a deployed binding that a subsequent Alchemy deploy would remove.

Before a separately authorized Cloudflare cutover, the owner must:

1. Use the **correct ORRN Cloudflare account** and confirm Workers Paid plus Email Sending access. Account entitlement,
   domain readiness and arbitrary-recipient sending have not been verified; the local Cloudflare login is not the ORRN
   account. Do not treat a working Email Routing forward/verified destination as proof of transactional sending readiness.
2. Onboard `orrn.in` under **Compute > Email Service > Email Sending**, not Email Routing. Review the sending domain's
   `cf-bounce` MX/SPF, `cf-bounce._domainkey` DKIM and DMARC records; preserve existing inbound mail setup. Confirm the
   sender `no-reply@orrn.in` can send to arbitrary intended tenant recipients under the account's Sending entitlement.
3. Establish supported deployment-tool binding serialization in a separately reviewed change, without relying on a type
   assertion or automatically provisioning external services. Only then add a per-stage explicit opt-in, default off, and
   a real `send_email` binding named `EMAIL`. The official Wrangler declaration is
   `"send_email": [{ "name": "EMAIL" }]`; it is documentation here, not an active project setting. Reconcile binding
   restrictions with the account's Sending entitlement: the send-bindings reference still describes verified-destination
   restrictions, while the product/pricing pages distinguish Paid arbitrary-recipient sending.
4. Generate/check binding types for that deployment and, only with explicit owner approval, verify real delivery to an
   owner-controlled mailbox before enabling the binding for tenant invitations or resets. Local simulated message IDs do
   not prove delivery. No external email was sent during this recovery.

Until then keep `EMAIL` absent and configure a valid Resend key whose verified sending domain authorizes
`ORRN <no-reply@orrn.in>`. Configured providers are used even on development stages; leave both providers absent for
local tests that must not send email. A missing provider throws on every stack. Development may preview an unsent body
for local sign-in; production/test logs contain only domain/subject, never link bodies, addresses, API keys or provider
response bodies. Password-reset responses still remain neutral to avoid revealing account existence. Invitations remain
saved with copyable links; they only report `emailSent: true` after a provider accepts a message.

Parent verification (not run in the email lane):

```bash
bun run --cwd packages/server check-types
bun run --cwd apps/server check-types
cd packages/server
bun test test/email-delivery.test.ts test/email-log.test.ts test/auth-email-log.test.ts
bun test test/auth-password-reset.test.ts test/platform-w1-auth.test.ts
bun test test/final-explore-invite.test.ts test/godseye.test.ts
```

Also run the consolidated server/portal suite before promotion. Cloudflare account access, binding serialization,
Workers-runtime binding execution and inbox delivery remain unverified; mocked provider boundary tests cannot establish
any of those deployment prerequisites.

Official references retrieved for this implementation:
- [Email Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email Service: Paid arbitrary-recipient sending versus Email Routing](https://developers.cloudflare.com/email-service/)
- [Sending domain setup and DNS](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Send binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Plan requirements](https://developers.cloudflare.com/email-service/platform/pricing/)


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
