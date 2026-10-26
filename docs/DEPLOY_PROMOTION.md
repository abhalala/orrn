# Promoting the FP build: wt/FP to redesign/c2, main, dev and prod

**These are the owner's commands. Nothing in the FP build ran them and no agent may run them** (no `git push`, no
`alchemy deploy`, no merge to `main` or `prod`). They are written down so the promotion is a checklist, not a guess.
Paths are the Mac's: the repo is `/Users/abhalala/Documents/business/fc/orrn`, the integration worktree is
`/Users/abhalala/Documents/business/fc/wt/FP` (branch `wt/FP`).

How deploys work (memory `orrn-c2-redesign-deploy`): a push to `main` runs `.github/workflows/deploy-dev.yml` (check-types,
then `bun run deploy:dev`, Alchemy to dev.orrn.app). A push to `prod` runs `deploy-prod.yml` (the same, stage `production`,
orrn.in). The convention for prod is a merge commit titled `chore: promote main to prod (...)`. GitHub Actions is the only
deploy route: there is no local `.env`. D1 migrations are applied by Alchemy during the deploy
(`migrationsDir: "../db/src/migrations"` in `packages/server/src/infra/alchemy.run.ts`).

## 0. Where things stand when you start

- `main` and `prod` are at migration 0009 (the C2 theme and hotfixes); `redesign/c2` contains `main` and is where the
  owner's concepts work lives, uncommitted, in the `orrn/` working tree. `wt/FP` was branched from `redesign/c2` @08a3ead7
  and carries migrations 0010 to the head (0033 and later when the pending branches have merged). Production has never run
  any of the FP schema.
- Port 3001 on the Mac belongs to an unrelated long-running app. Do not kill it.
- Before promoting, the last merger's gates should be green on `wt/FP` (check-types, server, domain, documents, i18n, ui,
  web, native, build with the `/` budget, e2e groups A, B, C: see `docs/LOCAL_DEV.md`), and the chain e2e
  (`apps/web/tests/e2e/chain.spec.ts` when it has merged) should pass at 375, 820 and 1280.

## 1. Preconditions (owner)

1. The infra items in "Bindings that must exist" below are understood. Most are config in `alchemy.run.ts` that the deploy
   itself creates (the R2 buckets adopt-or-create, the cron). Secrets and variables already exist in the `dev` and
   `production` GitHub environments (`ALCHEMY_PASSWORD`, `ALCHEMY_STATE_TOKEN`, `BETTER_AUTH_SECRET`, `CLOUDFLARE_*`,
   `ORRN_MASTER_KEY`, `RESEND_API_KEY`, `WEBHOOK_BASE_URL`). `ORRN_MASTER_KEY` is also what signs die-file URLs and spectro
   upload tickets: a stage without it refuses those uploads (503), it never uses an empty secret.
2. Verify real email delivery before promotion. Resend remains the deployed provider; its October 2026 failure is not
   repaired merely by adding the optional Cloudflare code path. Invite/reset/sign-in links depend on delivery; tenant
   invitations and Godseye retain copyable links when delivery fails. See the email readiness section below.
3. Take a D1 backup of production before the first FP deploy (Cloudflare dashboard, D1, the production database, Time Travel
   shows the restore point; or `bunx wrangler d1 export <production database name> --remote --output prod-before-fp.sql`
   from `apps/server`; find the physical name in the dashboard). The FP migrations are additive and there is no down
   migration.

## 2. (a) Merge wt/FP into redesign/c2

The `orrn/` working tree is `redesign/c2` and has uncommitted changes (the concepts work: at the time of writing
`.codex/config.toml`, `apps/web/package.json`, `apps/web/src/routeTree.gen.ts`, `apps/web/tests/e2e/marketing.spec.ts`,
`bun.lock` and new files). Git will refuse a merge that would overwrite them, and a merge must never run over uncommitted work.

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git status --short                       # read it; this is the concepts work

