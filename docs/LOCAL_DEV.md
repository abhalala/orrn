# Local development

Runs the API worker on a local D1 database (Wrangler/Miniflare). Nothing here touches Cloudflare.
Deploys still go through Alchemy (`packages/server/src/infra/alchemy.run.ts`).

Ports: API `3000`, web `3002`. Port `3001` is deliberately avoided because other local apps often use it.
Those are the single-checkout defaults; every git worktree runs its own pair (see Worktrees).

Related: [DEMO_PLANT.md](DEMO_PLANT.md) (the seeded plant, logins and what to click), [RESTORE_DRILL.md](RESTORE_DRILL.md),
[DEPLOY_PROMOTION.md](DEPLOY_PROMOTION.md) (the owner's promotion commands; agents never run them), `AGENTS.md` (conventions).

## First run

```bash
bun install

# 1. Create/upgrade the local D1 (migrations come from packages/db/src/migrations)
bun run --cwd apps/server dev:local:migrate

# 2. API worker on http://localhost:3000 (config: apps/server/wrangler.local.jsonc)
bun run --cwd apps/server dev:local

# 3. Web on http://localhost:3002 (strict: fails instead of hopping to another port)
bun run --cwd apps/web dev:bare
```

The web app reads `apps/web/.env.development.local` (gitignored); copy `apps/web/.env.example` if it is
missing. Native uses `apps/native/.env.example` the same way.

## Worktrees: one port pair each

Up to ten worktrees can run dev servers and Playwright at once. Each gets its own ports from the environment:

| Variable | Drives | Default |
| --- | --- | --- |
| `E2E_API_PORT` (or `E2E_API_URL`) | `dev:local` API worker, e2e API URL | `3000` |
| `E2E_WEB_PORT` (or `E2E_BASE_URL`) | Vite dev server, e2e base URL | `3002` |
| `VISUAL_WEB_PORT` (or `PLAYWRIGHT_BASE_URL`) | Vite server of the public-page visual suite | web port + 100 whenever `E2E_WEB_PORT` or `E2E_BASE_URL` is set, else `3001` |
| `E2E_WORKERS` | Playwright workers per run (`--workers` still wins) | Playwright's default; `.wt-ports.env` sets `3` |

The `E2E_` prefix is historical: the same variables drive the plain dev servers. A worktree keeps them in
`.wt-ports.env` at its root (gitignored; the build orchestration writes it, by hand it is seven lines, one free
pair per worktree that no other worktree uses):

```bash
# <worktree>/.wt-ports.env
export E2E_API_PORT=3200
export E2E_WEB_PORT=3201
export E2E_API_URL=http://localhost:3200
export E2E_BASE_URL=http://localhost:3201
export VISUAL_WEB_PORT=3301
export E2E_WORKERS=3
export ORRN_WT_ROOT='/absolute/path/to/this/worktree'
```

Then:

```bash
cd ../wt/<TASK> && source .wt-ports.env      # once per shell
bun run --cwd apps/server dev:local:migrate  # per-worktree D1 in apps/server/.wrangler/state
bun run --cwd apps/server dev:local          # API on $E2E_API_PORT
bun run --cwd apps/web dev:bare              # web on $E2E_WEB_PORT
curl -XPOST localhost:$E2E_API_PORT/dev/seed
bun run --cwd apps/web test:e2e              # starts (or reuses) both on those ports, seeds, runs
```

Several worktrees running e2e at once need the lower worker count: with Playwright's default each run takes
about half the cores, and first-load pages then miss the 5 s expect timeout (blank page, no `h1`).
`dev:local` also starts wrangler with `--inspector-port 0`, because every worker otherwise tries to bind
9229 and the second one to start dies with "Address already in use".

The environment is the one place that says "my ports"; everything derived from it beats the files:

- `dev:local` passes `--port` and `--var` overrides to wrangler so auth base URL, CORS origin and the public web
  URL match the ports; `wrangler.local.jsonc` keeps the defaults.
- A bare `vite dev` (`dev:bare`, Alchemy dev) sets `VITE_SERVER_URL` / `VITE_PUBLIC_URL` from the ports when
  they are in the environment, beating `apps/web/.env.development.local` (which may name other ports, for
  example after you override the four `E2E_` variables). A `VITE_` value already in the environment wins.
  `vite dev --port <n>` by hand skips this: set the two `VITE_` values yourself (Playwright does).

In development the API accepts CORS and Better Auth origins from `http://localhost:<any port>` and
`http://127.0.0.1:<any port>` (production never does; `packages/server/test/authTrustedOrigins.test.ts`).

Node: a bare `vite dev` loads the port resolver (`@orrn/server/lib/devPorts`, TypeScript) through Node, so it
needs Node 22.18 or newer and says so otherwise. `vite build` (check-types, deploys) and the servers Playwright
starts (they pass `--port`) never load it and run on any Node that Vite supports.

Guard rail: in a worktree (a `.wt-ports.env` exists above the current directory) Vite, `dev:local` and
Playwright refuse to start without the ports in the environment, instead of silently using 3000/3002 and
attaching to another worktree's servers. They also refuse when `ORRN_WT_ROOT` names a different worktree (the
shell sourced someone else's `.wt-ports.env`, so the run would reuse that worktree's servers); open a new
shell or source your own file. A plain checkout is blocked only by a worktree's `ORRN_WT_ROOT`. The guard
cannot tell two worktrees apart that were given the same port pair: never share a pair. `vite preview` is
not the dev server and keeps Vite's own preview port. `bun run dev` (Alchemy dev) runs
the API on 3000 and a bare `vite dev` on 3002 (`dev.domain` in `alchemy.run.ts`) and is not for worktrees.
Browser cookies are per host, not per port, so signing in to two worktrees in the same browser profile makes
them overwrite each other's session; use separate profiles (Playwright contexts are isolated already).

