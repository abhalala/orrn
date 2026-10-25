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
FP build). Examples from the FP build: `wt/FP` 3280/3281 (visual 3381), mergers 3300/3301, `wt/FINAL-DOCS` 3320/3321.
A pair that is busy means pick the next even/odd pair and say so in your report.

## Gates, per worktree

Run from the worktree root, after `source .wt-ports.env`:

| Gate | Command |
| --- | --- |
| types (web = vite build + tsc, regenerates the route tree) | `bun run check-types` |
| server (Miniflare D1, about 2,700 tests) | `bun run --cwd packages/server test` or the per-file runner below |
| domain, documents, i18n, ui | `bun run --cwd packages/domain test`, `... packages/documents test`, `... packages/i18n test`, `... packages/ui test` |
| web unit | `bun run --cwd apps/web test` |
| web build and the `/` route budget (250 kB gzip) | `bun run --cwd apps/web build` |
| native (no device) | `bun run --cwd apps/native test`, `bun run --cwd apps/native check-types` |
| e2e | `cd apps/web && bunx playwright test --project=e2e tests/e2e/<spec>.spec.ts` (below) |

Rules that come from sharing one machine (COMMON rules 12 and 13):

- Run e2e with `E2E_WORKERS=2`, never two heavy gates (server tests, build, e2e) at once in one worktree. A test that fails
  only under load (timeouts, a blank first load, `h1` missing) is rerun alone before it is called a failure; fix a real flake
  in the test (wait for the thing it measures), never by loosening the assertion.
- **Filter e2e with Playwright directly** (rule 13). `bun run --cwd apps/web test:e2e -- <spec>` does NOT filter: bun passes the
  argument oddly and the whole suite runs. Use `cd apps/web && bunx playwright test --project=e2e tests/e2e/<spec>.spec.ts`
  after sourcing the ports. A spec at one width: add `-g` with the title; the visual projects (`desktop-dark` ...) are a separate suite.
- **Server tests per file.** One `bun test` process runs about 100 Miniflare files back to back; on a loaded machine or on Linux a
  single stuck file leaves a poisoned stub and every later file times out. Run the files one by one, stopping at the first failure:
  `cd packages/server && for f in test/*.test.ts; do bun test "$f" --timeout 60000 || break; done`, or one file by hand
  (`bun test test/<name>.test.ts`). The Miniflare files need no ports. `wt/W4-TESTSWEEP` adds a runner for this
  (`bun run test:server:files`: one bun process per file, `JOBS=2`, `RETRY=1`, a name filter, per-file logs); it lands with MERGER-11.
- **e2e groups A, B, C.** The full suite (about 1,000 tests) is too long for one run on a shared machine, so the mergers ran it in
  three groups, alphabetical thirds of the spec files in `apps/web/tests/e2e`, one after another on one port pair, never together
  (about ten minutes each at `E2E_WORKERS=2`): `bunx playwright test --project=e2e <the group's spec files>` after sourcing the ports.
  Specs create what they change and assert only on their own rows, so a group runs in any order. `wt/W4-TESTSWEEP` adds
  `bun run e2e:group A|B|C` and the membership file `apps/web/tests/e2e/GROUPS.md`; it lands with MERGER-11.

## Seed realistic data

With the API running:

```bash
curl -XPOST localhost:3000/dev/seed      # in a worktree: localhost:$E2E_API_PORT
```

Only works against the local stack (see Test accounts). It creates one demo company,
"Fourcubes Extrusions (Demo)", configured for inch lengths, `Asia/Kolkata`, all modules on:

| Data | Amount |
| --- | --- |
| Dies (`Patti 1" × 1/8"` 14701, `Angle 1" × 1"` 11250, `Tee 1¼"` 13090, `Channel ¾"` 12212, …) | 12, with kg per 12 ft ranges |
| Customers (KD Extrusion, Royal Aluminium, Tejura & Sons, Shivam Bhavnagar, Apex Fabricators, Mehta Windows) | 6, with GSTIN and addresses |
| Packing sessions (bundle groups `BG-000001` to `BG-000008`), last 10 days, 2 today | 8 |
| Bundles, 12 ft (3658 mm), 40 to 60 kg, 18 to 24 pcs | 120 |
| Bundle status | 71 available, 10 reserved, 36 dispatched, 3 void |
| Dispatches | 1 draft (6 bundles), 1 held/reserved (10), 2 completed with packing lists (one today) |

