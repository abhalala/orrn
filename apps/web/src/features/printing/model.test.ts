import { describe, expect, test } from "bun:test";

import {
  canRetry,
  collectorRowsOf,
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
    expect(parsePrintStatus("accepted")).toBe("accepted");
    expect(parsePrintStatus("outcome_unknown")).toBe("outcome_unknown");
    expect(parsePrintStatus("cancelled")).toBe("cancelled");
    expect(parsePrintStatus("done")).toBeUndefined();
  });

  test("page parsing accepts only whole pages after the first", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(2)).toBe(2);
    expect(parsePage("1")).toBeUndefined();
    expect(parsePage("2.5")).toBeUndefined();
    expect(parsePage("x")).toBeUndefined();
  });

  test("terminal and ambiguous jobs can be retried as new attempts", () => {
    for (const s of ["failed", "outcome_unknown", "sent", "cancelled"] as const) expect(canRetry(s)).toBe(true);
    for (const s of ["queued", "accepted", "success"] as const) expect(canRetry(s)).toBe(false);
  });

  test("tones", () => {
    expect(printJobTone("failed")).toBe("red");
    expect(printJobTone("success")).toBe("green");
    expect(printJobTone("accepted")).toBe("amber");
    expect(printJobTone("outcome_unknown")).toBe("red");
    expect(printJobTone("cancelled")).toBe("neutral");
    expect(nodeTone("offline")).toBe("red");
    expect(nodeTone("revoked")).toBe("neutral");
  });

  test("summary keeps unknown outcomes visible", () => {
    expect(queueSummary({ queued: 2, accepted: 1, sent: 5, success: 40, failed: 1, outcome_unknown: 3, cancelled: 2 })).toEqual({ failed: 1, waiting: 2, unknown: 3, clear: false });
    expect(queueSummary({ queued: 0, accepted: 0, sent: 3, success: 9, failed: 0, outcome_unknown: 0, cancelled: 0 }).clear).toBe(true);
    expect(queueSummary({ queued: 0, accepted: 0, sent: 3, success: 9, failed: 0, outcome_unknown: 1, cancelled: 0 }).clear).toBe(false);
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

describe("collectors row of a print computer", () => {
  const at = (ms: number) => new Date(1_700_000_000_000 + ms).toISOString();
  const press = (over: object = {}) => ({
    kind: "press" as const,
    line: "P1",
    source: "sim",
    configured: true,
    simulated: true,
    connected: true,
    lastFrameAt: at(-5_000),
    backlog: 0,
    lastError: null,
    ...over,
  });

  test("never reported, or nothing configured", () => {
    expect(collectorRowsOf({ collectors: null, collectorsReportedAt: null })).toEqual({ kind: "unknown" });
    expect(collectorRowsOf({ collectors: [], collectorsReportedAt: at(0) })).toMatchObject({ kind: "none" });
  });

  test("a simulated press collector stays simulated; fresh frame = sending, old = quiet", () => {
    const rows = collectorRowsOf({ collectors: [press(), press({ simulated: false, source: "modbus", lastFrameAt: at(-61_000) })], collectorsReportedAt: at(0) });
    expect(rows.kind).toBe("list");
    if (rows.kind !== "list") return;
    expect(rows.items[0]).toMatchObject({ kind: "press", simulated: true, state: "sending" });
    expect(rows.items[1]).toMatchObject({ simulated: false, source: "modbus", state: "quiet" });
  });

  test("spectro watcher: watching when the folder is reachable; not set up wins", () => {
    const spectro = { ...press(), kind: "spectro" as const, line: null, source: "watch_dir", lastFrameAt: null };
    const rows = collectorRowsOf({ collectors: [spectro, { ...spectro, connected: false, lastError: "folder missing" }, { ...spectro, configured: false }], collectorsReportedAt: at(0) });
    if (rows.kind !== "list") throw new Error("list expected");
    expect(rows.items.map((i) => i.state)).toEqual(["watching", "quiet", "not_configured"]);
    expect(rows.items[1]!.lastError).toBe("folder missing");
  });
});
