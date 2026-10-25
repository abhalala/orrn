# Local development

Runs the API worker on a local D1 database (Wrangler/Miniflare). Nothing here touches Cloudflare.
Deploys still go through Alchemy (`packages/server/src/infra/alchemy.run.ts`).

Ports: API `3000`, web `3002`. Port `3001` is deliberately avoided because other local apps often use it.
Those are the single-checkout defaults; every git worktree runs its own pair (see Worktrees).

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
| Press runs on 2 presses (queued, die issued, running, logged x3, late entry, trial) and 4 plans | 14 |
| Packing sessions (`BG-000001` to `BG-000009`), 2 today; bundles, 12 ft (3658 mm) | 9; 129 |
| Bundle status | 73+1 available, 10 reserved, 42 dispatched, 3 void |
| Dispatches: 4 completed (6 packing lists: revisions, one combined), 1 building, 1 held | 6 |
| Stock count CNT-1 (closed, with a variance), print jobs waiting, scrap lots, store items, backup run | 1; 2; 10; 5; 1 |

Weights are stored in grams, lengths in mm. Bundle serials, company sequence, status events, party numbers
and packing list snapshots are created the same way the app creates them, so codes made later in the UI do
not collide. Everything that must read as "today" is placed inside the current production day (shift 1's
start to the next), whatever hour you seed.

The seed is idempotent: calling it again resets that demo company's dies, customers, bundles, orders,
dispatches, packing lists, press runs and counts and recreates them. Anything you added to the demo company
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

## Running the tests when the machine is busy (or on Linux)

- **Server tests, one process per file.** `bun run test:server:files` runs each `packages/server/test/*.test.ts` in its
  own `bun test` process and prints one PASS / FLAKY / FAIL line per file (a failing file is retried once alone;
  `RETRY=0` turns that off, `JOBS=2` runs two at a time, `bun run test:server:files -- plant-store press` filters by
  name, logs land in `$LOG_DIR`). Use it whenever `bun run --cwd packages/server test` shows a wall of timeouts: in one
  process a stuck Miniflare D1 file leaves a "poisoned stub" / ECONNRESET behind and every later file times out. The
  heavy files (plant-analytics, d1-limits, die-room-copy, plant-dies, plant-ledger, platform-w1-backup,
  plant-sales-gaps and the press, foundry and store files) set `setDefaultTimeout(30_000)` or more themselves.
- **Linux / ICU.** The web unit tests that assert date wording (`formatDay`, `formatInstantDay`, `instantDateText`,
  `companyClock`) are pinned: the code reads `Intl.DateTimeFormat#formatToParts` (day, month, year, hour, minute,
  weekday) and joins them itself, so "Sept" vs "Sep", "3 Oct at 14:00" vs "3 Oct, 14:00" and a comma after the weekday
  no longer depend on the ICU build. Write new date assertions the same way.
- **e2e in groups.** `bun run e2e:group A|B|C` (see `apps/web/tests/e2e/GROUPS.md`).
