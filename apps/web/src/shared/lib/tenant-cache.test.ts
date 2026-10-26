import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { dropTenantQueries, isAuthMeQueryKey } from "./tenant-cache";

// tRPC's TanStack integration keys look like [["auth","me"], { type: "query" }].
const ME_KEY = [["auth", "me"], { type: "query" }];
const DIES_KEY = [["die", "list"], { input: {}, type: "query" }];
const BUNDLES_KEY = [["bundle", "list"], { type: "query" }];

describe("tenant cache", () => {
  test("isAuthMeQueryKey only matches auth.me", () => {
    expect(isAuthMeQueryKey(ME_KEY)).toBe(true);
    expect(isAuthMeQueryKey(DIES_KEY)).toBe(false);
    expect(isAuthMeQueryKey([["auth", "setPassword"]])).toBe(false);
    expect(isAuthMeQueryKey("auth")).toBe(false);
    expect(isAuthMeQueryKey(undefined)).toBe(false);
  });

  test("dropTenantQueries removes every query except auth.me", () => {
    const qc = new QueryClient();
    qc.setQueryData(ME_KEY, { user: { id: "u" } });
    qc.setQueryData(DIES_KEY, [1]);
    qc.setQueryData(BUNDLES_KEY, [2]);
    dropTenantQueries(qc);
    expect(qc.getQueryData(ME_KEY)).toEqual({ user: { id: "u" } });
    expect(qc.getQueryData(DIES_KEY)).toBeUndefined();
    expect(qc.getQueryData(BUNDLES_KEY)).toBeUndefined();
  });
});
