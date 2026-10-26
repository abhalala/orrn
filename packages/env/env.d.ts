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
  RESEND_API_KEY: string;
  /** Optional Email Sending binding; absent until supported deployment tooling and account setup. */
  EMAIL?: SendEmail;
  WEBHOOK_BASE_URL: string;
  COOKIE_DOMAIN: string;
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
}

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}
