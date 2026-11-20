import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import alchemy, { Resource, Scope } from "alchemy";
import { createCloudflareApi, D1Database, handleApiError, R2Bucket, Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

import { deployMasterKey } from "./masterKey";
import { nativePasskeyBindings } from "./nativePasskeys";
import { optionalR2Bucket } from "./optionalR2";
import { WEB_EDGE_SCRIPT } from "./webEdge";

const infraDir = dirname(fileURLToPath(import.meta.url));

config({ path: join(infraDir, "../../.env") });
config({ path: join(infraDir, "../../../../apps/server/.env") });

const app = await alchemy("orrn", {
  stateStore: (scope: Scope) =>
    new CloudflareStateStore(scope, {
      forceUpdate: process.env.ALCHEMY_STATE_FORCE_UPDATE === "1",
    }),
});

const zoneName = "orrn.app";
const stage = process.env.ALCHEMY_STAGE ?? "production";
const isDevStage = stage === "dev";

// Security review 2026-11-04 (MEDIUM 4): outside the dev stage a missing ORRN_MASTER_KEY, or the
// public all-zero dev key, stops the deploy here (infra/masterKey.ts). Bound as a secret below.
const masterKey = deployMasterKey({ isDevStage, value: process.env.ORRN_MASTER_KEY });

// Purelymail SMTP (system@orrn.in) is the only outward mail sender (orrn.in's SPF/DKIM/DMARC
// authorise nothing else). Production refuses to deploy without it rather than shipping a server
// that silently cannot send invites or password resets.
const smtpPassword = process.env.PURELYMAIL_SMTP_PASSWORD?.trim() ?? "";
if (!isDevStage && !smtpPassword) {
  throw new Error("PURELYMAIL_SMTP_PASSWORD is required for production: invite and password-reset email cannot be sent without it.");
}
console.log(`SMTP      -> ${smtpPassword ? `Purelymail password present (${smtpPassword.length} chars)` : "not configured (emails log only)"}`);

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
// The parent domain the auth cookies were scoped to before 2026-11-04. Only used to clear those old
// cookies (lib/legacyCookies.ts); auth cookies are host-only on the API host now.
let legacyCookieDomain: string;

if (isDevStage) {
  const appZone = requireZone(zoneIdApp, "CLOUDFLARE_ZONE_ID or CLOUDFLARE_ZONE_ID_APP");
  const webHost = process.env.WEB_DOMAIN ?? `dev.${zoneName}`;

  apiDomain = process.env.API_DOMAIN ?? `api.dev.${zoneName}`;
  apiZoneId = appZone;
  webDomain = { domainName: webHost, zoneId: appZone, adopt: true };

  webPublicUrl = process.env.VITE_PUBLIC_URL ?? `https://${webHost}`;
  corsOrigin = process.env.CORS_ORIGIN ?? webPublicUrl;
  corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? webPublicUrl;
  legacyCookieDomain = `.${zoneName}`;
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
  legacyCookieDomain = ".orrn.in";
}

const apiUrl = `https://${apiDomain}`;
const viteServerUrl = isDevStage ? (process.env.VITE_SERVER_URL ?? apiUrl) : apiUrl;
const betterAuthUrl = isDevStage ? (process.env.BETTER_AUTH_URL ?? apiUrl) : apiUrl;

const webBindings = {
  VITE_SERVER_URL: viteServerUrl,
  VITE_PUBLIC_URL: webPublicUrl,
};

// Edge rules for the web Worker (HTTPS, www, SPA fallback, HSTS, `/.well-known`): infra/webEdge.ts.
const spaFallbackScript = WEB_EDGE_SCRIPT;

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

/**
 * Infinity Portal vault (plan A2): the raw bytes of every imported file, kept forever, under
 * `tenants/<companyId>/artifacts/<sha256>/`. Uploaded by signed PUT. Optional like the others: without
 * it imports still work from D1 staged rows and the screen says the original file is not kept.
 * `delete: false` for the same reason as backups.
 */
const ingestVault = await optionalR2Bucket("ingest-vault", {
  feature: "the import file vault",
  probe: r2Probe,
  forget: forgetR2State("ingest-vault"),
  create: () =>
    R2Bucket("ingest-vault", {
      adopt: true,
      delete: false,
      // Security M1 / L6 (fix round 2026-11-20): a multipart upload left unfinished is aborted after 1 day, so its
      // parts stop costing; R2's own default is 7 days. Only an abort rule: no object is ever deleted by age (raw files
      // are kept forever). `upload-parts.ts` resumes a plan only within 20 hours (PLAN_RESUME_MS) and the daily cron
      // clears what is left. This PUT replaces the bucket's lifecycle rules, including R2's default abort rule.
      lifecycle: [
        {
          id: "abort-unfinished-uploads-1d",
          conditions: { prefix: "" },
          enabled: true,
          abortMultipartUploadsTransition: { condition: { maxAge: 86_400, type: "Age" } },
        },
      ],
    }),
});

/**
 * The column helper's model route (owner decisions 2026-11-10 and 2026-11-17). Optional: without a key a
 * person maps columns. The key may be a proxy key: with `ANTHROPIC_BASE_URL` the SDK calls the plant's
 * CLIProxyAPI (an origin only, no path) and `MODEL_ACCESS_CLIENT_ID` + `MODEL_ACCESS_CLIENT_SECRET` are the
 * Cloudflare Access service token that proxy sits behind. Each is bound on its own, so the Worker sees a
 * half-set pair as it is and turns the helper off with a log line. Values are never printed.
 */
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL?.trim() ?? "";
const modelAccessClientId = process.env.MODEL_ACCESS_CLIENT_ID?.trim() ?? "";
const modelAccessClientSecret = process.env.MODEL_ACCESS_CLIENT_SECRET?.trim() ?? "";
const helperRoute = !anthropicApiKey
  ? "not configured (manual mapping only)"
  : `${anthropicBaseUrl ? "via base URL" : "direct to Anthropic"}${modelAccessClientId && modelAccessClientSecret ? ", Access token present" : ""}`;
console.log(`Imports   -> column helper ${helperRoute}`);
if (Boolean(modelAccessClientId) !== Boolean(modelAccessClientSecret)) {
  console.warn("Imports   -> MODEL_ACCESS_CLIENT_ID and MODEL_ACCESS_CLIENT_SECRET must be set together; the helper stays off until both are.");
}
if (!anthropicApiKey && (anthropicBaseUrl || modelAccessClientId || modelAccessClientSecret)) {
  console.warn("Imports   -> a base URL or Access value is set but ANTHROPIC_API_KEY is not; the helper stays off.");
}

/**
 * Google sign-in (plan 2026-11-18). Optional: without it the sign-in screens hide Google. Both or
 * neither: a half-set pair binds nothing and says so, so the Worker never sees a lone id or secret.
 * The client id is not a secret; the client secret is an encrypted binding. Values are never printed.
 */
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
const googleConfigured = Boolean(googleClientId && googleClientSecret);
console.log(`Google    -> ${googleConfigured ? "configured" : "not configured"}`);
if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
  console.warn("Google    -> GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together; Google sign-in stays off until both are.");
}

