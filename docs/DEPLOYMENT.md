# ORRN deployment (Cloudflare + Alchemy)

ORRN runs on **Cloudflare Workers** (API) and **Workers static assets** (Vite web), with **D1** for SQLite. Infrastructure is defined in `packages/server/src/infra/alchemy.run.ts` and deployed with [Alchemy](https://alchemy.run).

## Domain layout (single web Worker + API)

The web app is a single Vite Worker (`packages/server/src/infra/alchemy.run.ts`) containing marketing, tenant ERP, and platform admin routes.


| Host          | Zone       | Worker   | Role                                    |
| ------------- | ---------- | -------- | --------------------------------------- |
| `orrn.in`     | `orrn.in`  | `web`    | Marketing, tenant ERP, staff console    |
| `api.orrn.in` | `orrn.in`  | `server` | API + Better Auth                       |


**Dev** (stage `dev`, zone `orrn.app`):


| Host               | Worker   | Role        |
| ------------------ | -------- | ----------- |
| `dev.orrn.app`     | `web`    | Unified web |
| `api.dev.orrn.app` | `server` | API         |

Deploy sets `VITE_PUBLIC_URL` on the web Worker. The server uses `WEB_PUBLIC_URL` for invite and magic-link URLs.

## Cloudflare prerequisites

1. Zone `**orrn.in`** for production, and `**orrn.app**` only if you deploy the dev stage to `dev.orrn.app`.
2. API token with at least:
  - Zone:DNS Edit
  - Zone:Workers Routes Edit (or account-level Workers Scripts + Routes)
  - Account:Cloudflare Workers Scripts Edit
  - Account:D1 Edit
3. Note each zone’s **Zone ID** (dashboard → zone → Overview → API section).

Alchemy `adopt: true` attaches custom domains to the deployed Worker / asset and creates proxied DNS records when missing.

## GitHub environments

### `dev` (existing)

Triggered on push to `main` via `.github/workflows/deploy-dev.yml`.


| Secret / var           | Value                            |
| ---------------------- | -------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token             |
| `CLOUDFLARE_ZONE_ID`   | Zone ID for `orrn.app`           |
| `ALCHEMY_PASSWORD`     | Alchemy encrypt password         |
| `ALCHEMY_STATE_TOKEN`  | Alchemy remote state token       |
| `BETTER_AUTH_SECRET`   | Auth signing secret (dev)        |
| `ORRN_MASTER_KEY`      | Base64 32-byte tenant crypto key |
| `RESEND_API_KEY`       | Optional email                   |
| `WEBHOOK_BASE_URL`     | Optional var                     |


Workflow sets `WEB_DOMAIN=dev.orrn.app`, `API_DOMAIN=api.dev.orrn.app`, etc.

### `production` (manual)

Triggered via **Actions → Deploy Production → Run workflow**.


| Secret / var                                                    | Value                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `CLOUDFLARE_ZONE_ID_IN`                                         | Zone ID for `orrn.in`                                    |
| Same auth/alchemy secrets as dev, **different values** for prod |                                                          |
| `WEBHOOK_BASE_URL`                                              | Public API base for webhooks, e.g. `https://api.orrn.in` |


Prod uses separate Alchemy stage `production` (isolated D1 + Worker names from `dev`).

## Local `.env` (packages/server/.env)

Put deploy secrets here (gitignored). Load order is fixed in `alchemy.run.ts` using paths relative to that folder, and deploy scripts use `bun --env-file=.env` so the Alchemy CLI sees variables before `alchemy-state-service` is contacted.

Required keys:

```bash
CLOUDFLARE_API_TOKEN=...      # API Token (not Global API Key unless you also set CLOUDFLARE_EMAIL)W
CLOUDFLARE_ACCOUNT_ID=...     # Account ID from Cloudflare dashboard
CLOUDFLARE_ZONE_ID_IN=...       # production only
CLOUDFLARE_ZONE_ID_APP=...      # production only
ALCHEMY_PASSWORD=...
ALCHEMY_STATE_TOKEN=...
BETTER_AUTH_SECRET=...
ORRN_MASTER_KEY=...
```

**Verify token before deploy** (from `packages/server`):

```bash
bun --env-file=.env -e "
const t = process.env.CLOUDFLARE_API_TOKEN;
const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
  headers: { Authorization: 'Bearer ' + t },
});
const j = await r.json();
console.log(r.status, j.success ? 'token OK' : j.errors);
"
```

Expect `200 token OK`. If you see `401 Invalid API Token`, check in order:

1. **No quotes** — wrong: `CLOUDFLARE_API_TOKEN="abc..."` or `'abc...'`. Right: `CLOUDFLARE_API_TOKEN=abc...` (dotenv includes the quote characters in the value).
2. No `Bearer`  prefix, no trailing spaces.
3. Value is an **API Token** from [API Tokens](https://dash.cloudflare.com/profile/api-tokens), not the Global API Key (that uses `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` instead).
4. Token not revoked; paste the full string shown once at creation.

The error `Failed to get worker settings for alchemy-state-service (403)` during `orrn/production` usually means the token failed Cloudflare auth or lacks **account-level** Workers Scripts **Edit** (not zone-only DNS).

## Manual deploy

```bash
# Dev (orrn.app zone)
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ZONE_ID=...          # orrn.app
export ALCHEMY_PASSWORD=...
export ALCHEMY_STATE_TOKEN=...
export BETTER_AUTH_SECRET=...
export ORRN_MASTER_KEY=...
bun run deploy:dev

# Production (both zones)
export CLOUDFLARE_ZONE_ID_IN=...       # orrn.in
export NODE_ENV=production
# ... same secrets as GHA production env
bun run deploy:prod
```

## DNS checklist (if not using Alchemy adopt)

For each custom hostname, point to the Worker route Alchemy prints after deploy (typically proxied CNAME to the `*.workers.dev` or custom hostname target Cloudflare assigns).

`**orrn.in` zone**

- `orrn.in` → web Worker
- `api` → server Worker

**Recommended**

- SSL/TLS: **Full (strict)**
- Always Use HTTPS: on
- `www.orrn.in` → redirect to `https://orrn.in` (Page Rule or Redirect Rule)

## Auth cookies & CORS

- API host: `api.orrn.in`
- Session cookies: `Domain=.orrn.in` (works for `api.orrn.in` and `orrn.in`)
- `CORS_ALLOWED_ORIGINS` should include only additional web origins when a stage needs them

Waitlist / magic-link invites use `WEB_PUBLIC_URL` (`https://orrn.in` in prod).

## Native app

Set `EXPO_PUBLIC_SERVER_URL=https://api.orrn.in` in EAS production env (or `.env.production`).

## D1 migration `0005_platform_staff_role`

Adds `platform_admin.role` and `created_by` for staff RBAC. Applied automatically on `alchemy deploy` via the `database` resource migrations dir.

If you applied SQL manually, record it in `d1_migrations` or deploy will fail with “duplicate column name: role”.

## Bootstrap first `super_admin`

Staff logins are **not** self-service. Grant `super_admin` to an **existing** Better Auth user:

```bash
cd packages/server
# After the user has signed up, e.g. on https://orrn.in/login
bun run bootstrap-super-admin --stage production you@company.com
# Dev:
bun run bootstrap-super-admin --stage dev you@company.com
```

Then sign in at `https://orrn.in/login` and open `/platform/staff` to create additional staff with roles (`admin`, `support`).

## Verify after deploy

```bash
curl -sI https://orrn.in | head -5
curl -sI https://api.orrn.in/trpc/auth.me | head -5
```

Sign in on `https://orrn.in/login`, confirm tenant users reach `/dashboard` and platform admins reach `/platform`.
