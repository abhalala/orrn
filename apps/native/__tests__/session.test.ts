import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  handleSessionError,
  isAuthMeQueryKey,
  isUnauthorized,
  ME_QUERY_KEY,
  resetAfterSignOut,
  resetTenantQueries,
  shouldRetryQuery,
} from "../lib/session";

const meKey = [["auth", "me"], { type: "query" }] as const;
const bundlesKey = [["bundle", "list"], { input: { limit: 20 }, type: "query" }] as const;

function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(meKey, { company: { id: "c1" } });
  qc.setQueryData(bundlesKey, ["b1", "b2"]);
  return qc;
}

describe("query keys", () => {
  test("recognises tRPC's auth.me key and nothing else", () => {
    expect(isAuthMeQueryKey(meKey)).toBe(true);
    expect(isAuthMeQueryKey(ME_QUERY_KEY)).toBe(true);
    expect(isAuthMeQueryKey(bundlesKey)).toBe(false);
    expect(isAuthMeQueryKey(["auth"])).toBe(false);
    expect(isAuthMeQueryKey(undefined)).toBe(false);
  });
});

describe("resetTenantQueries (company switch, N10)", () => {
  test("drops other tenant data but keeps auth.me so the gate does not bounce to sign-in", async () => {
    const qc = seeded();
    await resetTenantQueries(qc);
    expect(qc.getQueryData(meKey)).toEqual({ company: { id: "c1" } });
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
  });

  test("active observers refetch instead of showing the old company's rows", async () => {
    const qc = seeded();
    let calls = 0;
    const observer = new QueryObserver(qc, {
      queryKey: bundlesKey,
      queryFn: async () => {
        calls += 1;
        return ["c2-bundle"];
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await resetTenantQueries(qc);
    expect(calls).toBe(1);
    expect(qc.getQueryData(bundlesKey)).toEqual(["c2-bundle"]);
    unsubscribe();
  });
});

describe("resetAfterSignOut", () => {
  test("nothing from the signed-out person survives, auth.me included", async () => {
    const qc = seeded();
    await resetAfterSignOut(qc);
    expect(qc.getQueryData(meKey)).toBeUndefined();
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
  });
});

describe("errors and retries (parity with web)", () => {
  const unauthorized = { message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED", httpStatus: 401 } };
  const forbidden = { message: "no", data: { code: "FORBIDDEN", httpStatus: 403 } };
  const server = { message: "boom", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } };

  test("isUnauthorized", () => {
    expect(isUnauthorized(unauthorized)).toBe(true);
    expect(isUnauthorized(forbidden)).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
  });

  test("4xx never retries; transient failures retry up to 3 times", () => {
    expect(shouldRetryQuery(0, unauthorized)).toBe(false);
    expect(shouldRetryQuery(0, forbidden)).toBe(false);
    expect(shouldRetryQuery(0, server)).toBe(true);
    expect(shouldRetryQuery(2, server)).toBe(true);
    expect(shouldRetryQuery(3, server)).toBe(false);
    expect(shouldRetryQuery(0, new TypeError("Network request failed"))).toBe(true);
  });

  test("UNAUTHORIZED on any other query re-checks auth.me once; auth.me's own 401 does not loop", async () => {
    const qc = seeded();
    let meFetches = 0;
    const observer = new QueryObserver(qc, {
      queryKey: meKey,
      queryFn: async () => {
        meFetches += 1;
        return { company: { id: "c1" } };
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await handleSessionError(qc, unauthorized, bundlesKey);
    expect(meFetches).toBe(1);

    await handleSessionError(qc, unauthorized, meKey);
    await handleSessionError(qc, server, bundlesKey);
    expect(meFetches).toBe(1);
    unsubscribe();
  });
});
