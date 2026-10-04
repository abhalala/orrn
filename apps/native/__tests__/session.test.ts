import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";

import {
  companyIdOf,
  handleSessionError,
  isAuthMeQueryKey,
  isUnauthorized,
  ME_QUERY_KEY,
  resetAfterSignOut,
  resetTenantQueries,
  shouldResetForCompany,
  shouldRetryQuery,
  watchCompanyChanges,
} from "../lib/session";

const ROOT = join(import.meta.dir, "..");
/** TanStack notifies cache listeners on a 0 ms timer; let it flush. */
const flush = () => new Promise((r) => setTimeout(r, 10));

const meKey: QueryKey = [["auth", "me"], { type: "query" }];
const bundlesKey: QueryKey = [["bundle", "list"], { input: { limit: 20 }, type: "query" }];

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
    expect<unknown>(qc.getQueryData(meKey)).toEqual({ company: { id: "c1" } });
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
    expect<unknown>(qc.getQueryData(bundlesKey)).toEqual(["c2-bundle"]);
    unsubscribe();
  });
});

describe("tenant cache guard (N10, AGENTS.md: do not delete)", () => {
  test("shouldResetForCompany: only a real change after a known company", () => {
    expect(shouldResetForCompany(undefined, "c1")).toBe(false);
    expect(shouldResetForCompany("c1", "c1")).toBe(false);
    expect(shouldResetForCompany("c1", "c2")).toBe(true);
    expect(shouldResetForCompany("c1", null)).toBe(true);
    expect(shouldResetForCompany(null, "c1")).toBe(true);
  });

  test("companyIdOf reads auth.me data defensively", () => {
    expect(companyIdOf({ company: { id: "c1" } })).toBe("c1");
    expect(companyIdOf({ company: null })).toBeNull();
    expect(companyIdOf(undefined)).toBeNull();
  });

  test("auth.me reporting another plant drops the previous plant's rows but keeps auth.me", async () => {
    const qc = seeded();
    const stop = watchCompanyChanges(qc);
    qc.setQueryData(meKey, { company: { id: "c2" } });
    await flush();
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
    expect<unknown>(qc.getQueryData(meKey)).toEqual({ company: { id: "c2" } });
    stop();
  });

  test("the same plant refetched keeps every row", async () => {
    const qc = seeded();
    const stop = watchCompanyChanges(qc);
    qc.setQueryData(meKey, { company: { id: "c1" } });
    await flush();
    expect<unknown>(qc.getQueryData(bundlesKey)).toEqual(["b1", "b2"]);
    stop();
  });

  test("the first auth.me after a cold start is not a switch", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(bundlesKey, ["b1"]);
    const stop = watchCompanyChanges(qc);
    qc.setQueryData(meKey, { company: { id: "c1" } });
    await flush();
    expect<unknown>(qc.getQueryData(bundlesKey)).toEqual(["b1"]);
    stop();
  });

  test("other queries succeeding never trigger a reset", async () => {
    const qc = seeded();
    const stop = watchCompanyChanges(qc);
    qc.setQueryData([["die", "list"], { type: "query" }], { company: { id: "c9" } });
    await flush();
    expect<unknown>(qc.getQueryData(bundlesKey)).toEqual(["b1", "b2"]);
    stop();
  });

  test("after stop() nothing is watched", async () => {
    const qc = seeded();
    watchCompanyChanges(qc)();
    qc.setQueryData(meKey, { company: { id: "c2" } });
    await flush();
    expect<unknown>(qc.getQueryData(bundlesKey)).toEqual(["b1", "b2"]);
  });

  test("the guard is mounted in the root layout and runs watchCompanyChanges on the app's QueryClient", () => {
    expect(readFileSync(join(ROOT, "app/_layout.tsx"), "utf8")).toMatch(/<TenantCacheGuard \/>/);
    expect(readFileSync(join(ROOT, "components/tenant-cache-guard.tsx"), "utf8")).toMatch(/watchCompanyChanges\(queryClient\)/);
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
