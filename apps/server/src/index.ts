import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@orrn/api/context";
import { appRouter } from "@orrn/api/routers/index";
import { createAuth } from "@orrn/auth";
import { isAllowedWebOrigin } from "@orrn/auth/origins";
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { seedDevData } from "./dev-seed";

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

if (env.NODE_ENV === "development") {
  app.post("/dev/seed", async (c) => {
    const body: { email?: string } = await c.req.json<{ email?: string }>().catch(() => ({}));
    const result = await seedDevData(createDb(), body.email ?? "owner@orrn.local");
    return c.json(result, result.status as 200 | 404);
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
