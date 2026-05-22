import alchemy from "alchemy";
import { D1Database, Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import type { Scope } from "alchemy";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const app = await alchemy("orrn", {
  stateStore: (scope: Scope) => new CloudflareStateStore(scope),
});
const devMasterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const zoneName = "orrn.app";
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const webDomain = process.env.WEB_DOMAIN ?? `dev.${zoneName}`;
const apiDomain = process.env.API_DOMAIN ?? `api.dev.${zoneName}`;
const webUrl = `https://${webDomain}`;
const apiUrl = `https://${apiDomain}`;

if (!zoneId) {
  throw new Error("CLOUDFLARE_ZONE_ID is required to deploy custom domains.");
}

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
      zoneId,
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
      zoneId,
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