/**
 * Native passkeys (plan 2026-11-18, Task 6). Optional owner values, not secrets:
 * - `ORRN_APPLE_TEAM_ID`: the web build writes `/.well-known/apple-app-site-association` with it, and the
 *   Worker gets it so `auth.methods.native.ios` tells the iPhone app to show its passkey button.
 * - `ORRN_ANDROID_CERT_SHA256`: the release certificate's SHA-256; the web build writes
 *   `/.well-known/assetlinks.json` with it. `ANDROID_APK_KEY_HASH` (the Android passkey origin's hash,
 *   `passkey-config.ts`) is derived from it; a given hash must agree, and none is bound without it
 *   (infra/nativePasskeys.ts).
 * The web build reads both from this process's environment (Alchemy's build inherits it).
 */
const { appleTeamId, androidApkKeyHash, warnings: passkeyWarnings } = nativePasskeyBindings(process.env);
for (const warning of passkeyWarnings) console.warn(`Passkeys  -> ${warning}`);
console.log(`Passkeys  -> iOS app ${appleTeamId ? "associated" : "not configured"}, Android app ${androidApkKeyHash ? "associated" : "not configured"}`);

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
  // The Workers Paid default, pinned: the whole-file SHA-256 check of a chunked upload runs in one request, and the
  // largest file per upload (`uploadFileMiB` ceiling, 2 GiB) is chosen to hash well inside it (plantLimits.ts).
  limits: { cpu_ms: 30_000 },
  // EMAIL intentionally absent: installed Alchemy 0.91.2 cannot serialize send_email bindings.
  // Purelymail SMTP is the sender until then (packages/auth/src/smtp.ts).
  // See docs/DEPLOY_PROMOTION.md; never provision Email Routing as a substitute.
  bindings: {
    DB: db,
    // Absent bucket = no key at all (never an `undefined` binding).
    ...(dieFiles ? { DIE_FILES: dieFiles } : {}),
    ...(backups ? { BACKUPS: backups } : {}),
    ...(ingestVault ? { INGEST_VAULT: ingestVault } : {}),
    NODE_ENV: isDevStage ? (process.env.NODE_ENV ?? "development") : "production",
    CORS_ORIGIN: corsOrigin,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    WEB_PUBLIC_URL: webPublicUrl,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: betterAuthUrl,
    // Encrypted secret binding, never plain text: it signs links and wraps every node secret.
    ORRN_MASTER_KEY: alchemy.secret(masterKey),
    // Encrypted secret binding, never plain text (it was readable in the dashboard before).
    ...(smtpPassword ? { PURELYMAIL_SMTP_PASSWORD: alchemy.secret(smtpPassword) } : {}),
    // Encrypted secret binding; absent key = no binding (the helper reports not set up).
    ...(anthropicApiKey ? { ANTHROPIC_API_KEY: alchemy.secret(anthropicApiKey) } : {}),
    // The proxy origin and the Access client id are not secrets. The Access secret is encrypted.
    ...(anthropicBaseUrl ? { ANTHROPIC_BASE_URL: anthropicBaseUrl } : {}),
    ...(modelAccessClientId ? { MODEL_ACCESS_CLIENT_ID: modelAccessClientId } : {}),
    ...(modelAccessClientSecret ? { MODEL_ACCESS_CLIENT_SECRET: alchemy.secret(modelAccessClientSecret) } : {}),
    // Google sign-in: both or neither (see above). The secret is an encrypted binding.
    ...(googleConfigured ? { GOOGLE_CLIENT_ID: googleClientId, GOOGLE_CLIENT_SECRET: alchemy.secret(googleClientSecret) } : {}),
    // Native passkeys (see above): absent value = no binding, and that app hides its passkey button.
    ...(appleTeamId ? { ORRN_APPLE_TEAM_ID: appleTeamId } : {}),
    ...(androidApkKeyHash ? { ANDROID_APK_KEY_HASH: androidApkKeyHash } : {}),
    WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL ?? "",
    LEGACY_COOKIE_DOMAIN: legacyCookieDomain,
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
