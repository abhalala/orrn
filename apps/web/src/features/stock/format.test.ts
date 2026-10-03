import { describe, expect, test } from "bun:test";

import { addOutcome, formatKgBand, formatWhen, reprintErrorKey } from "./format";

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

describe("addOutcome (one bundle into a dispatch)", () => {
  const base = { added: [], alreadyInDispatch: [], notFound: [], unavailable: [] };
  test("added", () => {
    expect(addOutcome({ ...base, added: ["26I4086"] })).toEqual({ kind: "added" });
  });
  test("already there is calm, not an error", () => {
    expect(addOutcome({ ...base, alreadyInDispatch: ["26I4086"] })).toEqual({ kind: "already" });
  });
  test("not available carries the server's reason", () => {
    expect(addOutcome({ ...base, unavailable: [{ serial: "26I4086", reason: "Held in DSP-0012" }] })).toEqual({
      kind: "unavailable",
      reason: "Held in DSP-0012",
    });
  });
  test("not found", () => {
    expect(addOutcome({ ...base, notFound: ["26I4086"] })).toEqual({ kind: "notFound" });
  });
});