## Port pairs: the convention

One worktree, one pair. The API port is even and the web port is the next odd number; the public-page visual suite is
the web port + 100 (`VISUAL_WEB_PORT`). Pick the lowest free pair at or above 3300, check it with
`lsof -nP -iTCP:<port> -sTCP:LISTEN` before using it, and write it in the worktree's `.wt-ports.env` (copy the template
above; `ORRN_WT_ROOT` is that worktree's absolute path, which is how the guard rail tells worktrees apart). Never
share a pair, never commit `.wt-ports.env` (it is gitignored), and never kill a process you did not start: port 3001 is
the owner's, and other worktrees keep their own dev servers (3208/3209, 3216-3221, 3280/3281, 33xx at the time of the
FP build). Examples from the FP build: `wt/FP` 3280/3281 (visual 3381), mergers 3300/3301, `wt/FINAL-DOCS-2` 3362/3363, test sweeps 3360/3361.
A pair that is busy means pick the next even/odd pair and say so in your report.

## Gates, per worktree

Run from the worktree root, after `source .wt-ports.env`:

| Gate | Command |
| --- | --- |
| types (web = vite build + tsc, regenerates the route tree) | `bun run check-types` |
| server (Miniflare D1, about 3,000 tests) | `bun run --cwd packages/server test` or the per-file runner below |
| domain, documents, i18n, ui | `bun run --cwd packages/domain test`, `... packages/documents test`, `... packages/i18n test`, `... packages/ui test` |
| web unit | `bun run --cwd apps/web test` |
| web build and the `/` route budget (250 kB gzip) | `bun run --cwd apps/web build` |
| native (no device) | `bun run --cwd apps/native test`, `bun run --cwd apps/native check-types` |
| e2e | `cd apps/web && bunx playwright test --project=e2e tests/e2e/<spec>.spec.ts` (below) |

**`CI` must be unset.** Playwright reads `process.env.CI`: with `CI=true` it stops reusing a dev server that is already up
(`reuseExistingServer` is false, so it tries to start a second pair on your ports and dies with "address already in use"),
runs one worker and retries every failure once, which hides flakes. In a shell where an agent harness or a CI step exported
it, run `unset CI` before any `playwright` or `bun run e2e:group` command (the unit and server gates do not read it).

Rules that come from sharing one machine (COMMON rules 12 to 15):

