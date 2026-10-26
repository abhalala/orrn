import { describe, expect, test } from "bun:test";

import { backoffMs, isRepeatSafe, retryDecision } from "../tests/e2e/helpers/resilient-policy";

const API = "http://localhost:3360";

describe("e2e API retry policy", () => {
  test("reads and sign-in repeat after a dropped socket or a 5xx", () => {
    for (const error of [new Error("apiRequestContext.fetch: read ECONNRESET"), new Error("socket hang up")]) {
      expect(retryDecision({ method: "GET", url: `${API}/trpc/orders.list`, attempt: 1, error }).retry).toBe(true);
      expect(retryDecision({ method: "POST", url: `${API}/api/auth/sign-in/email`, attempt: 1, error }).retry).toBe(true);
    }
    for (const status of [500, 502, 503, 504]) {
      expect(retryDecision({ method: "GET", url: `${API}/trpc/orders.list`, attempt: 1, status }).retry).toBe(true);
      expect(retryDecision({ method: "POST", url: `${API}/api/auth/sign-in/email`, attempt: 1, status }).retry).toBe(true);
    }
  });

  test("a write is only repeated when the worker did not take it (503, refused connection), never after a reset or a 500", () => {
    const url = `${API}/trpc/orders.create`;
    expect(retryDecision({ method: "POST", url, attempt: 1, status: 503 }).retry).toBe(true);
    expect(retryDecision({ method: "POST", url, attempt: 1, error: new Error("connect ECONNREFUSED 127.0.0.1:3360") }).retry).toBe(true);
    expect(retryDecision({ method: "POST", url, attempt: 1, error: new Error("read ECONNRESET") }).retry).toBe(false);
    expect(retryDecision({ method: "POST", url, attempt: 1, status: 500 }).retry).toBe(false);
  });

  test("the app's own answers are never repeated", () => {
    for (const status of [200, 400, 401, 403, 404, 409, 422]) {
      expect(retryDecision({ method: "GET", url: `${API}/trpc/x`, attempt: 1, status }).retry).toBe(false);
      expect(retryDecision({ method: "POST", url: `${API}/api/auth/sign-in/email`, attempt: 1, status }).retry).toBe(false);
    }
    expect(retryDecision({ method: "GET", url: `${API}/trpc/x`, attempt: 1, error: new Error("Invalid URL") }).retry).toBe(false);
  });

  test("it gives up after five attempts, with a backoff that stays short", () => {
    expect(retryDecision({ method: "GET", url: `${API}/x`, attempt: 5, status: 503 }).retry).toBe(false);
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([300, 600, 1200, 2400]);
    expect(isRepeatSafe("post", `${API}/dev/seed`)).toBe(true);
    expect(isRepeatSafe("POST", `${API}/api/auth/sign-up/email`)).toBe(false);
  });
});
