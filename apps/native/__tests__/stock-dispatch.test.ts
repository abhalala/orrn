import { describe, expect, test } from "bun:test";

import { buildTimeline } from "../features/bundle/timeline";
import { dispatchNow } from "../features/dispatch/dispatch-now";
import { DISPATCH_TABS, dispatchTab } from "../features/dispatch/tabs";
import { groupItems, itemLabel, dispatchTotals } from "../features/dispatch/group-items";
import { addPastedSerials, mergeReports, PASTE_CHUNK } from "../features/dispatch/paste";
import { shipDateChoice, shipDateFromChoice } from "../features/dispatch/ship-date";
import { sectionRows, type SummaryRow } from "../features/stock/sections";
import { bySerial } from "../lib/format";

const summary = (over: Partial<SummaryRow>): SummaryRow => ({
  dieId: "d1",
  dieSeries: "PATTI",
  dieSectionCode: "14701",
  dieName: null,
  bundleCount: 1,
  totalQuantity: 10,
  totalWeightG: 50_000,
  totalLengthMm: 3658,
  ...over,
});

describe("stock sections", () => {
  const available = [
    summary({ dieId: "a", dieSectionCode: "14701", bundleCount: 3, totalWeightG: 150_000 }),
    summary({ dieId: "b", dieSectionCode: "2207", dieSeries: "ANGLE", bundleCount: 9, totalWeightG: 900_000 }),
  ];
  const reserved = [summary({ dieId: "a", bundleCount: 2, totalWeightG: 100_000 }), summary({ dieId: "c", dieSectionCode: "999", bundleCount: 1 })];

  test("one row per die with available bundles, with the held count beside it", () => {
    const rows = sectionRows(available, reserved, { query: "", sort: "kg" });
    expect(rows.map((r) => [r.dieId, r.bundles, r.held])).toEqual([
      ["b", 9, 0],
      ["a", 3, 2],
      ["c", 0, 1],
    ]);
  });

  test("sort A to Z is natural on the section code", () => {
    const rows = sectionRows(available, [], { query: "", sort: "az" });
    expect(rows.map((r) => r.code)).toEqual(["2207", "14701"]);
  });

  test("search matches section, series or name, case-insensitively", () => {
    expect(sectionRows(available, reserved, { query: "angle", sort: "kg" }).map((r) => r.dieId)).toEqual(["b"]);
    expect(sectionRows(available, reserved, { query: "147", sort: "kg" }).map((r) => r.dieId)).toEqual(["a"]);
  });
});

describe("plant serials sort in packing order, not text order (T20-quality gotcha)", () => {
  test("26J2 before 26J10", () => {
    expect(["26J10", "26J2", "26J1", "26J11"].sort(bySerial)).toEqual(["26J1", "26J2", "26J10", "26J11"]);
  });
});

