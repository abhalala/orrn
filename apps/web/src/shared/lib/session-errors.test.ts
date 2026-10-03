import { describe, expect, test } from "bun:test";

import {
  isClientError,
  isImpersonationForbidden,
  isNotFound,
  isUnauthorized,
  shouldRetryQuery,
} from "./session-errors";

const trpcErr = (code: string, httpStatus: number, message = "x") => ({ message, data: { code, httpStatus } });

describe("session error classification", () => {
  test("recognises UNAUTHORIZED", () => {
    expect(isUnauthorized(trpcErr("UNAUTHORIZED", 401))).toBe(true);
    expect(isUnauthorized(trpcErr("FORBIDDEN", 403))).toBe(false);
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
  });

  test("recognises the impersonation grant FORBIDDEN by its server message", () => {
    expect(
      isImpersonationForbidden(trpcErr("FORBIDDEN", 403, "Invalid, expired, or revoked impersonation grant")),
    ).toBe(true);
    expect(isImpersonationForbidden(trpcErr("FORBIDDEN", 403, "Company access required"))).toBe(false);
    expect(isImpersonationForbidden(trpcErr("UNAUTHORIZED", 401, "Invalid, expired, or revoked impersonation grant"))).toBe(false);
  });

  test("4xx is a client error, 5xx and network errors are not", () => {
    expect(isClientError(trpcErr("BAD_REQUEST", 400))).toBe(true);
    expect(isClientError(trpcErr("NOT_FOUND", 404))).toBe(true);
    expect(isClientError(trpcErr("INTERNAL_SERVER_ERROR", 500))).toBe(false);
    expect(isClientError(new TypeError("Failed to fetch"))).toBe(false);
  });

  test("retry: never on 4xx, up to 3 times otherwise", () => {
    expect(shouldRetryQuery(0, trpcErr("UNAUTHORIZED", 401))).toBe(false);
    expect(shouldRetryQuery(0, trpcErr("FORBIDDEN", 403))).toBe(false);
    expect(shouldRetryQuery(0, trpcErr("INTERNAL_SERVER_ERROR", 500))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("isNotFound", () => {
  test("is true only for a tRPC NOT_FOUND", () => {
    expect(isNotFound({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(isNotFound({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isNotFound(new Error("Not found"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