Weights are stored in grams, lengths in mm. Bundle serials, company sequence, status events and packing list
snapshots are created the same way the app creates them, so codes made later in the UI do not collide.

The seed is idempotent: calling it again resets that demo company's dies, customers, bundles, dispatches and
packing lists and recreates them. Anything you added to the demo company in the UI is discarded. Existing
logins are kept.

## Test accounts

Users are created through Better Auth (real password hashes). Fixed emails:

| Role | Email |
| --- | --- |
| Owner | `owner@orrn.local` |
| Operator | `operator@orrn.local` |
| Viewer | `viewer@orrn.local` |
| ORRN staff (`super_admin`, Godseye) | `staff@orrn.local` |

The shared password is `vars.ORRN_LOCAL_PASSWORD` in `apps/server/wrangler.local.jsonc` (local only, never
deployed). `/dev/seed` refuses to run (404) unless that binding is set and the request host is
`localhost`, `127.0.0.1` or `[::1]`, because the deployed dev stage also runs with `NODE_ENV=development`.

Tests and scripts read the accounts from `apps/server/.dev.local-account.local` (gitignored). Write it with:

```bash
bun run --cwd apps/server scripts/write-local-accounts.ts
```

It contains `ORRN_LOCAL_EMAIL_OWNER`, `ORRN_LOCAL_EMAIL_OPERATOR`, `ORRN_LOCAL_EMAIL_VIEWER`,
`ORRN_LOCAL_EMAIL_STAFF` and `ORRN_LOCAL_PASSWORD`.

## Reset everything

```bash
# stop the API worker first
rm -rf apps/server/.wrangler/state
bun run --cwd apps/server dev:local:migrate
bun run --cwd apps/server dev:local
curl -XPOST localhost:${E2E_API_PORT:-3000}/dev/seed
```

Inspect the local database:

```bash
cd apps/server
bunx wrangler d1 execute orrn-local --local -c wrangler.local.jsonc \
  --command "select status, count(*) from bundle group by status"
```

## Dev accounts

> Pending merge: the full list below comes with `wt/W2-SEED` (MERGER-11). Until it is on this branch the seed creates only `owner`, `operator`, `viewer` and `staff`, and `docs/DEMO_PLANT.md` does not exist yet.

One shared local password (`vars.ORRN_LOCAL_PASSWORD` in `apps/server/wrangler.local.jsonc`), one login per plant role, all
`{key}@orrn.local`, created by `POST /dev/seed` (`apps/server/src/dev-accounts.ts`). The plant they work in is the demo
company; what to click is in [DEMO_PLANT.md](DEMO_PLANT.md). Write the list for tests and scripts with
`bun run --cwd apps/server scripts/write-local-accounts.ts` (it writes `ORRN_LOCAL_EMAIL_{KEY}` for every login and the password
into the gitignored `apps/server/.dev.local-account.local`); the e2e helper `signInViaApi(page, role)` reads it.

| Login | Plant role | What it is for |
| --- | --- | --- |
| `owner` | owner | everything; the plant admin's account in practice (Q32) |
| `admin` | admin | everything but the owner-only company actions; team, settings, approvals |
| `manager` | manager | approvals (reallocate, tier, late entry, overdraw), order planning, close, masters |
| `office` | office | orders, planning, dispatch, packing lists, D/C notes |
| `accountant` | accountant | prices on orders, purchase book, reports |
| `supervisor` | supervisor | press runs (log, queue), pack, dispatch, press approvals |
| `press` | press | starts, stops and counts a run; cannot log it |
| `dieroom` | die_room | readings, die card, issue, maker, tier proposals |
| `packer` | packer | packs, scans, builds dispatches |
| `operator` | operator | floor operator: pack, scan, stock, dispatch |
| `storekeeper` | storekeeper | GRN and MRS in the store |
| `foundry` | foundry | casts and melts, cast close approval |
| `viewer` | viewer | read only; every write answers 403 |
| `staff` | none (ORRN `super_admin`) | Godseye: access requests, plants, releases, backups, support |
| `party` | none (portal login) | KD Extrusion's party login: its dies, orders, dispatches, certificates |