describe("bundle history", () => {
  const created = "2026-10-01T05:00:00Z";
  test("newest first, with plain words for each change and only human reasons as notes", () => {
    const entries = buildTimeline(
      [
        { id: "1", fromStatus: null, toStatus: "available", reason: "receipt", dispatchId: null, at: "2026-10-01T05:00:00Z" },
        { id: "2", fromStatus: "available", toStatus: "reserved", reason: "dispatch.reserve", dispatchId: "d1", at: "2026-10-02T05:00:00Z" },
        { id: "3", fromStatus: "reserved", toStatus: "available", reason: "dispatch.unreserve", dispatchId: "d1", at: "2026-10-03T05:00:00Z" },
        { id: "4", fromStatus: "available", toStatus: "void", reason: "Packed twice", dispatchId: null, at: "2026-10-04T05:00:00Z" },
        { id: "5", fromStatus: "void", toStatus: "available", reason: null, dispatchId: null, at: "2026-10-05T05:00:00Z" },
      ],
      { createdAt: created },
    );
    expect(entries.map((e) => [e.kind, e.note])).toEqual([
      ["restored", null],
      ["voided", "Packed twice"],
      ["released", null],
      ["held", null],
      ["packed", null],
    ]);
  });

  test("old data with no pack event still starts with Packed at creation", () => {
    const entries = buildTimeline([], { createdAt: created });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("packed");
    expect(entries[0]!.at.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });
});

const item = (over: Record<string, unknown>) => ({
  itemId: "i",
  bundleId: "b",
  serial: "S",
  status: "available" as const,
  quantity: 10,
  weightG: 50_000,
  lengthMm: 3658,
  groupId: "g",
  groupLabel: null as string | null,
  dieId: "d1",
  dieSeries: "PATTI",
  dieSectionCode: "14701",
  ...over,
});

describe("dispatch items grouped like the packing list", () => {
  test("labelled groups first, then sections in natural order, with subtotals", () => {
    const groups = groupItems([
      item({ itemId: "1", dieId: "d2", dieSectionCode: "2207", dieSeries: "ANGLE" }),
      item({ itemId: "2" }),
      item({ itemId: "3", groupLabel: "A", weightG: 20_000, quantity: 4 }),
      item({ itemId: "4", weightG: 10_000, quantity: 2 }),
    ]);
    expect(groups.map((g) => [g.label, g.bundles.length, g.weightG, g.pieces])).toEqual([
      ["A", 1, 20_000, 4],
      ["2207 ANGLE", 1, 50_000, 10],
      ["14701 PATTI", 2, 60_000, 12],
    ]);
  });

  test("item label is section code plus name, else series", () => {
    expect(itemLabel({ dieSectionCode: "14701", dieSeries: "PATTI", dieName: "Patti 1" })).toBe("14701 Patti 1");
    expect(itemLabel({ dieSectionCode: "14701", dieSeries: "PATTI" })).toBe("14701 PATTI");
  });

  test("totals", () => {
    expect(dispatchTotals([item({}), item({ weightG: 1_000, quantity: 1 })])).toEqual({ bundles: 2, weightG: 51_000, pieces: 11 });
  });
});

describe("dispatch status tabs", () => {
  test("Building, Held, Dispatched, Cancelled map to the server statuses", () => {
    expect(DISPATCH_TABS).toEqual(["draft", "reserved", "completed", "cancelled"]);
    expect(dispatchTab(undefined)).toBe("draft");
    expect(dispatchTab("completed")).toBe("completed");
    expect(dispatchTab("nonsense")).toBe("draft");
  });
});

describe("Dispatch from Building holds first, then completes (ruling T22)", () => {
  test("draft: reserve then complete; a retry after a failed complete does not hold again", async () => {
    const calls: string[] = [];
    let failComplete = true;
    const api = {
      reserve: async () => void calls.push("reserve"),
      complete: async () => {
        calls.push("complete");
        if (failComplete) throw new Error("boom");
      },
    };
    const state = { held: false };
    await expect(dispatchNow("draft", state, api)).rejects.toThrow("boom");
    failComplete = false;
    await dispatchNow("draft", state, api);
    expect(calls).toEqual(["reserve", "complete", "complete"]);
  });

  test("held: complete only; other states refuse", async () => {
    const calls: string[] = [];
    const api = { reserve: async () => void calls.push("reserve"), complete: async () => void calls.push("complete") };
    await dispatchNow("reserved", { held: false }, api);
    expect(calls).toEqual(["complete"]);
    await expect(dispatchNow("completed", { held: false }, api)).rejects.toThrow();
  });
});

describe("paste serials", () => {
  test("sends at most 100 serials per request (server cap) and merges the reports", async () => {
    const sent: number[] = [];
    const serials = Array.from({ length: 230 }, (_, i) => `S${i}`);
    const out = await addPastedSerials(serials, async (chunk) => {
      sent.push(chunk.length);
      return { added: chunk.slice(0, 1), alreadyInDispatch: [], notFound: chunk.slice(1, 2), unavailable: [] };
    });
    expect(PASTE_CHUNK).toBe(100);
    expect(sent).toEqual([100, 100, 30]);
    expect(out.report.added).toEqual(["S0", "S100", "S200"]);
    expect(out.report.notFound).toEqual(["S1", "S101", "S201"]);
    expect(out.failedAt).toBeNull();
  });

  test("a failed chunk stops and says which serials were not sent", async () => {
    const serials = Array.from({ length: 150 }, (_, i) => `S${i}`);
    let n = 0;
    const out = await addPastedSerials(serials, async (chunk) => {
      if (n++ === 1) throw new Error("offline");
      return { added: chunk, alreadyInDispatch: [], notFound: [], unavailable: [] };
    });
    expect(out.report.added).toHaveLength(100);
    expect(out.failedAt).toBe(100);
    expect(out.error).toBeInstanceOf(Error);
  });

  test("mergeReports concatenates every list", () => {
    expect(
      mergeReports(
        { added: ["a"], alreadyInDispatch: ["b"], notFound: [], unavailable: [{ serial: "c", reason: "r" }] },
        { added: ["d"], alreadyInDispatch: [], notFound: ["e"], unavailable: [] },
      ),
    ).toEqual({ added: ["a", "d"], alreadyInDispatch: ["b"], notFound: ["e"], unavailable: [{ serial: "c", reason: "r" }] });
  });
});

describe("ship date (stored as UTC midnight of the calendar day)", () => {
  const now = new Date(2026, 9, 6, 22, 30); // 6 Oct 2026, 22:30 local
  test("chips", () => {
    expect(shipDateFromChoice({ kind: "none" }, now)).toBeNull();
    expect(shipDateFromChoice({ kind: "today" }, now)).toBe(Date.UTC(2026, 9, 6));
    expect(shipDateFromChoice({ kind: "tomorrow" }, now)).toBe(Date.UTC(2026, 9, 7));
  });

  test("typed DD-MM-YYYY (also / or .), real days only", () => {
    expect(shipDateFromChoice({ kind: "typed", text: "15-10-2026" }, now)).toBe(Date.UTC(2026, 9, 15));
    expect(shipDateFromChoice({ kind: "typed", text: "1/1/2027" }, now)).toBe(Date.UTC(2027, 0, 1));
    expect(shipDateFromChoice({ kind: "typed", text: "31-02-2026" }, now)).toBeUndefined();
    expect(shipDateFromChoice({ kind: "typed", text: "tomorrow" }, now)).toBeUndefined();
  });

  test("an existing date reads back as the matching chip or typed text", () => {
    expect(shipDateChoice(null, now)).toEqual({ kind: "none" });
    expect(shipDateChoice(Date.UTC(2026, 9, 7), now)).toEqual({ kind: "tomorrow" });
    expect(shipDateChoice(Date.UTC(2026, 11, 25), now)).toEqual({ kind: "typed", text: "25-12-2026" });
  });
});
