import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rangeStatus, buildTimeline } from "../features/bundle/timeline";
import { dedupeKey, pushScanLog, readSerial, scanLogEntry, scanMode, SCAN_LOG_SIZE } from "../features/scan/scan-flow";
import {
  offsetOf,
  PAGE_SIZE,
  pageWindow,
  pageWithinTotal,
  parseBundlesParams,
  sectionDefaultStatus,
  STATUS_FILTERS,
} from "../features/stock/bundle-search";
import { formatKgBand, transitionError } from "../features/stock/format";
import { resolveSectionPage } from "../features/stock/section-page";
import { rowTotals, sectionHeadline, sectionRows, mergeSections, type SummaryRow } from "../features/stock/sections";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("scan reads", () => {
  test("a label read as a link, a bare number or lower case is the same label to the de-duper", () => {
    expect(dedupeKey("https://orrn.in/b/26I4086?c=fourcubes")).toBe("26I4086");
    expect(dedupeKey(" 26i4086 ")).toBe("26I4086");
    expect(dedupeKey("not a serial!")).toBe("not a serial!");
  });

  test("readSerial: serial or nothing we know", () => {
    expect(readSerial("https://orrn.in/b/26I4086")).toEqual({ kind: "serial", serial: "26I4086" });
    expect(readSerial("hello world")).toEqual({ kind: "unrecognised" });
  });

  test("dispatch mode needs a dispatchId param; lookup mode otherwise", () => {
    expect(scanMode({})).toEqual({ kind: "lookup" });
    expect(scanMode({ dispatchId: "" })).toEqual({ kind: "lookup" });
    expect(scanMode({ dispatchId: "d1", code: "D-0007" })).toEqual({ kind: "dispatch", dispatchId: "d1", code: "D-0007" });
    expect(scanMode({ dispatchId: ["d1"] })).toEqual({ kind: "dispatch", dispatchId: "d1", code: null });
  });

  test("the recent list keeps the newest few, newest first", () => {
    let log: ReturnType<typeof scanLogEntry>[] = [];
    for (let i = 0; i < SCAN_LOG_SIZE + 3; i++) log = pushScanLog(log, scanLogEntry({ serial: `S${i}`, kind: "opened" }, i));
    expect(log).toHaveLength(SCAN_LOG_SIZE);
    expect(log[0]!.serial).toBe(`S${SCAN_LOG_SIZE + 2}`);
  });
});

describe("stock lists", () => {
  test("status chips: All first, then the four statuses", () => {
    expect(STATUS_FILTERS).toEqual(["all", "available", "reserved", "dispatched", "void"]);
  });

  test("params: unknown status and over-long text are dropped, arrays take the first", () => {
    expect(parseBundlesParams({ status: "void", q: " 4086 ", dieId: "d1", groupId: ["g1", "g2"] })).toEqual({
      status: "void",
      q: "4086",
      dieId: "d1",
      groupId: "g1",
    });
    expect(parseBundlesParams({ status: "nonsense", q: "   ", dieId: "x".repeat(65) })).toEqual({});
  });

  test("a section opens where its bundles are", () => {
    expect(sectionDefaultStatus("inStock")).toBe("available");
    expect(sectionDefaultStatus("held")).toBe("reserved");
    expect(sectionDefaultStatus("none")).toBe("all");
  });

  test("paging", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(offsetOf(1)).toBe(0);
    expect(offsetOf(3)).toBe(100);
    expect(pageWithinTotal(2, 120)).toBe(2);
    expect(pageWithinTotal(9, 120)).toBe(3); // a stale page goes to the last page with rows
    expect(pageWithinTotal(2, 0)).toBe(1);
    expect(pageWindow(1, 120)).toEqual({ from: 1, to: 50, hasPrev: false, hasNext: true });
    expect(pageWindow(3, 120)).toEqual({ from: 101, to: 120, hasPrev: true, hasNext: false });
    expect(pageWindow(1, 0)).toEqual({ from: 0, to: 0, hasPrev: false, hasNext: false });
  });

  test("kg/12ft band", () => {
    expect(formatKgBand(2400, 2600)).toBe("2.40-2.60");
    expect(formatKgBand(2500, 2500)).toBe("2.50");
    expect(formatKgBand(0, 0)).toBeNull();
  });

  const row = (over: Partial<SummaryRow>): SummaryRow => ({
    dieId: "d",
    dieSeries: "PATTI",
    dieSectionCode: "14701",
    dieName: null,
    bundleCount: 1,
    totalQuantity: 1,
    totalWeightG: 1000,
    totalLengthMm: 3658,
    ...over,
  });

  test("stock rows come only from in-stock and held summaries (void and dispatched never count); strings from D1 are numbers", () => {
    const rows = sectionRows(
      [row({ dieId: "a", bundleCount: "3" as unknown as number, totalWeightG: "150000" as unknown as number })],
      [row({ dieId: "a", bundleCount: 1, totalWeightG: 40_000 })],
      { query: "", sort: "kg" },
    );
    expect(rows).toHaveLength(1);
    expect(rowTotals(rows)).toEqual({ bundles: 3, weightG: 150_000, held: 1, heldWeightG: 40_000 });
  });

  test("headline colour: green in stock, blue when all held, neutral when empty", () => {
    const [s] = mergeSections([row({ dieId: "a" })], []);
    expect(sectionHeadline(s).tone).toBe("green");
    const [h] = mergeSections([], [row({ dieId: "a" })]);
    expect(sectionHeadline(h).tone).toBe("blue");
    expect(sectionHeadline(undefined).tone).toBe("neutral");
  });

  test("a section page for a deleted die still has a header from its stock", () => {
    const [stock] = mergeSections([row({ dieId: "a", dieWeightMinG: 2400, dieWeightMaxG: 2600 })], []);
    const state = resolveSectionPage({ die: null, dieFailed: false, stock, summaryReady: true, probe: undefined });
    expect(state).toMatchObject({ kind: "ready", header: { label: "PATTI 14701", dieListed: false } });
    expect(resolveSectionPage({ die: null, dieFailed: false, stock: undefined, summaryReady: true, probe: { total: 0 } })).toEqual({ kind: "notFound" });
  });
});