# Pick ONE: commit it, or stash it (untracked files included).
git add -A && git commit -m "wip(concepts): preserve before the FP merge"
#   or:
git stash push -u -m "concepts work before FP merge"

git switch redesign/c2                   # already on it
git merge-base --is-ancestor redesign/c2 wt/FP && echo "fast-forward is possible"
git merge --no-ff wt/FP -m "merge: FP plant build (die room, orders, press, pack, dispatch, portal, platform) into redesign/c2"

# If you stashed: bring the concepts work back.
git stash pop
```

- `routeTree.gen.ts` is generated: if `git stash pop` or the merge conflicts in it, take either side and regenerate it with
  `bun run --cwd apps/web build` (the build regenerates the route tree), then `git add` it.
- `bun.lock` conflicts: take the FP side, run `bun install`, commit the lockfile.
- Migrations must stay chained and consecutive. If the concepts work added a migration, renumber it after the FP head and
  regenerate its snapshot (`bun run db:generate`); see the numbering map in `docs/LOCAL_DEV.md`.
- Then, in the merged tree (not in `wt/FP`), prove it:

```bash
cd /Users/abhalala/Documents/business/fc/orrn
bun install --frozen-lockfile
bun run check-types
bun run --cwd packages/server test        # or: bun run test:server:files
bun run --cwd packages/domain test && bun run --cwd packages/i18n test
bun run --cwd apps/web test && bun run --cwd apps/web build
```

Use your own port pair for any e2e (`docs/LOCAL_DEV.md`), never 3001.

## 3. (b) main: the dev deploy (automatic)

`main` is an ancestor of `redesign/c2`, so main moves forward without a merge commit. Pushing it starts Deploy Dev.

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git switch main
git pull --ff-only origin main
git merge --ff-only redesign/c2
git push origin main                      # starts "Deploy Dev" (dev.orrn.app)
```

Watch the run in GitHub Actions (check-types, then Alchemy). It applies migrations 0010 to the head to the dev D1, creates or
adopts `die-files` and `backups`, attaches the cron `30 21 * * *`, and deploys the Worker and the web app. If it fails, fix
forward on `redesign/c2`; do not touch prod.

Smoke test dev.orrn.app before prod (dev has no `/dev/seed`: it refuses without the local-only `ORRN_LOCAL_PASSWORD`):

1. Sign in as a plant owner (Godseye approval or an invite); `/today` loads and `/guides` lists the guides.
2. Create a customer and a die with a copy; book and confirm an order; plan and release; issue a die; open the press
   station; pack a bundle; start a dispatch from the order; complete it; open the packing list.
3. Godseye: the plant's modules (an old plant on the old 4-key list now reads every module on), Backups (one manual export
   writes `backups/{companyId}/{date}/...json` into the `BACKUPS` bucket and an audit row), Settings > Devices.
4. Upload a die drawing (needs `DIE_FILES` and `ORRN_MASTER_KEY`).
5. The cron: after 21:30 UTC check the worker log for the backup run and the line `orphan die files purged`.

## 4. (c) Promote main to prod

```bash
cd /Users/abhalala/Documents/business/fc/orrn
git switch prod
git pull --ff-only origin prod
git merge --no-ff main -m "chore: promote main to prod (FP plant build: die room, orders, press, pack, dispatch, portal, platform)"
git push origin prod                      # starts "Deploy Production" (orrn.in), environment: production
```

Never cut over prod from `wt/FP` or from a task branch; prod only ever receives `main`. `deploy-prod.yml` is skipped for any
ref other than `refs/heads/prod`. The deploy applies migrations 0010 to the head to the production D1:

- 0026 rewrites the old Godseye default module list `[customers, dies, bundles, dispatches]` to `[]` (every module on) so no
  existing plant loses a screen.
- 0028 rebuilds `melt` and refuses to run if any `melt` row exists. Production has none (melts were never deployed). A
  database with melts must be reset first, which only matters for local DBs.
- Everything else is additive.

After the deploy: run the same smoke test on orrn.in with a real plant owner, then take one manual backup and run one restore
drill into a scratch plant (`docs/RESTORE_DRILL.md`).

