# ORRN — Multi-Tenant Manufacturing ERP

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![Expo](https://img.shields.io/badge/Expo-000020?style=flat&logo=expo&logoColor=white)](https://expo.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-2596BE?style=flat&logo=trpc&logoColor=white)](https://trpc.io/)

**ORRN is a sellable multi-company ERP SaaS for manufactured inventory operations.** Built for extrusion plants and similar manufacturing workflows — managing dies, raw material bundles, stock, label printing, dispatches, and packing lists — with tenant-isolated data, web + native mobile access, and integrated LAN thermal printing.

- **Web:** [orrn.in](https://orrn.in)
- **Dev:** [dev.orrn.app](https://dev.orrn.app)
- **API:** `api.orrn.in`
- **Print Spool Companion:** [orrn-spool](https://github.com/abhalala/orrn-spool)

---

## What It Does

| Module | Description |
|--------|-------------|
| 🔧 **Die Management** | Track extrusion dies — specs, status, maintenance, lifecycle |
| 📦 **Bundle / Receipt Tracking** | Raw material inbound: bundles, receipts, weight, QC status |
| 📊 **Stock & Inventory** | Real-time stock levels, lot tracking, movement history |
| 🏷️ **Label Printing** | Generate and print labels on TSC thermal printers via LAN spool |
| 🚚 **Dispatch Management** | Outbound dispatches: pick, pack, ship, packing lists |
| 👥 **Customer Management** | Customer profiles, order history, per-customer pricing |
| 🔐 **Role-Based Access** | Owner, admin, manager, operator, viewer — per-company config |
| 📋 **Audit Trail** | All mutations logged with actor, timestamp, and impersonation context |

## Architecture

```
┌──────────────────────────────┐
│        Web (React)           │  ← Vite + TanStack Router + TanStack Query
│        Native (Expo)         │  ← iOS, iPadOS, Android
├──────────────────────────────┤
│      @orrn/ui (Tamagui)      │  ← Shared components, tokens, design system
├──────────────────────────────┤
│     tRPC API Layer            │  ← End-to-end type-safe APIs
├──────────────────────────────┤
│   Hono / Cloudflare Worker   │  ← Server runtime
├──────────────────────────────┤
│   D1 (SQLite) / Drizzle ORM  │  ← Database
├──────────────────────────────┤
│   orrn-spool (Go)            │  ← LAN thermal print spool (per-tenant)
└──────────────────────────────┘
```

**Tenant isolation:** Every operational row carries a `companyId`. Routes never accept tenant IDs from client input — the server derives them from the authenticated session. Platform admins can impersonate tenants via time-boxed, audited grants.

## Key Features

- **Multi-tenant by design** — one deployment serves many companies, data fully isolated
- **Cloudflare-native** — Workers + D1 edge database, global low-latency
- **Cross-platform** — web (desktop/mobile browser) + native iOS/iPadOS/Android via Expo
- **Thermal label printing** — integrates with [orrn-spool](https://github.com/abhalala/orrn-spool), a Go-based print spool deployed per tenant LAN (TSC printers, TSPL2 protocol, Gemini AI label design)
- **Role-based UI gating** — canonical permission matrix in `packages/server/src/lib/permissions.ts` powers both server middleware and client `<Can>` components. No ad-hoc client booleans.
- **Impersonation system** — platform admins can safely switch into tenant context with time-boxed grants, full audit logging, and a visible banner

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Monorepo** | Turborepo + Bun |
| **Web** | Vite + React + TanStack Router + TanStack Query |
| **Mobile** | Expo + React Native + expo-router |
| **Shared UI** | Tamagui (`@orrn/ui` — components, tokens, config for web + native) |
| **Server** | Hono + tRPC on Cloudflare Workers |
| **Auth** | Better Auth (email/password, Expo support) |
| **Database** | Cloudflare D1 / SQLite via Drizzle ORM |
| **Infrastructure** | Alchemy → Cloudflare Workers + D1 + custom domains |
| **Printing** | Per-tenant LAN `orrn-spool` deployment (HTTP API + signed webhooks) |

---

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Local UI Review

The current local review setup runs the Cloudflare Worker through Alchemy on
`http://localhost:3000` and the Vite web app on `http://localhost:3001`.
Alchemy must be configured locally first with `alchemy configure` or
`alchemy login`, or by exporting Cloudflare credentials.

Start both in one terminal:

```bash
bun run dev:local
```

Or start them separately:

```bash
bun run dev:server
bun run dev:web
```

Then open [http://localhost:3001](http://localhost:3001).

The checked-in local env files are already aligned for this setup:

- `apps/web/.env`: `VITE_SERVER_URL=http://localhost:3000`
- `apps/server/.env`: `BETTER_AUTH_URL=http://localhost:3000`, `CORS_ORIGIN=http://localhost:3001`
- `apps/native/.env`: `EXPO_PUBLIC_SERVER_URL=http://localhost:3000`

### Seed Demo Data

For a useful M0-M5 UI walkthrough, create a local account first from the web UI
using:

- Email: `owner@orrn.local`
- Password: any valid local password

Then seed the demo tenant and inventory data:

```bash
curl -X POST http://localhost:3000/dev/seed \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@orrn.local"}'
```

The dev seed route is only mounted when `NODE_ENV=development`. It attaches the
local user to an active demo company and creates customers, dies, receipt
bundles, stock, and draft/reserved/completed dispatches for UI review.

## Deployment (Cloudflare)

Infrastructure: **Alchemy** → Cloudflare Workers + D1 + custom domains. Full runbook: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Dev (`main` branch → GitHub `dev` environment)

- Unified web app: `https://dev.orrn.app`
- API / auth: `https://api.dev.orrn.app`

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` (zone `orrn.app`), `ALCHEMY_*`, `BETTER_AUTH_SECRET`, `ORRN_MASTER_KEY`. Optional: `RESEND_API_KEY`, `WEBHOOK_BASE_URL`.

### Production (manual workflow → GitHub `production` environment)

- Unified web app: `https://orrn.in`
- API / auth: `https://api.orrn.in`

Secrets: same as dev plus **`CLOUDFLARE_ZONE_ID_IN`** (`orrn.in`). Run **Actions → Deploy Production**.

```bash
bun run deploy:dev   # stage dev
bun run deploy:prod  # stage production
```

## Database Setup

This project uses SQLite with Drizzle ORM.

1. Start the local SQLite database (optional):
   D1 local development and migrations are handled automatically by Alchemy during dev and deploy.

2. Update your `.env` file in the `apps/server` directory with the appropriate connection details if needed.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

ORRN uses a shared Tamagui design system across web and native:

- **Brand tokens** — edit colors, spacing, typography, and status palettes in [`packages/ui/src/tokens.ts`](packages/ui/src/tokens.ts). Tamagui themes are wired in [`packages/ui/src/tamagui.config.ts`](packages/ui/src/tamagui.config.ts).
- **Shared components** — cross-platform primitives live in [`packages/ui/src/components/`](packages/ui/src/components/) (`Button`, `Card`, `DataTable`, `PageHeader`, `StatusBadge`, `Sidebar`, etc.).
- **Web app shell** — authenticated tenant routes render through [`apps/web/src/shared/components/app-shell.tsx`](apps/web/src/shared/components/app-shell.tsx); platform routes render through [`apps/web/src/shared/components/staff-shell.tsx`](apps/web/src/shared/components/staff-shell.tsx).
- **Tailwind bridge** — web utility classes mirror design tokens via [`packages/ui/src/styles/globals.css`](packages/ui/src/styles/globals.css).

Import shared components like this:

```tsx
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { StatusBadge } from "@orrn/ui/components/badge";
```

Role-aware UI uses the shared permissions matrix in `packages/server/src/lib/permissions.ts` with `<Can do="…">` on web and native.

## Deployment (Cloudflare via Alchemy)

- Target: web + server
- Dev: bun run dev
- Deploy: bun run deploy
- Destroy: bun run destroy

For more details, see the guide on [Deploying to Cloudflare with Alchemy](https://www.better-t-stack.dev/docs/guides/cloudflare-alchemy).

## Project Structure

```
orrn/
├── apps/
│   ├── web/          # Frontend application (React + TanStack Router)
│   ├── native/       # Mobile application (React Native, Expo)
│   └── server/       # Backend API (Hono, tRPC)
├── packages/
│   ├── ui/           # Shared Tamagui components, tokens, and config (@orrn/ui)
│   ├── server/       # tRPC API layer, routers, permissions, and Alchemy infra
│   ├── auth/         # Authentication configuration & logic
│   ├── db/           # Database schema & queries
│   ├── env/          # Validated server/web/native env access
│   ├── crypto/       # Tenant secret wrapping helpers
│   └── config/       # Shared TypeScript config
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run dev:local`: Start the local Worker and web UI for browser review
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run dev:native`: Start the React Native/Expo development server
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
