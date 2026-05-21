# orrn

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **SQLite/Turso** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

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

## Dev Deployment

Pushes to `main` deploy the dev environment through GitHub Actions:

- Web: `https://dev.orrn.app`
- API/Auth: `https://api.dev.orrn.app`

Configure the GitHub `dev` environment with these secrets:

- `CLOUDFLARE_API_TOKEN`
- `ALCHEMY_PASSWORD`
- `ALCHEMY_STATE_TOKEN`
- `BETTER_AUTH_SECRET`
- `ORRN_MASTER_KEY`

Optional secrets/vars:

- `RESEND_API_KEY`
- `WEBHOOK_BASE_URL`

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

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@orrn/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

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
│   ├── web/         # Frontend application (React + TanStack Router)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
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
