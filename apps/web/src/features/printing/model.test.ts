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
  scaleRowOf,
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

describe("scale row of a print computer", () => {
  const at = (ms: number) => new Date(1_700_000_000_000 + ms);
  const node = (over: object) => ({ scaleConfigured: true, scaleSimulated: false, scaleLastFrameAt: at(0), scaleReportedAt: at(2_000), ...over });

  test("never reported, or no scale", () => {
    expect(scaleRowOf(node({ scaleConfigured: null, scaleReportedAt: null }))).toEqual({ kind: "unknown" });
    expect(scaleRowOf(node({ scaleConfigured: false }))).toEqual({ kind: "none" });
  });

  test("a recent frame at the time of the report is connected; an old or missing one is idle", () => {
    expect(scaleRowOf(node({}))).toMatchObject({ kind: "connected", simulated: false });
    expect(scaleRowOf(node({ scaleLastFrameAt: at(-30_000) }))).toMatchObject({ kind: "idle" });
    expect(scaleRowOf(node({ scaleLastFrameAt: null }))).toMatchObject({ kind: "idle" });
  });

  test("a simulated scale says so", () => {
    expect(scaleRowOf(node({ scaleSimulated: true }))).toMatchObject({ kind: "connected", simulated: true });
  });
});
