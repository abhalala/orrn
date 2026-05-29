import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import alchemy from "alchemy";
import { D1Database, Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import type { Scope } from "alchemy";
import { config } from "dotenv";

const infraDir = dirname(fileURLToPath(import.meta.url));

config({ path: join(infraDir, ".env") });
config({ path: join(infraDir, "../../apps/server/.env") });

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

let marketingDomain: DomainBinding;
let erpDomain: DomainBinding;
let adminDomain: DomainBinding;
let apiDomain: string;
let apiZoneId: string;
let corsOrigin: string;
let corsAllowedOrigins: string;
let webErpUrl: string;
let cookieDomain: string;
let marketingUrl: string;
let erpUrl: string;
let staffUrl: string;

if (isDevStage) {
  const appZone = requireZone(zoneIdApp, "CLOUDFLARE_ZONE_ID or CLOUDFLARE_ZONE_ID_APP");
  const webHost = process.env.WEB_DOMAIN ?? `dev.${zoneName}`;
  const erpHost = process.env.ERP_DOMAIN ?? `erp.${webHost}`;
  const staffHost = process.env.STAFF_DOMAIN ?? `staff.${zoneName}`;

  apiDomain = process.env.API_DOMAIN ?? `api.dev.${zoneName}`;
  apiZoneId = appZone;
  marketingDomain = { domainName: webHost, zoneId: appZone, adopt: true };
  erpDomain = { domainName: erpHost, zoneId: appZone, adopt: true };
  adminDomain = { domainName: staffHost, zoneId: appZone, adopt: true };

  marketingUrl = process.env.VITE_MARKETING_URL ?? `https://${webHost}`;
  erpUrl = process.env.VITE_ERP_URL ?? process.env.WEB_ERP_URL ?? `https://${erpHost}`;
  staffUrl = process.env.VITE_STAFF_URL ?? `https://${staffHost}`;
  corsOrigin = process.env.CORS_ORIGIN ?? marketingUrl;
  corsAllowedOrigins =
    process.env.CORS_ALLOWED_ORIGINS ?? `${marketingUrl},${erpUrl},${staffUrl}`;
  webErpUrl = erpUrl;
  cookieDomain = `.${zoneName}`;
} else {
  const inZone = requireZone(zoneIdIn, "CLOUDFLARE_ZONE_ID_IN");
  const appZone = requireZone(zoneIdApp, "CLOUDFLARE_ZONE_ID_APP or CLOUDFLARE_ZONE_ID");

  apiDomain = process.env.API_DOMAIN ?? "api.orrn.in";
  apiZoneId = inZone;
  marketingDomain = { domainName: "orrn.in", zoneId: inZone, adopt: true };
  erpDomain = { domainName: "erp.orrn.in", zoneId: inZone, adopt: true };
  adminDomain = { domainName: "orrn.app", zoneId: appZone, adopt: true };

  marketingUrl = "https://orrn.in";
  erpUrl = "https://erp.orrn.in";
  staffUrl = "https://orrn.app";
  corsOrigin = marketingUrl;
  corsAllowedOrigins = `${marketingUrl},${erpUrl},${staffUrl}`;
  webErpUrl = erpUrl;
  cookieDomain = ".orrn.in";
}

const apiUrl = `https://${apiDomain}`;
const viteServerUrl = isDevStage ? (process.env.VITE_SERVER_URL ?? apiUrl) : apiUrl;
const betterAuthUrl = isDevStage ? (process.env.BETTER_AUTH_URL ?? apiUrl) : apiUrl;

const webBindings = {
  VITE_SERVER_URL: viteServerUrl,
  VITE_MARKETING_URL: marketingUrl,
  VITE_ERP_URL: erpUrl,
  VITE_STAFF_URL: staffUrl,
};

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
});

/** Marketing + login — orrn.in (prod) / dev.orrn.app (dev) */
export const web = await Vite("web", {
  cwd: "../../apps/web",
  assets: "dist",
  adopt: true,
  bindings: webBindings,
  domains: [marketingDomain],
  dev: { domain: "localhost:3001" },
});

/** Tenant ERP — erp.orrn.in */
export const erp = await Vite("erp", {
  cwd: "../../apps/erp",
  assets: "dist",
  adopt: true,
  bindings: webBindings,
  domains: [erpDomain],
  dev: { domain: "localhost:3002" },
});

/** Platform staff console — orrn.app */
export const admin = await Vite("admin", {
  cwd: "../../apps/admin",
  assets: "dist",
  adopt: true,
  bindings: webBindings,
  domains: [adminDomain],
  dev: { domain: "localhost:3003" },
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
    WEB_ERP_URL: webErpUrl,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: betterAuthUrl,
    ORRN_MASTER_KEY: process.env.ORRN_MASTER_KEY ?? devMasterKey,
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
    WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL ?? "",
    COOKIE_DOMAIN: cookieDomain,
  },
  domains: [{ domainName: apiDomain, zoneId: apiZoneId, adopt: true }],
  dev: { port: 3000 },
});

console.log(`Stage     -> ${stage}`);
console.log(`Marketing -> ${web.url}`);
console.log(`ERP       -> ${erp.url}`);
console.log(`Admin     -> ${admin.url}`);
console.log(`Server    -> ${server.url}`);

await app.finalize();
