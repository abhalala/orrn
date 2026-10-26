/**
 * Shared set-up for the tests that run the dev seed (`apps/server/src/dev-seed.ts`) on a Miniflare
 * D1. The seed creates its logins through Better Auth, which the harness does not have, so the
 * tests insert the same users first (the seed finds them by email and keeps them).
 *
 * The list comes from `DEV_ACCOUNTS`, so a new demo login is added in one place: every test that
 * seeds picks it up. The party login is not here: the portal seed makes it itself.
 */
import { user } from "@orrn/db/schema";

import type { TestEnv } from "./harness";

const SEED_DIR = "../../../apps/server/src";

export type DevSeedResult = {
  ok: boolean;
  accounts?: Record<string, string>;
  counts: Record<string, number>;
  bundlesByStatus?: Record<string, number>;
};

/** Every `dev-user-{key}` the seed expects, except the portal party (made by the portal seed). */
export async function devSeedUserKeys(): Promise<string[]> {
  const path = `${SEED_DIR}/dev-accounts`;
  const { DEV_ACCOUNTS } = (await import(path)) as { DEV_ACCOUNTS: Record<string, { email: string }> };
  return Object.keys(DEV_ACCOUNTS).filter((key) => key !== "party");
}

/** Insert the demo logins (ids `dev-user-{key}`, emails `{key}@orrn.local`); safe to call twice. */
export async function precreateDevSeedUsers(env: TestEnv): Promise<string[]> {
  const path = `${SEED_DIR}/dev-accounts`;
  const { DEV_ACCOUNTS } = (await import(path)) as { DEV_ACCOUNTS: Record<string, { email: string; name: string }> };
  const keys = await devSeedUserKeys();
  for (const key of keys) {
    await env.db
      .insert(user)
      .values({ id: `dev-user-${key}`, name: DEV_ACCOUNTS[key]!.name, email: DEV_ACCOUNTS[key]!.email })
      .onConflictDoNothing();
  }
  return keys;
}

/** The seed function, imported by a variable path so the package's type check never follows it. */
export async function loadDevSeed(): Promise<(db: TestEnv["db"], opts: { password: string; now?: number }) => Promise<DevSeedResult>> {
  const path = `${SEED_DIR}/dev-seed`;
  const mod = (await import(path)) as { seedDevData: (db: TestEnv["db"], opts: { password: string; now?: number }) => Promise<DevSeedResult> };
  return mod.seedDevData;
}

/** The dev spectro-inbox hook (`apps/server/src/dev-spectro.ts`), imported by a variable path for the same reason. */
export async function loadDevSpectro(): Promise<{
  devSpectroInput: { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean } };
  runDevSpectro: (db: TestEnv["db"], input: unknown) => Promise<{ ok: true }>;
}> {
  const path = `${SEED_DIR}/dev-spectro`;
  return (await import(path)) as Awaited<ReturnType<typeof loadDevSpectro>>;
}

export const DEV_SEED_COMPANY = "dev-company-orrn";
export const DEV_SEED_PASSWORD = "dev-seed-test";
