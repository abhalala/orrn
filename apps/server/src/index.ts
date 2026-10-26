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
import { purgeCollectorFrames } from "@orrn/server/lib/pressCollector";
import { purgeOrphanDieFiles } from "@orrn/server/lib/dieFilesPurge";
import { dieFileSigningReady, handleDieFileUpload, verifyDieFileUrl } from "@orrn/server/lib/dieFiles";

import { createDevInvite, createDevMagicLink, devInviteInput, devMagicLinkInput } from "./dev-front-door";
import { devSpectroInput, runDevSpectro } from "./dev-spectro";
import { seedDevData } from "./dev-seed";
import { collectorRoutes } from "./collector-routes";
import { spoolRoutes } from "./spool-routes";

const app = new Hono<{ Bindings: Env }>();

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
    // PUT: the signed die-file upload (`/files/dies/upload`), straight from the browser.
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-orrn-impersonate-company", "x-orrn-company"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// Spool webhook and activation routes (non-tRPC)
app.route("/", spoolRoutes);
// Press collector frames and spectro watcher files from orrn-spool nodes (node-signed).
app.route("/", collectorRoutes);

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

  // Front-door e2e only (Task 17): an invite token and a magic link, which
  // otherwise leave the server only by email. Same gate as /dev/seed.
  app.post("/dev/invite", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    const input = devInviteInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, message: input.error.message }, 400);
    return c.json(await createDevInvite(createDb(), input.data));
  });

  // Collectors e2e (BACKLOG 97): add or remove a spectro inbox file of the demo plant.
  app.post("/dev/spectro-file", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    const input = devSpectroInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, message: input.error.message }, 400);
    return c.json(await runDevSpectro(createDb(), input.data));
  });

  app.post("/dev/magic-link", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    const input = devMagicLinkInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, message: input.error.message }, 400);
    return c.json(await createDevMagicLink(input.data));
  });
}

// Die files (FP-DR-07/13): a signed GET from `dieInstance.files.url` / `dieInstance.drawing`, valid
// 10 minutes, bound to one object key (which starts with the company id). No session needed.
app.get("/files/dies", async (c) => {
  const key = c.req.query("key") ?? "";
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";
  // No master key on this stage: never sign or verify with an empty secret.
  if (!dieFileSigningReady()) return c.text("File storage is not set up", 503);
  if (!(await verifyDieFileUrl(key, exp, sig))) return c.text("Link expired or not valid", 403);
  const bucket = (env as unknown as { DIE_FILES?: R2Bucket }).DIE_FILES;
  if (!bucket) return c.text("File storage is not set up", 503);
  const object = await bucket.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

// Die file upload (LEDGER D13): the signed PUT from `dieInstance.files.beginUpload`, valid 10
// minutes, bound to one object key and its declared size. The body streams into R2; the client then
// calls `dieInstance.files.commit`. No session needed: the signed ticket is the authority.
app.put("/files/dies/upload", (c) => handleDieFileUpload(c.req.raw));

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

/**
 * Cron (alchemy.run.ts `crons`): the daily per-company backup to R2 (FP-PF-12), then the press
 * collector frame retention purge (W4-COLLECTORS m-6: simulated 24 h, real 90 days), and the orphan die-file purge.
 */
async function scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
  ctx.waitUntil(
    runScheduledBackups(createDb(), new Date()).then(
      (results) => console.log("backups", JSON.stringify(results)),
      (error) => console.error("backups failed", error instanceof Error ? error.message : String(error)),
    ),
  );
  // BACKLOG 18: die-file uploads begun and PUT but never committed (docs/R2_BUCKETS.md).
  ctx.waitUntil(
    purgeOrphanDieFiles(createDb()).then(
      (purged) => console.log("orphan die files purged", JSON.stringify(purged)),
      (error) => console.error("orphan die file purge failed", error instanceof Error ? error.message : String(error)),
    ),
  );
  ctx.waitUntil(
    purgeCollectorFrames(createDb()).then(
      (purged) => console.log("collector frames purged", JSON.stringify(purged)),
      (error) => console.error("collector purge failed", error instanceof Error ? error.message : String(error)),
    ),
  );
}

export default { fetch: app.fetch, scheduled };
