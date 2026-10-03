import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearImpersonation,
  getImpersonation,
  hasStoredImpersonation,
  setImpersonation,
} from "./impersonation";

const KEY = "orrn:impersonate-company-id";

function installFakeSessionStorage() {
  const data = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
  return data;
}

describe("impersonation storage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installFakeSessionStorage();
  });

  test("round-trips an unexpired grant", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    setImpersonation("co_1", expiresAt);
    expect(getImpersonation()).toEqual({ companyId: "co_1", expiresAt: Date.parse(expiresAt) });
  });

  test("drops and clears an expired grant", () => {
    setImpersonation("co_1", new Date(Date.now() - 1_000).toISOString());
    expect(getImpersonation()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  test("expiry is evaluated against the supplied clock", () => {
    const at = Date.parse("2026-10-03T10:00:00.000Z");
    setImpersonation("co_1", "2026-10-03T10:30:00.000Z");
    expect(getImpersonation(at)?.companyId).toBe("co_1");
    expect(getImpersonation(at + 31 * 60_000)).toBeNull();
  });

  test("corrupt values are dropped instead of trapping the app", () => {
    for (const bad of ["not json", "{", "null", "42", '{"companyId":1}', '{"companyId":"c"}', '{"companyId":"c","expiresAt":"x"}', "co_legacy_plain_id"]) {
      store.set(KEY, bad);
      expect(getImpersonation()).toBeNull();
      expect(store.has(KEY)).toBe(false);
    }
  });

  test("an unparseable expiry is rejected at write time", () => {
    setImpersonation("co_1", "never");
    expect(store.has(KEY)).toBe(false);
  });

  test("clear removes the stored grant", () => {
    setImpersonation("co_1", new Date(Date.now() + 60_000).toISOString());
    expect(hasStoredImpersonation()).toBe(true);
    clearImpersonation();
    expect(hasStoredImpersonation()).toBe(false);
    expect(getImpersonation()).toBeNull();
  });

  test("returns null when storage is unavailable", () => {
    (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage = undefined;
    expect(getImpersonation()).toBeNull();
    expect(() => clearImpersonation()).not.toThrow();
  });
});
