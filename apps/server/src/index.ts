import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@orrn/server/context";
import { appRouter } from "@orrn/server/routers/index";
import { createAuth } from "@orrn/auth";
import { isAllowedWebOrigin } from "@orrn/auth/origins";
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { canRunDevSeed } from "@orrn/server/lib/devSeedGate";

import { seedDevData } from "./dev-seed";
import { spoolRoutes } from "./spool-routes";

const app = new Hono();
const auth = createAuth();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return env.CORS_ORIGIN;
      if (
        isAllowedWebOrigin(origin, {
          corsOrigin: env.CORS_ORIGIN,
          corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
        }) ||
        origin === "http://localhost:3001"
      ) {
        return origin;
      }
      return env.CORS_ORIGIN;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-orrn-impersonate-company"],
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

export default app;
