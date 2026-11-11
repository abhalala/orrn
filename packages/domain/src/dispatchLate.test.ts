import { describe, expect, test } from "bun:test";

import { LATE_DISPATCH_MAX_MS, lateDispatchGate } from "./dispatchLate";

const NOW = Date.UTC(2026, 10, 10, 6, 0);
const H = 60 * 60 * 1000;

describe("lateDispatchGate (arch 52)", () => {
  test("up to 72 hours back with a reason is allowed; exactly 72 h too", () => {
    expect(lateDispatchGate(NOW - 5 * H, "Line down, paper PL", NOW)).toEqual({ kind: "ok" });
    expect(lateDispatchGate(NOW - LATE_DISPATCH_MAX_MS, "Line down", NOW)).toEqual({ kind: "ok" });
  });
  test("more than 72 hours back is refused", () => {
    expect(lateDispatchGate(NOW - LATE_DISPATCH_MAX_MS - 1, "Line down", NOW)).toEqual({ kind: "tooOld" });
  });
  test("the future is refused, beyond a 2 minute clock skew", () => {
    expect(lateDispatchGate(NOW + 2 * 60 * 1000, "Line down", NOW)).toEqual({ kind: "ok" });
    expect(lateDispatchGate(NOW + 2 * 60 * 1000 + 1, "Line down", NOW)).toEqual({ kind: "future" });
  });
  test("a reason is needed (3 letters at least, spaces do not count)", () => {
    expect(lateDispatchGate(NOW - H, "  ab ", NOW)).toEqual({ kind: "noReason" });
  });
});
