// This file infers types for the cloudflare:workers environment from your Alchemy Worker.
// @see https://alchemy.run/concepts/bindings/#type-safe-bindings
//
// NOTE: The Env type is inferred from the Alchemy Worker definition in
// @orrn/server/infra/alchemy.run.ts. To avoid a circular dependency between
// @orrn/env and @orrn/server, we define the Env type manually here.
// When bindings change in alchemy.run.ts, update this interface to match.

export interface CloudflareEnv {
  DB: D1Database;
  NODE_ENV: string;
  CORS_ORIGIN: string;
  CORS_ALLOWED_ORIGINS: string;
  WEB_PUBLIC_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ORRN_MASTER_KEY: string;
  /** Purelymail SMTP password for system@orrn.in (production secret; absent/empty = SMTP sender off). */
  PURELYMAIL_SMTP_PASSWORD?: string;
  /** Optional Email Sending binding; absent until supported deployment tooling and account setup. */
  EMAIL?: SendEmail;
  WEBHOOK_BASE_URL: string;
  /**
   * The parent domain the auth cookies used to be scoped to (".orrn.in" in production, ".orrn.app"
   * on the dev stage), used ONLY to clear those old cookies (packages/server/src/lib/legacyCookies.ts).
   * Auth cookies are host-only now and never take a Domain attribute.
   */
  LEGACY_COOKIE_DOMAIN?: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID_IN: string;
  /** Die files (FP-DR-07/13): photos, PDFs, CDR/DWG under `{companyId}/dies/{sectionId}/{fileId}`. Optional until a stage binds it. */
  DIE_FILES?: R2Bucket;
  /** Local wrangler only: password for the seeded dev accounts. Never set in deployed stages. */
  ORRN_LOCAL_PASSWORD?: string;
  /** Local dev only: "1" makes scale.reading answer from a built-in simulator (never in production). */
  SCALE_SIMULATOR?: string;
  /** Local / demo only: "1" lets `foundry.readings.simulate` write a furnace temperature curve (W2-FD-S; real PLC bring-up is owner-only, Q46). */
  FOUNDRY_SIMULATOR?: string;
  /** Local dev only: "1" lets ageing.batches.simulate post a simulated oven curve (W3-AG-C; never in production). */
  OVEN_SIMULATOR?: string;
  /** Local dev only: normal | under | over | dip (default normal). */
  OVEN_SIMULATOR_PROFILE?: string;
  /** Daily per-company exports and restore drills (FP-PF-12). Optional: no binding = backups report failed. */
  BACKUPS?: R2Bucket;
  /**
   * Infinity Portal file vault (`ingest-vault`): raw uploads, digests and canonical row files under
   * `tenants/{companyId}/artifacts/{sha256}/`. Optional: absent (ORRN_SKIP_R2) = files are read and
   * staged but their bytes are not kept.
   */
  INGEST_VAULT?: R2Bucket;
  /** Infinity Portal column helper (Claude API, production secret). Optional: absent = people map columns by hand. */
  ANTHROPIC_API_KEY?: string;
  /** Optional proxy origin for the column helper (the plant's CLIProxyAPI). Unset = Anthropic direct. */
  ANTHROPIC_BASE_URL?: string;
  /** Optional Cloudflare Access service token for the proxy. Both or neither. */
  MODEL_ACCESS_CLIENT_ID?: string;
  MODEL_ACCESS_CLIENT_SECRET?: string;
  /**
   * Google sign-in (plan 2026-11-18). Optional: unless both are set, Google is not offered
   * (`auth.methods.google` is false).
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * The Android app's signing key hash, allowed as a passkey origin (`android:apk-key-hash:<hash>`).
   * Optional: unset = only the web origin answers a passkey challenge, and the Android app hides its
   * passkey button (`auth.methods.native.android`). The deploy derives it from `ORRN_ANDROID_CERT_SHA256`
   * when it is not given itself.
   */
  ANDROID_APK_KEY_HASH?: string;
  /**
   * The Apple Developer Team ID. Bound when the web serves the iOS app's passkey association
   * (`apple-app-site-association`); `auth.methods.native.ios` reports it. Optional: unset = the iOS
   * app hides its passkey button.
   */
  ORRN_APPLE_TEAM_ID?: string;
}

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}
