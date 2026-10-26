/**
 * Mocks the Workers-only `cloudflare:workers` module for bun test.
 *
 * Loaded as a bun test preload (see bunfig.toml) so it runs before any server
 * module is imported, and also imported by harness.ts so the harness works
 * without the preload. The `env` object is created once and mutated by
 * createTestEnv(), so modules that already captured it keep seeing the current
 * bindings.
 */
import { mock } from "bun:test";

export const DEV_MASTER_KEY = Buffer.from("orrn-test-master-key-0123456789a").toString("base64");

export const workersEnv: Record<string, unknown> = {
  NODE_ENV: "test",
  ORRN_MASTER_KEY: DEV_MASTER_KEY,
  WEB_PUBLIC_URL: "https://app.test",
};

mock.module("cloudflare:workers", () => ({ env: workersEnv }));