## Migrations: numbering map

Migrations are Drizzle SQL files in `packages/db/src/migrations` with a journal (`meta/_journal.json`) and one snapshot each;
`bun run db:generate` writes them. A new migration is additive, takes the next consecutive number, and its snapshot `prevId`
must chain off the previous snapshot (the db tests check the chain). Never edit a shipped migration. Branches that carry a
migration are renumbered consecutively at merge (decision D30) and their snapshot regenerated on top of the new head.

| Number | Name | Lane |
| --- | --- | --- |
| 0000-0009 | foundation, tenancy, bundles, dispatch, platform (what `main` and prod hold today) | base |
| 0010-0019 | plant roles and approvals, locations and ledger, die room, purchase, analytics indexes, store | plant core |
| 0020 | foundry (PL5); 0028 rebuilds `melt` and refuses to run when any melt exists (D18) | foundry |
| 0021 | sales orders | orders |
| 0022 | stock count | stock |
| 0023 | fp wave 1 contracts (dies, orders, press plan, die issue, devices, portal tables deferred) | FP |
| 0024 | edge scale presence | spool |
| 0025 | platform wave 1 (modules, shifts, releases, backups, support) | platform |
| 0026 | modules default to all; device install index | platform |
| 0027 | order hold | orders |
| 0028 | fp wave 2 (press run children, plan purpose, furnace, alloy, spectro columns, `on_trial`) | press, foundry |
| 0029 | die trial | die room |
| 0030 | press fixes (D22 billet short) | press |
| 0031 | dispatch from a sales order, truck | dispatch |
| 0032 | customer portal | portal |
| 0033 | collectors (press frames, alerts, spectro inbox) | hardware |
| 0034 | w4 masters (reason code labels, print job key, auth throttle) | on `wt/W4-MASTERS`, renumbers at merge |
| 0035 | next rows (die work log) | on `wt/W4-NEXTROWS` (named `0038_next_rows` there), renumbers at merge |
| 0036-0037 | foundry on resume | paused lane |
| 0038-0039 | ageing on resume | paused lane |

If you need a number before then, take the next one after the highest merged and tell whoever is merging.

## Simulators

No hardware is needed for any flow; every device has a simulator and says so on screen.

- **Scale (web pack).** `SCALE_SIMULATOR=1` in `apps/server/.dev.vars` (gitignored; wrangler reads it next to
  `wrangler.local.jsonc`), then restart `dev:local`: `scale.reading` answers a deterministic 14 s cycle with `simulated: true`.
  It is refused when `NODE_ENV=production`. The tests: `packages/server/test/scale-reading.test.ts`.
- **Spool simulators (Go, orrn-spool).** `go run ./cmd/spool --scale-sim` (also `SPOOL_SCALE_SIMULATE=true`) serves simulated
  frames; `--press-sim` (needs `press_collector.line`) sends an 8-minute die change, then billets of 78 s to
  `POST /collector/press/frames`; `--spectro-sim` writes `SIM-n.csv` into `spectro.sim_dir` and uploads it. The node needs
  `orrn.server_url`, `orrn.instance_id` and `orrn.shared_secret` (installed as `ORRN_SPOOL_*`) or it sends nothing. Docs:
  orrn-spool `docs/scale-and-orrn-auth.md`, `docs/press-collector.md`, `docs/spectro-watcher.md`, `docs/print-exactly-once.md`
  (branches `fp/scale-reader`, `fp/collectors`).
- Simulated frames are kept 24 hours and real ones 90 days; a simulated spectro file can only be dismissed, never attached.

## Go toolchain (orrn-spool)

There is no Go on the Mac and the spool is not part of this repo. Its `go.mod` says `go 1.22`; the FP build used Go 1.24.9
unpacked into `/tmp` (`/tmp/fp-go124/go/bin/go`, with `GOPATH` and `GOCACHE` under `/tmp`), so nothing was installed:
download `go1.24.x.darwin-arm64.tar.gz`, unpack it in a scratch directory, put its `bin` on `PATH` for the shell, and in
the spool checkout run `go vet ./... && go build ./... && go test -race ./...`. For a real install use `brew install go`.