describe("bundle page", () => {
  test("kg/12ft against the die's band; edges count as in range", () => {
    expect(rangeStatus(2.5, 2400, 2600)).toBe("inRange");
    expect(rangeStatus(2.4, 2400, 2600)).toBe("inRange");
    expect(rangeStatus(2.3, 2400, 2600)).toBe("below");
    expect(rangeStatus(2.7, 2400, 2600)).toBe("above");
    expect(rangeStatus(null, 2400, 2600)).toBe("noRange");
    expect(rangeStatus(2.5, 0, 0)).toBe("noRange");
  });

  test("a refused void or restore says the bundle changed; a hold is named; permission is its own message", () => {
    expect(transitionError({ data: { code: "FORBIDDEN" } })).toEqual({ key: "stock.noPermission" });
    expect(transitionError({ data: { code: "CONFLICT" } })).toEqual({ key: "bundle.changedElsewhere" });
    expect(transitionError({ data: { code: "BAD_REQUEST" }, message: "Bundle is held by D-0007" })).toEqual({
      key: "scan.continuous.heldBy",
      vars: { code: "D-0007" },
    });
    expect(transitionError({ data: { code: "BAD_REQUEST" }, message: "Transition void -> void is not allowed" })).toEqual({ key: "bundle.changedElsewhere" });
    expect(transitionError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toEqual({ key: "bundle.transitionFailed" });
  });

  test("a restored bundle shows Restored with the reason typed on the void kept as a note", () => {
    const entries = buildTimeline(
      [
        { id: "2", fromStatus: "void", toStatus: "available", reason: "Counted wrong", dispatchId: null, at: "2026-10-05T05:00:00Z" },
        { id: "1", fromStatus: null, toStatus: "available", reason: "receipt", dispatchId: null, at: "2026-10-01T05:00:00Z" },
      ],
      { createdAt: "2026-10-01T05:00:00Z" },
    );
    expect(entries.map((e) => [e.kind, e.note])).toEqual([["restored", "Counted wrong"], ["packed", null]]);
  });

  test("void and restore are behind bundle.void, add to dispatch behind dispatch.addBundle, and reprint behind spool.create_jobs (BACKLOG 5, E6 Native)", () => {
    const screen = read("features/bundle/bundle-screen.tsx");
    expect(screen).toMatch(/can\(me, "bundle\.void"\)/);
    expect(screen).toMatch(/can\(me, "dispatch\.addBundle"\)/);
    expect(screen).toMatch(/can\(me, "spool\.create_jobs"\)/);
    expect(screen).toMatch(/printBundleLabel/);
    expect(read("features/bundle/transition-sheet.tsx")).toMatch(/writeFailureKind\(/);
    expect(read("features/bundle/add-to-dispatch-sheet.tsx")).toMatch(/addBundlesBySerial/);
  });

  test("the scan tab reads search params dispatchId and code, and sends Done back to the dispatch", () => {
    const view = read("features/scan/scan-view.tsx");
    expect(view).toMatch(/useLocalSearchParams/);
    expect(view).toMatch(/useIsFocused/);
    expect(view).toMatch(/Linking\.openSettings/);
    expect(view).toMatch(/addBundlesBySerial/);
  });
});