- Run e2e with `E2E_WORKERS=2`, never two heavy gates (server tests, build, e2e) at once in one worktree. A test that fails
  only under load (timeouts, a blank first load, `h1` missing) is rerun alone before it is called a failure; fix a real flake
  in the test (wait for the thing it measures), never by loosening the assertion.
- **Filter e2e with Playwright directly** (rule 13). `bun run --cwd apps/web test:e2e -- <spec>` does NOT filter: bun passes the
  argument oddly and the whole suite runs. Use `cd apps/web && bunx playwright test --project=e2e tests/e2e/<spec>.spec.ts`
  after sourcing the ports. A spec at one width: add `-g` with the title; the visual projects (`desktop-dark` ...) are a separate suite.
- **Server tests per file.** One `bun test` process runs about 100 Miniflare files back to back; on a loaded machine or on Linux a
  single stuck file leaves a poisoned stub and every later file times out. Run `bun run test:server:files` (one bun process per
  file, `JOBS=2` for two at a time, `RETRY=1` reruns a failed file once alone, a name filter such as
  `bun run test:server:files -- press-w2 plant-store`, logs per file) or one file by hand: `cd packages/server && bun test test/<name>.test.ts`
  (`--timeout 60000` for a slow one). The Miniflare files need no ports.
- **e2e groups A, B, C.** The full suite (1,237 tests in 45 spec files at the end of the FP build) is too long for one run on a shared machine, so the
  mergers ran it in three groups, one after another on one port pair, never together: `bun run e2e:group A` (then `B`, `C`;
  extra Playwright flags pass through: `bun run e2e:group B --retries=1`). Which spec is in which group, the pass counts of the
  last run and the known cross-group exception live in `apps/web/tests/e2e/GROUPS.md` and `apps/web/scripts/e2e-group.sh`
  (the groups are rebalanced by duration from time to time, so read the file, not a copy). A new spec is added to a group in
  both places; the script warns about a spec that is in none. Specs create what they change and assert only on their own
  rows, so a group runs in any order.
- **Disk and temp dirs (rules 14 and 15).** Before you finish in a worktree delete `apps/server/.wrangler/logs`,
  `apps/web/test-results`, `apps/web/playwright-report` and `apps/web/dist`; wrangler logs alone reached 11 GB in the FP build.
  Never sweep `/var/folders/*/T`, `/tmp` outside your own `/tmp/<lane>` paths or `~/Library/Caches`: live Miniflare and workerd
  processes of other worktrees hold handles there and start failing without a message. If the disk is short, clean your own
  worktree and tell the owner; the shared scratch is not yours to clear.
- **Linux / ICU.** The web unit tests that assert date wording (`formatDay`, `formatInstantDay`, `instantDateText`,
  `companyClock`) are pinned: the code reads `Intl.DateTimeFormat#formatToParts` (day, month, year, hour, minute,
  weekday) and joins them itself, so "Sept" vs "Sep", "3 Oct at 14:00" vs "3 Oct, 14:00" and a comma after the weekday
  no longer depend on the ICU build. Write new date assertions the same way.

## Seed realistic data

With the API running:

```bash
curl -XPOST localhost:3000/dev/seed      # in a worktree: localhost:$E2E_API_PORT
```

Only works against the local stack (see Test accounts). It creates one demo company,
"Fourcubes Extrusions (Demo)", configured for inch lengths, `Asia/Kolkata`, all modules on. The whole plant
is described in [DEMO_PLANT.md](DEMO_PLANT.md); in short:

| Data | Amount |
| --- | --- |
| Logins (one per plant role, plus platform staff and the KD portal party) | 13 + 2 |
| Sections (patti 14701, angle 11250, tee 13090, channel 12212, ...) with 34 copies and 6 heavier bands | 12 |
| Customers (KD Extrusion, Royal Aluminium, Tejura & Sons, ...) | 6 |
| Orders: booking, confirmed, late, portal, dispatching x2, closed, cancelled, KD's own die | 10 (17 lines) |
| Press runs on 2 presses (queued, die issued, running, logged x3, late entry, trial) and 6 plans | 14 |
| Packing sessions (`BG-000001` to `BG-000009`), 2 today; bundles, 12 ft (3658 mm) | 9; 129 |
| Bundle status | 73+1 available, 10 reserved, 42 dispatched, 3 void |
| Dispatches: 4 completed (6 packing lists: revisions, one combined), 1 building, 1 held | 6 |
| Stock count CNT-1 (closed, with a variance), print jobs waiting, scrap lots, store items, backup run | 1; 2; 10; 5; 1 |
| Foundry: casts (one complete and closed on a count, one paper-era, one open with a draft melt), melts, furnace, alloys | 3; 2; 1; 2 |
| Ageing: oven OV-1, trolleys T-1 and T-2, batches AG-1 (released on an approved override) and AG-2 (in the oven, simulator curve) | 1; 2; 2 |
| Approvals: 3 waiting (reallocate, tier lift, late entry) and 3 decided | 6 |

Weights are stored in grams, lengths in mm. Bundle serials, company sequence, status events, party numbers
and packing list snapshots are created the same way the app creates them, so codes made later in the UI do
not collide. Everything that must read as "today" is placed inside the current production day (shift 1's
start to the next), whatever hour you seed.

The seed is idempotent: calling it again resets that demo company's dies, customers, bundles, orders,
dispatches, packing lists, press runs, counts, casts and melts, ageing batches, store entries and purchase lots and recreates them. Anything you added to the demo company
in the UI is discarded. Existing logins are kept.

## Test accounts

Users are created through Better Auth (real password hashes). Fixed emails, one per role, all `{key}@orrn.local`:

| Login | Role |
| --- | --- |
| `owner`, `admin`, `manager`, `office`, `accountant` | the same roles in the plant |
| `supervisor`, `press`, `packer`, `operator`, `dieroom`, `storekeeper`, `foundry`, `viewer` | the floor and store roles (`dieroom` is `die_room`) |
| `staff` | ORRN staff (`super_admin`, Godseye), not a plant member |
| `party` | KD Extrusion's customer portal login, not a plant member |

The shared password is `vars.ORRN_LOCAL_PASSWORD` in `apps/server/wrangler.local.jsonc` (local only, never
deployed). `/dev/seed` refuses to run (404) unless that binding is set and the request host is
`localhost`, `127.0.0.1` or `[::1]`, because the deployed dev stage also runs with `NODE_ENV=development`.

Tests and scripts read the accounts from `apps/server/.dev.local-account.local` (gitignored). Write it with:

```bash
bun run --cwd apps/server scripts/write-local-accounts.ts
```

It contains `ORRN_LOCAL_EMAIL_{KEY}` for every login above (`OWNER`, `OPERATOR`, ..., `STAFF`, `PARTY`) and
`ORRN_LOCAL_PASSWORD`.

**A new worktree has no such file** (it is gitignored, so `git worktree add` does not bring it) and the e2e helper
`localPassword()` then throws "ENOENT ... .dev.local-account.local" in the first test that signs in. Either run the script
above in the new worktree (it only reads `wrangler.local.jsonc`; the API does not have to be up), copy the file from another
worktree (`cp ../FP/apps/server/.dev.local-account.local apps/server/`), or export `ORRN_LOCAL_PASSWORD=orrn-local-dev-only`
for the shell, which `localPassword()` reads first.

## Reset everything

```bash
# stop the API worker first
rm -rf apps/server/.wrangler/state
bun run --cwd apps/server dev:local:migrate
bun run --cwd apps/server dev:local
curl -XPOST localhost:${E2E_API_PORT:-3000}/dev/seed
```

## Dev accounts

One shared local password (`vars.ORRN_LOCAL_PASSWORD` in `apps/server/wrangler.local.jsonc`), one login per plant role, all
`{key}@orrn.local`, created by `POST /dev/seed` (`apps/server/src/dev-accounts.ts`). The plant they work in is the demo
company; what to click is in [DEMO_PLANT.md](DEMO_PLANT.md). Write the list for tests and scripts with
`bun run --cwd apps/server scripts/write-local-accounts.ts` (it writes `ORRN_LOCAL_EMAIL_{KEY}` for every login and the password
into the gitignored `apps/server/.dev.local-account.local`); the e2e helper `signInViaApi(page, role)` reads it.

