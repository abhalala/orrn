import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@orrn/server/context";
import { appRouter } from "@orrn/server/routers/index";
import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { resolveCorsOrigin } from "@orrn/server/lib/corsOrigin";
import { canRunDevSeed } from "@orrn/server/lib/devSeedGate";
import { runScheduledBackups } from "@orrn/server/lib/backup";

import { seedDevData } from "./dev-seed";
import { spoolRoutes } from "./spool-routes";

const app = new Hono();
const auth = createAuth();

app.use(logger());

// Production only: upgrade plain-HTTP requests to HTTPS and send HSTS.
// Local dev runs on http://localhost and must keep working.
app.use("*", async (c, next) => {
  if (env.NODE_ENV !== "production") return next();
  const url = new URL(c.req.url);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return c.redirect(url.toString(), c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308);
  }
  await next();
  c.header("Strict-Transport-Security", "max-age=31536000");
});

app.use(
  "/*",
  cors({
    origin: (origin) => resolveCorsOrigin(env, origin),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-orrn-impersonate-company", "x-orrn-company"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Spool webhook and activation routes (non-tRPC)
app.route("/", spoolRoutes);

if (env.NODE_ENV === "development") {
  app.post("/dev/seed", async (c) => {
    // NODE_ENV=development is also bound on the deployed dev stage, so require the local-only
    // password binding and a loopback host. Anything else looks like the route does not exist.
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    try {
      const result = await seedDevData(createDb(), { password: env.ORRN_LOCAL_PASSWORD ?? "" });
      return c.json(result, result.status);
    } catch (error) {
      console.error("dev seed failed", error);
      return c.json(
        { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });
}

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

/** Cron (alchemy.run.ts `crons`): the daily per-company backup to R2 (FP-PF-12). */
async function scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
  ctx.waitUntil(
    runScheduledBackups(createDb(), new Date()).then(
      (results) => console.log("backups", JSON.stringify(results)),
      (error) => console.error("backups failed", error instanceof Error ? error.message : String(error)),
    ),
  );
}

export default { fetch: app.fetch, scheduled };
