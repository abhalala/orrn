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
