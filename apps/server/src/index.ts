import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@orrn/server/context";
import { appRouter } from "@orrn/server/routers/index";
import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestLogger } from "@orrn/server/lib/requestLog";

import { resolveCorsOrigin } from "@orrn/server/lib/corsOrigin";
import { trpcCsrfRefusal } from "@orrn/server/lib/trpcCsrf";
import { canRunDevSeed } from "@orrn/server/lib/devSeedGate";
import { runDailyCron } from "@orrn/server/lib/dailyCron";
import { dieFileSigningReady, handleDieFileUpload, verifyDieFileUrl } from "@orrn/server/lib/dieFiles";
import { handleIngestRead, handleIngestUpload } from "@orrn/server/lib/ingest/vault";
import { handleIngestPart } from "@orrn/server/lib/ingest/upload-parts";
import { legacyCookieCleanup } from "@orrn/server/lib/legacyCookies";
import { masterKeyGate } from "@orrn/server/lib/masterKeyGate";
import { handleBuddyChat } from "@orrn/server/lib/buddy/chat";
import { handleMcpRequest } from "@orrn/server/lib/buddy/mcp";

import { clearDevInviteThrottle, createDevInvite, createDevMagicLink, devInviteInput, devMagicLinkInput, devResetTokenInput, readDevResetToken } from "./dev-front-door";
import { devIngestBotInput, runDevIngestBot } from "./dev-ingest-bot";
import { devSpectroInput, runDevSpectro } from "./dev-spectro";
import { seedDevData } from "./dev-seed";
import { collectorRoutes } from "./collector-routes";
import { spoolRoutes } from "./spool-routes";
import { edgeV1Routes } from "./edge-v1-routes";

const app = new Hono<{ Bindings: Env }>();

// Fail closed: production never serves with a missing or all-zero ORRN_MASTER_KEY (lib/masterKeyGate.ts).
app.use(masterKeyGate(() => env));
// Path only, never the query string: tRPC inputs, callbackURLs and magic-link tokens stay out of Workers Logs.
app.use(requestLogger());

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

// Old Domain=.orrn.in auth cookies: cleared and their sessions ended on the next request (lib/legacyCookies.ts).
app.use("*", legacyCookieCleanup({ legacyDomain: () => env.LEGACY_COOKIE_DOMAIN, db: () => createDb() }));

app.use(
  "/*",
  cors({
    origin: (origin) => resolveCorsOrigin(env, origin),
    // PUT: the signed die-file and import uploads (`/files/dies/upload`, `/files/ingest/upload`), straight from the browser.
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    // Range: "Read this file" reads a large PDF back in pieces (`/files/ingest/read`, 206).
    allowHeaders: ["Content-Type", "Authorization", "x-orrn-impersonate-company", "x-orrn-company", "Range"],
    exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// Spool webhook and activation routes (non-tRPC)
app.route("/", spoolRoutes);
// Press collector frames and spectro watcher files from orrn-spool nodes (node-signed).
app.route("/", collectorRoutes);
app.route("/", edgeV1Routes);

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

  // Infinity Portal e2e: a scripted shape client instead of the real model. Same gate as /dev/seed.
  app.post("/dev/ingest-bot", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    const input = devIngestBotInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, message: input.error.message }, 400);
    return c.json(runDevIngestBot(input.data));
  });

  // Invite onboarding e2e (plan 2026-11-18, Task 8): the token of the reset link an invitee was emailed.
  app.post("/dev/reset-token", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    const input = devResetTokenInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, message: input.error.message }, 400);
    return c.json(await readDevResetToken(createDb(), input.data));
  });

  // Invite e2e: every local request has one IP, so clear the invite throttle rows between tests.
  app.post("/dev/invite-throttle", async (c) => {
    if (!canRunDevSeed(env, c.req.url)) return c.notFound();
    return c.json(await clearDevInviteThrottle(createDb()));
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
// Infinity Portal vault upload (plan A2): the signed PUT from `ingest.artifact.begin` (raw bytes,
// checked against the SHA-256 in the ticket by R2) and from `ingest.artifact.complete` (canonical rows).
// No session: the signed ticket is the authority, bound to one object key and its size.
app.put("/files/ingest/upload", (c) => handleIngestUpload(c.req.raw));
// Vision read (contract section 8): the signed GET from `ingest.vision.readUrl`, valid 10 minutes, bound
// to one object key the server built from the caller's company. Purpose `ingest-read` only; an upload
// ticket is refused here and a read ticket is refused by the upload route. Raw files go out as an
// octet-stream attachment, page images as inline JPEG, both sandboxed.
app.get("/files/ingest/read", (c) => handleIngestRead(c.req.raw));
// Chunked raw upload (limits brief part B): one part of a file over 16 MiB, signed by `ingest.artifact.uploadTickets`
// (purpose `ingest-part` only, 10 minutes). The part's SHA-256 is checked as it streams into R2.
app.put("/files/ingest/part", (c) => handleIngestPart(c.req.raw));

// CSRF (fix round item 15): a tRPC POST must be JSON, and an Origin header, when sent, must be on the CORS allowlist.
// Runs after CORS, so a refused browser request still carries the CORS headers and the page can read the status.
app.use("/trpc/*", async (c, next) => {
  const refused = trpcCsrfRefusal(env, c.req.raw);
  if (refused) {
    c.header("x-content-type-options", "nosniff");
    return c.text(refused.message, refused.status);
  }
  await next();
});

// orrn buddy (design 2026-11-18, §4). The tool leg: Hermes calls orrn with a grant token (JSON-RPC 2.0,
// MCP streamable HTTP). The token is the authority; no cookie is read (lib/buddy/grantContext.ts).
app.on(["POST", "GET", "DELETE"], "/mcp", (c) => handleMcpRequest(c.req.raw, { db: createDb() }));
// The chat leg: the bubble's turn, proxied to Hermes as SSE (lib/buddy/chat.ts). 403/404 with no body.
app.post("/buddy/chat", async (c) => handleBuddyChat(c.req.raw, await createContext({ context: c })));

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
 * Cron (alchemy.run.ts `crons`): the daily per-company backup to R2 (FP-PF-12), the orphan die-file
 * purge (BACKLOG 18) and the press collector frame retention purge (W4-COLLECTORS m-6). Without the
 * BACKUPS / DIE_FILES binding (R2 not enabled) those two steps log "skipped" and do nothing
 * (lib/dailyCron.ts); the collector purge still runs.
 */
async function scheduled(controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
  // The hourly trigger (XE parity REG #82) only sends the plants' morning mails; the daily one keeps
  // backups and purges. Lazy import keeps the report code off the fetch path.
  if (controller.cron === HOURLY_CRON) {
    ctx.waitUntil(
      import("@orrn/server/lib/morningSummary").then(async ({ runMorningSummaries }) => {
        const { sendEmail } = await import("@orrn/server/lib/email");
        await runMorningSummaries(createDb(), new Date(), sendEmail);
      }),
    );
    return;
  }
  ctx.waitUntil(runDailyCron(createDb(), new Date()));
}

/** Must match the second entry of `crons` in packages/server/src/infra/alchemy.run.ts. */
const HOURLY_CRON = "5 * * * *";

const worker: ExportedHandler<Env> = { fetch: app.fetch, scheduled };
export default worker;