| Login | Plant role | What it is for |
| --- | --- | --- |
| `owner` | owner | everything; the plant admin's account in practice (Q32) |
| `admin` | admin | everything but the owner-only company actions; team, settings, approvals |
| `manager` | manager | approvals (reallocate, tier, late entry, overdraw, ageing override), order planning, close, masters |
| `office` | office | orders, planning, dispatch, packing lists, D/C notes |
| `accountant` | accountant | prices on orders, purchase book, reports |
| `supervisor` | supervisor | press runs (log, queue), pack, dispatch, press approvals, releases or holds an aged batch, closes a cast |
| `press` | press | starts, stops and counts a run; cannot log it; loads trolleys and records ageing readings and hardness |
| `dieroom` | die_room | readings, die card, issue, maker, tier proposals |
| `packer` | packer | packs, scans, builds dispatches |
| `operator` | operator | floor operator: pack, scan, stock, dispatch; loads trolleys and records ageing readings |
| `storekeeper` | storekeeper | GRN and MRS in the store |
| `foundry` | foundry | opens casts, enters and locks melts, attaches spectro, cast close approval |
| `viewer` | viewer | read only; every write answers 403 |
| `staff` | none (ORRN `super_admin`) | Godseye: access requests, plants, releases, backups, support |
| `party` | none (portal login) | KD Extrusion's party login: its dies, orders, dispatches, certificates |

## Migrations: numbering map

Migrations are Drizzle SQL files in `packages/db/src/migrations` with a journal (`meta/_journal.json`) and one snapshot each;
`bun run db:generate` writes them (a clean run must write nothing). The head today is `0042_cast_legacy_code`: 43 files, `0000` to
`0042`, consecutive. A new migration is additive, takes the next consecutive number, its snapshot `prevId` must chain off the
previous snapshot and its journal `when` must stay above the previous one (the db tests check both). Never edit a shipped
migration. Lanes that carry a migration are renumbered consecutively at merge (decision D30) and their snapshot regenerated
on top of the new head; the SQL header of a renumbered file says what it was called before.

| Number | Name | What it adds |
| --- | --- | --- |
| 0000-0009 | foundation | auth, tenancy, bundles, dispatch, platform staff (what the first prod deploy held) |
| 0010-0019 | plant core | plant roles and approvals, locations and the stock ledger, die room, purchase, analytics indexes, store (GRN, MRS, cancel, draw source) |
| 0020 | foundry (PL5) | casts, melts, spectro results, return streams |
| 0021 | sales orders | orders, lines, baki |
| 0022 | stock count | counts, lines, phantom report |
| 0023 | fp wave 1 | dies, orders, press plan, die issue, devices |
| 0024 | edge scale presence | the spool node reports its scale |
| 0025-0026 | platform wave 1 | modules, shifts, releases, backups, support; modules default to all, device install index |
| 0027 | order hold | stock held for an order line |
| 0028 | fp wave 2 | press run children, plan purpose, furnace, alloy, spectro columns, `on_trial`; **rebuilds `melt` and refuses to run when any melt exists** (D18) |
| 0029-0030 | die trial, press fixes | trial pass and fail, D22 billet short |
| 0031 | dispatch from a sales order | `sales_order_id`, truck |
| 0032 | customer portal | parties, grants, certificates |
| 0033 | collectors | press frames, alerts, spectro inbox |
| 0034 | w4 masters | reason code Hindi and Gujarati labels, print job key, `auth_throttle` |
| 0035 | next rows | die work log (`die_work`) |
| 0036 | foundry | furnace readings, alloy reason, correction link, billet length, spectro source and reason, cast tail reason |
| 0037 | die share | `die_share` (hashed token, expiry, revoke, views) |
| 0038 | label stale | `bundle.sticker_stale`; **data step**: retires later duplicate live reason codes, then builds the partial unique index on the label |
| 0039 | ageing | ovens, trolleys, recipes, batches, rows, temperature log, hardness |
| 0040 | ageing 2 | telemetry device id, oven, trolley and rework indexes |
| 0041 | ageing 3 | `ageing_hardness.pass` nullable; **data step**: the table is rebuilt (`PRAGMA foreign_keys=OFF`, copy, drop, rename), empty on any database that never ran 0039 |
| 0042 | cast legacy code | `cast.legacy_code`, unique per plant; continue an imported paper cast alongside its series number |

