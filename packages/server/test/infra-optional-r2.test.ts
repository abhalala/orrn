/**
 * R2-OPTIONAL (LEDGER D36): a deploy to a Cloudflare account without R2 skips the buckets with a loud
 * warning instead of failing; every other error still fails the deploy.
 */
import { describe, expect, test } from "bun:test";

import { isR2NotEnabledError, optionalR2Bucket } from "../src/infra/optionalR2";

/** The shape alchemy's CloudflareApiError carries: HTTP status and the API's `errors` array. */
function cfError(status: number, errors: { code: number; message: string }[]) {
  return Object.assign(new Error(`Error ${status}`), { status, errorData: errors });
}

const NOT_ENABLED = cfError(403, [{ code: 10042, message: "Please enable R2 through the Cloudflare Dashboard." }]);

function harness(overrides: { probe?: () => Promise<unknown>; create?: () => Promise<unknown>; env?: Record<string, string> } = {}) {
  const calls = { probe: 0, create: 0, forget: 0 };
  const lines: string[] = [];
  const run = (name = "die-files") =>
    optionalR2Bucket(name, {
      feature: "die files",
      env: overrides.env ?? {},
      warn: (l) => lines.push(l),
      probe: async () => {
        calls.probe += 1;
        return overrides.probe?.();
      },
      create: async () => {
        calls.create += 1;
        return overrides.create ? overrides.create() : { name: "orrn-die-files-dev" };
      },
      forget: async () => {
        calls.forget += 1;
      },
    });
  return { calls, lines, run };
}

describe("isR2NotEnabledError", () => {
  test("403 with code 10042 is 'no R2'", () => {
    expect(isR2NotEnabledError(NOT_ENABLED)).toBe(true);
  });

  test("403 with another 10000-series code only when the message says R2 is not enabled", () => {
    expect(isR2NotEnabledError(cfError(403, [{ code: 10001, message: "R2 is not enabled on this account" }]))).toBe(true);
    expect(isR2NotEnabledError(cfError(403, [{ code: 10000, message: "Authentication error" }]))).toBe(false);
  });

  test("free text alone never matches: needs status 403 and a code", () => {
    expect(isR2NotEnabledError(new Error("Please enable R2 through the Cloudflare Dashboard."))).toBe(false);
    expect(isR2NotEnabledError(cfError(400, [{ code: 10042, message: "Please enable R2" }]))).toBe(false);
    expect(isR2NotEnabledError(cfError(403, [{ code: 7003, message: "Please enable R2" }]))).toBe(false);
    expect(isR2NotEnabledError(cfError(403, []))).toBe(false);
    expect(isR2NotEnabledError(null)).toBe(false);
  });
});

describe("optionalR2Bucket", () => {
  test("R2 enabled: probes, creates and returns the bucket, no warning", async () => {
    const h = harness();
    expect(await h.run()).toEqual({ name: "orrn-die-files-dev" });
    expect(h.calls).toEqual({ probe: 1, create: 1, forget: 0 });
    expect(h.lines).toEqual([]);
  });

  test("probe 403 / 10042: undefined, the bucket resource is never started, state forgotten, one loud line", async () => {
    const h = harness({ probe: async () => Promise.reject(NOT_ENABLED) });
    expect(await h.run()).toBeUndefined();
    expect(h.calls).toEqual({ probe: 1, create: 0, forget: 1 });
    expect(h.lines).toEqual([
      '[deploy] R2 bucket "die-files" not created: Cloudflare 403 [10042] Please enable R2 through the Cloudflare Dashboard. — die files disabled until R2 is enabled; re-deploy then',
    ]);
  });

  test("create 403 / 10042 after a passing probe: still undefined with the warning", async () => {
    const h = harness({ create: async () => Promise.reject(NOT_ENABLED) });
    expect(await h.run()).toBeUndefined();
    expect(h.calls.create).toBe(1);
    expect(h.lines).toHaveLength(1);
  });

  test("any other error is rethrown (auth 403, 500, network) and nothing is forgotten", async () => {
    const auth = cfError(403, [{ code: 10000, message: "Authentication error" }]);
    const probeAuth = harness({ probe: async () => Promise.reject(auth) });
    await expect(probeAuth.run()).rejects.toBe(auth);
    expect(probeAuth.calls).toEqual({ probe: 1, create: 0, forget: 0 });

    const boom = cfError(500, [{ code: 10001, message: "Internal error" }]);
    const createFail = harness({ create: async () => Promise.reject(boom) });
    await expect(createFail.run()).rejects.toBe(boom);
    expect(createFail.lines).toEqual([]);

    const net = new Error("Failed to fetch");
    await expect(harness({ probe: async () => Promise.reject(net) }).run()).rejects.toBe(net);
  });

  test("ORRN_SKIP_R2=1 skips without any Cloudflare call", async () => {
    const h = harness({ env: { ORRN_SKIP_R2: "1" } });
    expect(await h.run("backups")).toBeUndefined();
    expect(h.calls).toEqual({ probe: 0, create: 0, forget: 1 });
    expect(h.lines[0]).toStartWith('[deploy] R2 bucket "backups" not created: ORRN_SKIP_R2=1 — ');
  });

  test("ORRN_SKIP_R2 other than '1' does not skip", async () => {
    const h = harness({ env: { ORRN_SKIP_R2: "0" } });
    expect(await h.run()).toBeDefined();
  });
});
