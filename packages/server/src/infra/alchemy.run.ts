import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import alchemy, { Resource, Scope } from "alchemy";
import { createCloudflareApi, D1Database, handleApiError, R2Bucket, Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

import { optionalR2Bucket } from "./optionalR2";

const infraDir = dirname(fileURLToPath(import.meta.url));

config({ path: join(infraDir, "../../.env") });
config({ path: join(infraDir, "../../../../apps/server/.env") });

const app = await alchemy("orrn", {
  stateStore: (scope: Scope) =>
    new CloudflareStateStore(scope, {
      forceUpdate: process.env.ALCHEMY_STATE_FORCE_UPDATE === "1",
    }),
});

const devMasterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const zoneName = "orrn.app";
const stage = process.env.ALCHEMY_STAGE ?? "production";
const isDevStage = stage === "dev";

const zoneIdApp = process.env.CLOUDFLARE_ZONE_ID_APP ?? process.env.CLOUDFLARE_ZONE_ID;
const zoneIdIn = process.env.CLOUDFLARE_ZONE_ID_IN;

type DomainBinding = { domainName: string; zoneId: string; adopt: true };

function requireZone(id: string | undefined, label: string): string {
  if (!id) {
    throw new Error(`${label} is required to deploy custom domains.`);
  }
  return id;
}

let webDomain: DomainBinding;
let webAliasDomains: DomainBinding[] = [];
let apiDomain: string;
let apiZoneId: string;
let corsOrigin: string;
let corsAllowedOrigins: string;
let webPublicUrl: string;
let cookieDomain: string;

if (isDevStage) {
  const appZone = requireZone(zoneIdApp, "CLOUDFLARE_ZONE_ID or CLOUDFLARE_ZONE_ID_APP");
  const webHost = process.env.WEB_DOMAIN ?? `dev.${zoneName}`;

  apiDomain = process.env.API_DOMAIN ?? `api.dev.${zoneName}`;
  apiZoneId = appZone;
  webDomain = { domainName: webHost, zoneId: appZone, adopt: true };

  webPublicUrl = process.env.VITE_PUBLIC_URL ?? `https://${webHost}`;
  corsOrigin = process.env.CORS_ORIGIN ?? webPublicUrl;
  corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? webPublicUrl;
  cookieDomain = `.${zoneName}`;
} else {
  const inZone = requireZone(zoneIdIn, "CLOUDFLARE_ZONE_ID_IN");

  apiDomain = process.env.API_DOMAIN ?? "api.orrn.in";
  apiZoneId = inZone;
  webDomain = { domainName: "orrn.in", zoneId: inZone, adopt: true };
  // www.orrn.in had no DNS record; serve it from the same Worker, which
  // redirects it to the apex host.
  webAliasDomains = [{ domainName: "www.orrn.in", zoneId: inZone, adopt: true }];

  webPublicUrl = "https://orrn.in";
  corsOrigin = webPublicUrl;
  corsAllowedOrigins = webPublicUrl;
  cookieDomain = ".orrn.in";
}

const apiUrl = `https://${apiDomain}`;
const viteServerUrl = isDevStage ? (process.env.VITE_SERVER_URL ?? apiUrl) : apiUrl;
const betterAuthUrl = isDevStage ? (process.env.BETTER_AUTH_URL ?? apiUrl) : apiUrl;

const webBindings = {
  VITE_SERVER_URL: viteServerUrl,
  VITE_PUBLIC_URL: webPublicUrl,
};

// Edge rules for the web Worker:
// 1. Plain-HTTP requests get a permanent redirect to HTTPS (browsers showed
//    "Not secure" for http://orrn.in because nothing upgraded the request).
// 2. "www." hosts redirect to the apex host.
// 3. Unknown HTML routes fall back to the SPA shell.
// 4. Every HTTPS response carries HSTS so browsers stop trying HTTP at all.
//    No includeSubDomains/preload: tenant and print-station hosts decide for
//    themselves.
const spaFallbackScript = `
const HSTS = "max-age=31536000";

function withHsts(response) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", HSTS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const redirectStatus = request.method === "GET" || request.method === "HEAD" ? 301 : 308;

    if (!isLocal && url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), redirectStatus);
    }
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), redirectStatus);
    }

    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === "GET") {
      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("text/html")) {
        response = await env.ASSETS.fetch(new Request(new URL("/", url), request));
      }
    }
    return isLocal ? response : withHsts(response);
  },
};
`;

const db = await D1Database("database", {
  migrationsDir: "../db/src/migrations",
});

/**
 * R2 is optional until the account has an R2 subscription (LEDGER D10/D36, infra/optionalR2.ts). Without
 * it (403 / 10042) or with ORRN_SKIP_R2=1 a bucket is skipped with a loud warning and its binding is left
 * off the Worker; die files and backups answer "not set up" and the cron skips them. Once R2 is enabled,
 * re-deploy: the buckets are created or adopted (`adopt: true`) and attach.
 */
let r2ProbeOnce: Promise<void> | undefined;
const r2Probe = () =>
  (r2ProbeOnce ??= (async () => {
    // `alchemy dev` makes Miniflare buckets and never calls Cloudflare.
    if (Scope.current.local) return;
    const api = await createCloudflareApi();
    const response = await api.get(`/accounts/${api.accountId}/r2/buckets?per_page=1`);
    if (!response.ok) await handleApiError(response, "list", "R2 buckets");
  })());
/** Drop a skipped bucket's alchemy state entry so finalize never treats it as an orphan to delete. */
const forgetR2State = (id: string) => async () => {
  const scope = Scope.current;
  if (await scope.state.get(id)) await scope.state.delete(id);
};

/** Die drawings, photos and trial sheets (FP-DR-09, LEDGER D10): uploaded by signed PUT, read by signed GET. */
const dieFiles = await optionalR2Bucket("die-files", {
  feature: "die files",
  probe: r2Probe,
  forget: forgetR2State("die-files"),
  create: () => R2Bucket("die-files", { adopt: true }),
});

/**
 * FP-PF-12: daily per-company exports and restore drills (lib/backup.ts). Private: no public
 * access, no custom domain; the plant never downloads it. Runbook: docs/RESTORE_DRILL.md.
 *
 * Delete protection: `delete: false` keeps the bucket and its objects if this resource is renamed,
 * removed from this file or the stage is destroyed (alchemy only drops it from state). Never set
 * `empty: true` here. Removing an old bucket is a manual step in the Cloudflare dashboard after
 * the backups in it have been copied. The bucket and the `30 21 * * *` cron are config only until
 * the next deploy from `main` (deploy-dev).
 */
const backups = await optionalR2Bucket("backups", {
  feature: "backups",
  probe: r2Probe,
  forget: forgetR2State("backups"),
  create: () => R2Bucket("backups", { adopt: true, delete: false }),
});


const LegacySpoolReleasesBucket = Resource(
  "internal::LegacySpoolReleasesState",
  async function legacySpoolReleasesBucket(id: string) {
    if (this.phase === "delete") {
      return this.destroy();
    }

    return (
      this.output ?? {
        name: this.scope.createPhysicalName(id),
        type: "r2_bucket",
        accountId: "",
        dev: { id: `${id}-legacy`, isDeployed: true },
      }
    );
  },
);

// Keep the historical spool-releases state entry inert. ORRN no longer serves
// spool binaries from R2, but remote Alchemy state still contains this legacy
// resource id and would otherwise try to delete the old bucket during deploy.
await LegacySpoolReleasesBucket("spool-releases", {});

/** Unified web app — orrn.in (prod) / dev.orrn.app (dev) */
export const web = await Vite("web", {
  cwd: "../../apps/web",
  // run_worker_first: static files would otherwise be served before the
  // Worker runs, skipping the HTTPS upgrade and HSTS below.
  assets: { directory: "dist", run_worker_first: true },
  adopt: true,
  bindings: webBindings,
  domains: [webDomain, ...webAliasDomains],
  script: spaFallbackScript,
  // Alchemy runs a bare `vite dev`, which binds web port 3002 (strict) or $E2E_WEB_PORT (docs/LOCAL_DEV.md).
  dev: { domain: "localhost:3002" },
});

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  adopt: true,
  // 21:30 UTC = 03:00 IST, after the night shift's last pack: one backup per active company.
  crons: ["30 21 * * *"],
  // EMAIL intentionally absent: installed Alchemy 0.91.2 cannot serialize send_email bindings.
  // Keep Resend configured until tooling and the account's Email Sending setup are ready.
  // See docs/DEPLOY_PROMOTION.md; never provision Email Routing as a substitute.
  bindings: {
    DB: db,
    // Absent bucket = no key at all (never an `undefined` binding).
    ...(dieFiles ? { DIE_FILES: dieFiles } : {}),
    ...(backups ? { BACKUPS: backups } : {}),
    NODE_ENV: isDevStage ? (process.env.NODE_ENV ?? "development") : "production",
    CORS_ORIGIN: corsOrigin,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    WEB_PUBLIC_URL: webPublicUrl,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: betterAuthUrl,
    ORRN_MASTER_KEY: process.env.ORRN_MASTER_KEY ?? devMasterKey,
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
    // Purelymail SMTP (system@orrn.in) is the primary outward sender when its
    // password is configured (production GitHub environment); Resend remains
    // the fallback for stages without it. See packages/auth/src/smtp.ts.
    PURELYMAIL_SMTP_PASSWORD: process.env.PURELYMAIL_SMTP_PASSWORD ?? "",
    WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL ?? "",
    COOKIE_DOMAIN: cookieDomain,
    CF_API_TOKEN: process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? "",
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    CF_ZONE_ID_IN: process.env.CF_ZONE_ID_IN ?? process.env.CLOUDFLARE_ZONE_ID_IN ?? process.env.CLOUDFLARE_ZONE_ID ?? "",
  },
  domains: [{ domainName: apiDomain, zoneId: apiZoneId, adopt: true }],
  dev: { port: 3000 },
});

console.log(`Stage     -> ${stage}`);
console.log(`Web       -> ${web.url}`);
console.log(`Server    -> ${server.url}`);

await app.finalize();
