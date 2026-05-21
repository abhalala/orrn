import alchemy from "alchemy";
import { D1Database, Vite, Worker, Zone } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import type { Scope } from "alchemy";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const app = await alchemy("orrn", {
  stateStore: process.env.ALCHEMY_STATE_TOKEN
    ? (scope: Scope) => new CloudflareStateStore(scope)
    : undefined,
});
const devMasterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const zoneName = "orrn.app";
const webDomain = process.env.WEB_DOMAIN ?? `dev.${zoneName}`;
const apiDomain = process.env.API_DOMAIN ?? `api.dev.${zoneName}`;
const webUrl = `https://${webDomain}`;
const apiUrl = `https://${apiDomain}`;

const zone = await Zone(zoneName, {
  name: zoneName,
  delete: false,
  settings: {
    developmentMode: "on",
    alwaysUseHttps: "on",
    automaticHttpsRewrites: "on",
    brotli: "on",
    http2: "on",
    http3: "on",
    websockets: "on",
  },
});

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
});

export const web = await Vite("web", {
  cwd: "../../apps/web",
  assets: "dist",
  adopt: true,
  bindings: {
    VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? apiUrl,
  },
  domains: [
    {
      domainName: webDomain,
      zoneId: zone.id,
      adopt: true,
    },
  ],
  dev: {
    domain: "localhost:3001",
  },
});

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  adopt: true,
  bindings: {
    DB: db,
    NODE_ENV: process.env.NODE_ENV ?? "development",
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? webUrl,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? apiUrl,
    ORRN_MASTER_KEY: process.env.ORRN_MASTER_KEY ?? devMasterKey,
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
    WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL ?? "",
  },
  domains: [
    {
      domainName: apiDomain,
      zoneId: zone.id,
      adopt: true,
    },
  ],
  dev: {
    port: 3000,
  },
});

console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