The two data steps and the 0028 refusal are what [DEPLOY_PROMOTION.md](DEPLOY_PROMOTION.md) checks before a real database
gets them. If you need a number before a lane merges, take the next one after the highest merged and tell whoever is merging.

## Simulators

No hardware is needed for any flow; every device has a simulator and says so on screen. The server-side simulators are env
vars of the API worker: `wrangler.local.jsonc` sets `OVEN_SIMULATOR`; the others go in `apps/server/.dev.vars` (gitignored,
read by wrangler next to the config; restart `dev:local` after a change). All are refused when `NODE_ENV=production`, so the
deployed dev stage (which also runs with `NODE_ENV=development`) must not be given them either.

- **Scale (web pack).** `SCALE_SIMULATOR=1`: `scale.reading` answers a deterministic 14 s cycle with `simulated: true`.
  Tests: `packages/server/test/scale-reading.test.ts`.
- **Furnace (foundry).** `FOUNDRY_SIMULATOR=1` (or `true`): `foundry.readings.simulate` writes a furnace curve for a melt;
  without it the call answers FORBIDDEN "The furnace simulator is off". Typed readings (`readings.add`) work either way.
  The real furnace PLC is owner-only bring-up (Q46).
- **Ageing oven.** `OVEN_SIMULATOR=1` (set in `wrangler.local.jsonc`; optional `OVEN_SIMULATOR_PROFILE=normal|under|over|dip`):
  `ageing.batches.simulate` posts a deterministic oven curve for a batch (`lib/ageingSimulator.ts`, readings marked
  `simulator`). The seeded AG-2 batch in OV-1 already has one. Tests: `ageing-w3-contracts.test.ts`.
- **Spool simulators (Go, orrn-spool).** `go run ./cmd/spool --scale-sim` (also `SPOOL_SCALE_SIMULATE=true`) serves simulated
  frames; `--press-sim` (needs `press_collector.line`) sends an 8-minute die change, then billets of 78 s to
  `POST /collector/press/frames`; `--spectro-sim` writes `SIM-n.csv` into `spectro.sim_dir` and uploads it. The node needs
  `orrn.server_url`, `orrn.instance_id` and `orrn.shared_secret` (installed as `ORRN_SPOOL_*`) or it sends nothing. Docs:
  orrn-spool `docs/scale-and-orrn-auth.md`, `docs/press-collector.md`, `docs/spectro-watcher.md`, `docs/print-exactly-once.md`
  (branches `fp/scale-reader`, `fp/collectors`; not merged into orrn-spool `main` yet, an owner step).
- **Dev hooks (local only).** Same gate as `/dev/seed` (the local-password binding and a loopback host; 404 anywhere else):
  `POST /dev/spectro-file` adds or removes an `e2e-*` file in the demo plant's spectro inbox, so `/casts/inbox` has a file without
  the Go node (`collectors.spec.ts` removes what it adds, so the plant the owner opens holds only the simulator's file);
  `POST /dev/invite` and `POST /dev/magic-link` hand the front-door specs a token that otherwise travels by email.
- Simulated frames are kept 24 hours and real ones 90 days; a simulated spectro file can only be dismissed, never attached.

## Go toolchain (orrn-spool)

There is no Go on the Mac and the spool is not part of this repo. Its `go.mod` says `go 1.22`; the FP build used Go 1.24.9
unpacked into `/tmp` (`/tmp/fp-go124/go/bin/go`, with `GOPATH` and `GOCACHE` under `/tmp`), so nothing was installed:
download `go1.24.x.darwin-arm64.tar.gz`, unpack it in a scratch directory, put its `bin` on `PATH` for the shell, and in
the spool checkout run `go vet ./... && go build ./... && go test -race ./...`. For a real install use `brew install go`.

## Inspect the local database

```bash
cd apps/server
bunx wrangler d1 execute orrn-local --local -c wrangler.local.jsonc \
  --command "select status, count(*) from bundle group by status"
```