## 5. Bindings and settings that must exist

| What | Where | Notes |
|---|---|---|
| `DIE_FILES` R2 bucket (`die-files`) | `alchemy.run.ts`, `adopt: true` | Die drawings, photos, trial sheets under `{companyId}/dies/{sectionId}/{fileId}`; the spectro inbox files under `{companyId}/spectro/{inboxId}`. Without the binding die file calls answer PRECONDITION_FAILED and the collector upload refuses. Reads are signed Worker URLs (10 minutes). |
| `BACKUPS` R2 bucket (`backups`) | `alchemy.run.ts`, `adopt: true, delete: false` | Daily per-company JSON export and restore-drill source. Private. Never set `empty: true`; never delete it from the dashboard casually. |
| Cron `30 21 * * *` UTC (03:00 IST) | `crons` on the `server` Worker | One backup per active plant per IST day, removal of drill scratch plants older than 7 days, the orphan die-file purge, collector frame retention (simulated 24 h, real 90 days). |
| Optional R2 lifecycle rule | Cloudflare dashboard | "Abort incomplete multipart uploads" after 1 day on `die-files` only; no "delete objects" rule on that bucket (`docs/R2_BUCKETS.md`, from the masters follow-ups). |
| `ORRN_MASTER_KEY` | GitHub environment secret | Signs die-file URLs, spectro upload tickets and wraps spool secrets. |
| `RESEND_API_KEY`, `WEBHOOK_BASE_URL` | GitHub environment | Invite, reset and sign-in emails; spool webhooks. |
| Optional `EMAIL` Email Sending binding | Not enabled by current Alchemy configuration | Runtime prefers it when present, otherwise uses `RESEND_API_KEY`. Missing providers fail explicitly; they never report a mock delivery. See prerequisites below. |
| `SCALE_SIMULATOR` | local `.dev.vars` only | Never set on dev or production; the simulator refuses `NODE_ENV=production`. |
| `OVEN_SIMULATOR`, `OVEN_SIMULATOR_PROFILE` | local `.dev.vars` only | Ageing oven curve (W3-AG-C). Never set on dev or production; refused when `NODE_ENV=production`. |

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


## 6. Native: a new development build is required

The phone app gained native modules in the FP passes: `expo-application` (build number for the release gate),
`expo-crypto` (replay ids and the install id) and `expo-speech` (spoken refusals), on top of `expo-camera` and
`expo-haptics`. An over-the-air update cannot add them, and Expo Go does not carry them. Before the plant uses the phone app:

```bash
cd /Users/abhalala/Documents/business/fc/orrn/apps/native
bunx expo run:android            # development build on a connected Android device (JDK 17, Android SDK)
# production builds go through EAS: bunx eas build --platform android --profile production
```

Set `EXPO_PUBLIC_SERVER_URL` (the API) and `EXPO_PUBLIC_WEB_URL` in `apps/native/.env`. Publish the build in Godseye under App
builds (version, build number, minimum build, release notes) so the update gate lets it in; a build below the minimum is
blocked everywhere. Run the 9 Maestro flows (`apps/native/README.md`) on a real phone: none has ever been run.

## 7. Rollback

- Web and Worker: revert the promote merge on `prod` (`git revert -m 1 <merge sha>`) and push; GitHub Actions redeploys
  the previous code. The code revert does not undo migrations.
- Data: migrations are additive, so the old code keeps working against the new schema except where it never knew a column.
  For a real data problem use D1 Time Travel to the restore point taken in step 1.3, or the daily `BACKUPS` export through the
  drill procedure.
- A bad dev deploy: fix forward on `redesign/c2` and push `main` again; prod is untouched until step 4.

## 8. Not part of this promotion

Foundry screens and the ageing lane (paused, `TODO.md`), the Go spool (orrn-spool branches `fp/scale-reader` and
`fp/collectors` are merged by the owner in that repo), real hardware bring-up, real data import, the Postgres rebuild.
