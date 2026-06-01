import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import alchemy, { Resource } from "alchemy";
import { D1Database, Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import type { Scope } from "alchemy";
import { config } from "dotenv";

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

const spaFallbackScript = `
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== "GET") {
      return response;
    }

    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("text/html")) {
      return response;
    }

    const url = new URL(request.url);
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  },
};
`;

const db = await D1Database("database", {
  migrationsDir: "../db/src/migrations",
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
  assets: "dist",
  adopt: true,
  bindings: webBindings,
  domains: [webDomain],
  script: spaFallbackScript,
  dev: { domain: "localhost:3001" },
});

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  adopt: true,
  bindings: {
    DB: db,
    NODE_ENV: isDevStage ? (process.env.NODE_ENV ?? "development") : "production",
    CORS_ORIGIN: corsOrigin,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    WEB_PUBLIC_URL: webPublicUrl,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: betterAuthUrl,
    ORRN_MASTER_KEY: process.env.ORRN_MASTER_KEY ?? devMasterKey,
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
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
