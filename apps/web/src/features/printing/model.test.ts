import { describe, expect, test } from "bun:test";

import {
  canRetry,
  nodeTone,
  parsePage,
  parsePrintStatus,
  parsePrintTab,
  printJobTone,
  queueSummary,
  reprintTarget,
} from "./model";

describe("printing model", () => {
  test("tab and status parsing fall back safely", () => {
    expect(parsePrintTab("printers")).toBe("printers");
    expect(parsePrintTab("data")).toBe("queue");
    expect(parsePrintTab(undefined)).toBe("queue");
    expect(parsePrintStatus("failed")).toBe("failed");
    expect(parsePrintStatus("done")).toBeUndefined();
  });

  test("page parsing accepts only whole pages after the first", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(2)).toBe(2);
    expect(parsePage("1")).toBeUndefined();
    expect(parsePage("2.5")).toBeUndefined();
    expect(parsePage("x")).toBeUndefined();
  });

  test("only a failed job can be sent again", () => {
    expect(canRetry("failed")).toBe(true);
    for (const s of ["queued", "sent", "success"] as const) expect(canRetry(s)).toBe(false);
  });

  test("tones", () => {
    expect(printJobTone("failed")).toBe("red");
    expect(printJobTone("success")).toBe("green");
    expect(nodeTone("offline")).toBe("red");
    expect(nodeTone("revoked")).toBe("neutral");
  });

  test("summary counts failed and waiting only", () => {
    expect(queueSummary({ queued: 2, sent: 5, success: 40, failed: 1 })).toEqual({ failed: 1, waiting: 2, clear: false });
    expect(queueSummary({ queued: 0, sent: 3, success: 9, failed: 0 }).clear).toBe(true);
  });

  test("reprint target is the trimmed bundle number", () => {
    expect(reprintTarget("  26I4086 ")).toBe("26I4086");
    expect(reprintTarget("   ")).toBeNull();
    expect(reprintTarget("x".repeat(65))).toBeNull();
  });
});
