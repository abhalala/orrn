import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fetchWithTimeout, isRequestTimeout, REQUEST_TIMEOUT_MS, RequestTimeoutError } from "../lib/request-timeout";
import { gateQueryRetry } from "../lib/session";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** A fetch that never answers until its signal aborts, like plant Wi-Fi whose uplink has dropped. */
function hangingFetch() {
  const seen: { signal?: AbortSignal | null } = {};
  const impl = (_input: string | URL | Request, init?: RequestInit) => {
    seen.signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const aborted = () => reject(new DOMException("Aborted", "AbortError"));
      // Like a real fetch: an already aborted signal rejects at once.
      if (init?.signal?.aborted) return aborted();
      init?.signal?.addEventListener("abort", aborted, { once: true });
    });
  };
  return { impl, seen };
}

describe("fetchWithTimeout (connected but dead network)", () => {
  test("gives up after the timeout with a RequestTimeoutError instead of waiting for the OS (60 s on iOS, none on Android)", async () => {
    const { impl } = hangingFetch();
    const started = Date.now();
    const error = await fetchWithTimeout(impl, 30)("https://api.example/trpc").catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(isRequestTimeout(error)).toBe(true);
  });

  test("a caller's own abort (React Query cancelling) still aborts, and is not reported as a timeout", async () => {
    const { impl } = hangingFetch();
    const caller = new AbortController();
    const pending = fetchWithTimeout(impl, 5_000)("https://api.example/trpc", { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort();
    const error = await pending;
    expect((error as Error).name).toBe("AbortError");
    expect(isRequestTimeout(error)).toBe(false);
  });

  test("an already aborted caller signal aborts at once", async () => {
    const { impl, seen } = hangingFetch();
    const caller = new AbortController();
    caller.abort();
    const error = await fetchWithTimeout(impl, 5_000)("https://api.example/trpc", { signal: caller.signal }).catch((e: unknown) => e);
    expect(seen.signal?.aborted).toBe(true);
    expect(isRequestTimeout(error)).toBe(false);
  });

  test("a quick answer passes through untouched and the timer is cleared (no late abort)", async () => {
    let signal: AbortSignal | null | undefined;
    const ok = new Response("{}", { status: 200 });
    const impl = async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return ok;
    };
    const res = await fetchWithTimeout(impl, 20)("https://api.example/trpc", { method: "POST" });
    expect(res).toBe(ok);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal?.aborted).toBe(false);
  });

  test("other failures keep their own error", async () => {
    const boom = new TypeError("Network request failed");
    const error = await fetchWithTimeout(async () => Promise.reject(boom), 5_000)("https://api.example/trpc").catch((e: unknown) => e);
    expect(error).toBe(boom);
  });

  test("tRPC wraps the timeout as the cause of a TRPCClientError; it is still recognised", () => {
    const wrapped = Object.assign(new Error("Request timed out"), { name: "TRPCClientError", cause: new RequestTimeoutError(10_000) });
    expect(isRequestTimeout(wrapped)).toBe(true);
    expect(isRequestTimeout(new Error("x"))).toBe(false);
    expect(isRequestTimeout(null)).toBe(false);
  });

  test("the default is about 10 seconds", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });
});

describe("gate query retry", () => {
  const server = { message: "boom", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } };
  const unauthorized = { message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED", httpStatus: 401 } };

  test("one retry for a transient failure, none for a 4xx", () => {
    expect(gateQueryRetry(0, server)).toBe(true);
    expect(gateQueryRetry(1, server)).toBe(false);
    expect(gateQueryRetry(0, unauthorized)).toBe(false);
  });

  test("a timed-out auth.me goes straight to the offline screen (no second 10 s wait on a dead uplink)", () => {
    const timedOut = Object.assign(new Error("Request timed out"), { cause: new RequestTimeoutError(10_000) });
    expect(gateQueryRetry(0, timedOut)).toBe(false);
  });
});

describe("wiring", () => {
  test("every tRPC request goes through fetchWithTimeout", () => {
    const src = read("utils/trpc.ts");
    expect(src).toMatch(/const timedFetch = fetchWithTimeout\(/);
    expect(src).toMatch(/fetch\(url, options\) \{\s*return timedFetch\(url,/);
    expect(src.match(/\bfetch\(/g)?.length).toBe(2); // the link's fetch option and the one wrapped by fetchWithTimeout
  });

  test("Better Auth calls (sign-in, TOTP, sign-out) carry the same timeout", () => {
    expect(read("lib/auth-client.ts")).toMatch(/fetchOptions:\s*\{\s*timeout:\s*REQUEST_TIMEOUT_MS\s*\}/);
  });

  test("the root gate query uses gateQueryRetry", () => {
    expect(read("app/_layout.tsx")).toMatch(/retry:\s*gateQueryRetry/);
  });
});
