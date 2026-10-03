import { describe, expect, test } from "bun:test";

import { formatKgBand, formatWhen, reprintErrorKey, transitionError } from "./format";

const NOW = Date.parse("2026-10-03T12:00:00Z");

describe("formatWhen", () => {
  test("d MMM and 24h time in the company timezone, no year in the current year", () => {
    // 21:00 UTC on 2 Oct is 02:30 IST on 3 Oct.
    expect(formatWhen("2026-10-02T21:00:00Z", { locale: "en", timeZone: "Asia/Kolkata", now: NOW })).toBe("3 Oct, 02:30");
  });

  test("adds the year for another year", () => {
    expect(formatWhen("2025-12-31T06:00:00Z", { locale: "en", timeZone: "Asia/Kolkata", now: NOW })).toBe(
      "31 Dec 2025, 11:30",
    );
  });

  test("an unknown timezone falls back to the device instead of throwing", () => {
    expect(() => formatWhen(NOW, { locale: "en", timeZone: "Mars/Olympus", now: NOW })).not.toThrow();
  });

  test("Hindi keeps Latin digits", () => {
    expect(formatWhen("2026-10-02T21:00:00Z", { locale: "hi", timeZone: "Asia/Kolkata", now: NOW })).toMatch(/3 .*02:30/);
  });
});

describe("formatKgBand", () => {
  test("die band in grams per 12 ft shown as kg", () => {
    expect(formatKgBand(2_400, 2_600)).toBe("2.40-2.60");
  });
  test("no band set", () => {
    expect(formatKgBand(0, 0)).toBeNull();
  });
  test("a single value when min equals max", () => {
    expect(formatKgBand(2_500, 2_500)).toBe("2.50");
  });
});

const trpcError = (code: string, message: string) => ({ message, data: { code, httpStatus: 400 } });

describe("reprintErrorKey", () => {
  test("no label printer set up", () => {
    expect(reprintErrorKey(trpcError("NOT_FOUND", "Bundle printer profile not found"))).toBe("stock.reprintNoPrinter");
    expect(reprintErrorKey(trpcError("BAD_REQUEST", "Bundle label template is not pushed to spool yet"))).toBe(
      "stock.reprintNoPrinter",
    );
    expect(reprintErrorKey(trpcError("NOT_FOUND", "No active spool deployment for this company"))).toBe("stock.reprintNoPrinter");
  });
  test("the print station didn't take the job", () => {
    expect(reprintErrorKey(trpcError("BAD_GATEWAY", "Failed to submit print job: timeout"))).toBe("stock.reprintFailed");
  });
  test("no permission", () => {
    expect(reprintErrorKey(trpcError("FORBIDDEN", "Forbidden"))).toBe("stock.noPermission");
  });
  test("anything else", () => {
    expect(reprintErrorKey(new Error("boom"))).toBe("stock.reprintFailed");
  });
});

describe("transitionError (void or restore refused)", () => {
  test("no permission", () => {
    expect(transitionError(trpcError("FORBIDDEN", "Forbidden"))).toEqual({ key: "stock.noPermission" });
  });
  test("held by a dispatch since the page loaded: say which one, in the UI language", () => {
    expect(transitionError(trpcError("BAD_REQUEST", "Bundle is held by D-0007"))).toEqual({
      key: "scan.continuous.heldBy",
      vars: { code: "D-0007" },
    });
  });
  test("dispatched since the page loaded", () => {
    expect(transitionError(trpcError("BAD_REQUEST", "Bundle is already dispatched"))).toEqual({
      key: "scan.continuous.dispatched",
    });
  });
  test("someone else already voided or restored it: never the server's English", () => {
    expect(transitionError(trpcError("BAD_REQUEST", 'Bundle is already in status "void"'))).toEqual({
      key: "bundle.changedElsewhere",
    });
    expect(
      transitionError(trpcError("BAD_REQUEST", "Transition reserved -> void is not allowed in M4. Dispatch transitions are managed by the dispatch flow.")),
    ).toEqual({ key: "bundle.changedElsewhere" });
  });
  test("anything else", () => {
    expect(transitionError(new Error("boom"))).toEqual({ key: "bundle.transitionFailed" });
  });
});
