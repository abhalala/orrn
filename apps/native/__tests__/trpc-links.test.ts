import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTRPCUntypedClient } from "@trpc/client";

import { isRequestTimeout, MUTATION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, writeFailureKind } from "../lib/request-timeout";
import { orrnLinks } from "../lib/trpc-links";

const ROOT = join(import.meta.dir, "..");
const URL_BASE = "https://api.example/trpc";

type Seen = { url: string; method: string; credentials?: RequestCredentials; cookie?: string | null; signal?: AbortSignal | null };

/** A tRPC batch reply with one result per procedure in the URL ("a,b" for a batch of two). */
function batchReply(url: string, data: unknown = { ok: true }) {
  const paths = new URL(url).pathname.split("/").pop()!.split(",");
  return new Response(JSON.stringify(paths.map(() => ({ result: { data } }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A stand-in for the platform fetch. `answerAfterMs` null never answers (Wi-Fi
 * whose uplink has dropped); a number answers after that long, the way a save
 * that committed at once can still take long to come back on a weak uplink.
 */
function fakeFetch(answerAfterMs: number | null, reply: (url: string) => Response = batchReply) {
  const seen: Seen[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      cookie: new Headers(init?.headers).get("cookie"),
      signal: init?.signal,
    });
    return new Promise<Response>((resolve, reject) => {
      const aborted = () => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) return aborted();
      init?.signal?.addEventListener("abort", aborted, { once: true });
      if (answerAfterMs !== null) setTimeout(() => resolve(reply(url)), answerAfterMs);
    });
  };
  return { impl, seen };
}

function client(fetchImpl: ReturnType<typeof fakeFetch>["impl"], timeouts: { queryTimeoutMs?: number; mutationTimeoutMs?: number } = {}) {
  return createTRPCUntypedClient({
    links: orrnLinks({
      url: URL_BASE,
      fetch: fetchImpl,
      credentials: "omit",
      headers: () => ({ Cookie: "better-auth.session_token=abc" }),
      ...timeouts,
    }),
  });
}

/** Settles a promise into a value we can inspect without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("reads give up quickly, saves do not (a lost reply must not look like a failed save)", () => {
  test("a query that gets no answer gives up at the query timeout", async () => {
    const { impl } = fakeFetch(null);
    const error = await client(impl, { queryTimeoutMs: 30, mutationTimeoutMs: 2_000 })
      .query("auth.me")
      .catch((e: unknown) => e);
    expect(isRequestTimeout(error)).toBe(true);
  });

  test("a mutation is not cut off at the query timeout", async () => {
    const { impl } = fakeFetch(null);
    const save = track(client(impl, { queryTimeoutMs: 30, mutationTimeoutMs: 400 }).mutation("bundle.createReceipt", { pcs: 40 }));
    await wait(150);
    expect(save.settled).toBe(false);
    await wait(500);
    // The long ceiling still ends it: Android's fetch has no timeout of its own.
    expect(save.settled).toBe(true);
    expect(isRequestTimeout(save.error)).toBe(true);
  });

  test("a save whose reply arrives after the query timeout succeeds instead of inviting a duplicate", async () => {
    const { impl } = fakeFetch(120);
    const result = await client(impl, { queryTimeoutMs: 30, mutationTimeoutMs: 2_000 }).mutation("dispatch.create", {});
    expect(result).toEqual({ ok: true });
  });

  test("a read and a save sent together go out as separate requests, so they never share one timeout", async () => {
    const { impl, seen } = fakeFetch(10);
    const c = client(impl);
    await Promise.all([c.query("auth.me"), c.mutation("dispatch.create", {})]);
    expect(seen.map((s) => s.method).sort()).toEqual(["GET", "POST"]);
    expect(seen.find((s) => s.method === "GET")!.url).toContain("/trpc/auth.me");
    expect(seen.find((s) => s.method === "POST")!.url).toContain("/trpc/dispatch.create");
  });

  test("both carry the session cookie and no browser credentials (Better Auth Expo sends the cookie itself)", async () => {
    const { impl, seen } = fakeFetch(0);
    const c = client(impl);
    await c.query("auth.me");
    await c.mutation("dispatch.create", {});
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.credentials).toBe("omit");
      expect(s.cookie).toBe("better-auth.session_token=abc");
    }
  });
});

describe("the defaults: 10 s for reads, a long ceiling for saves", () => {
  const realSetTimeout = globalThis.setTimeout;
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
  });

  /** Records every timer delay while a request runs (the timeout is one of them). */
  function recordDelays() {
    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout;
    return delays;
  }

  test("the values", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(MUTATION_TIMEOUT_MS).toBe(60_000);
  });

  test("a query arms the 10 s timer, never the mutation ceiling", async () => {
    const { impl } = fakeFetch(0);
    const delays = recordDelays();
    await client(impl).query("auth.me");
    expect(delays).toContain(REQUEST_TIMEOUT_MS);
    expect(delays).not.toContain(MUTATION_TIMEOUT_MS);
  });

  test("a mutation does not get the 10 s abort", async () => {
    const { impl } = fakeFetch(0);
    const delays = recordDelays();
    await client(impl).mutation("bundle.createReceipt", { pcs: 40 });
    expect(delays).toContain(MUTATION_TIMEOUT_MS);
    expect(delays).not.toContain(REQUEST_TIMEOUT_MS);
  });
});

describe("writeFailureKind: what a failed save means to the person", () => {
  test("a timed-out save may have landed: 'unsure' (check before trying again)", async () => {
    const { impl } = fakeFetch(null);
    const error = await client(impl, { mutationTimeoutMs: 30 })
      .mutation("bundle.createReceipt", {})
      .catch((e: unknown) => e);
    expect(writeFailureKind(error)).toBe("unsure");
  });

  test("a dropped connection gives no answer either: 'unsure'", async () => {
    const impl = async () => Promise.reject(new TypeError("Network request failed"));
    const error = await client(impl)
      .mutation("dispatch.create", {})
      .catch((e: unknown) => e);
    expect(writeFailureKind(error)).toBe("unsure");
  });

  test("orrn answered with an error: nothing was saved, 'failed'", async () => {
    const reply = () =>
      new Response(
        JSON.stringify([
          { error: { message: "Pick a customer", code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400, path: "dispatch.create" } } },
        ]),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const { impl } = fakeFetch(0, reply);
    const error = await client(impl)
      .mutation("dispatch.create", {})
      .catch((e: unknown) => e);
    expect(writeFailureKind(error)).toBe("failed");
  });
});

describe("wiring", () => {
  const src = readFileSync(join(ROOT, "utils/trpc.ts"), "utf8");

  test("the app's tRPC client is built from orrnLinks with the default timeouts", () => {
    expect(src).toMatch(/links:\s*orrnLinks(<AppRouter>)?\(\{/);
    expect(src).not.toMatch(/TimeoutMs/);
  });

  test("no second link sends requests around the split", () => {
    expect(src).not.toMatch(/httpBatchLink|httpLink|splitLink|fetchWithTimeout/);
  });
});
