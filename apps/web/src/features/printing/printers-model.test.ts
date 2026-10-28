import { describe, expect, test } from "bun:test";

import { PRINT_COMPUTER_STALE_MS } from "./print-computer";
import { nodeState, parsePreferences, preferencesDraft, primaryNode, printerReportOf, testPrinterId } from "./printers-model";

const NOW = Date.parse("2026-10-28T10:00:00Z");

describe("print computer state", () => {
  test("online only while active and reporting within five heartbeats", () => {
    expect(nodeState({ status: "active", lastHeartbeatAt: new Date(NOW - 30_000) }, NOW)).toBe("online");
    expect(nodeState({ status: "active", lastHeartbeatAt: new Date(NOW - PRINT_COMPUTER_STALE_MS - 1).toISOString() }, NOW)).toBe("offline");
    expect(nodeState({ status: "offline", lastHeartbeatAt: new Date(NOW - 1_000) }, NOW)).toBe("offline");
    expect(nodeState({ status: "pending", lastHeartbeatAt: null }, NOW)).toBe("never");
    expect(nodeState({ status: "revoked", lastHeartbeatAt: new Date(NOW) }, NOW)).toBe("revoked");
  });

  test("the page leads with the newest computer that is not turned off", () => {
    expect(primaryNode([{ status: "revoked" as const, id: "a" }, { status: "pending" as const, id: "b" }])?.id).toBe("b");
    expect(primaryNode([{ status: "revoked" as const, id: "a" }])?.id).toBe("a");
    expect(primaryNode([])).toBeNull();
  });
});

describe("printer report", () => {
  const edge = [
    {
      printerId: "tsc-1",
      name: "Packing",
      ipAddress: "10.0.0.40",
      port: 9100,
      status: "online",
      canPrint: true,
      lastSeenAt: "2026-10-28T09:59:00.000Z",
      lastError: null,
      capabilities: { model: "TA220", macAddress: "00:1b:82:aa:bb:cc", host: "10.0.0.41", port: 9100, features: [], verifiedAt: "2026-10-28T09:00:00.000Z" },
    },
    { printerId: "tsc-2", name: "Spare", ipAddress: "10.0.0.42", port: 9100, status: "paused", canPrint: false, lastSeenAt: null, lastError: null },
  ];

  test("an Edge report carries the verified endpoint, model and hardware address", () => {
    expect(printerReportOf(edge, "tsc-1")).toEqual({
      state: "ready",
      host: "10.0.0.41",
      port: 9100,
      model: "TA220",
      macAddress: "00:1b:82:aa:bb:cc",
      lastSeenAt: new Date("2026-10-28T09:59:00.000Z"),
      lastError: null,
    });
    expect(printerReportOf(edge, "tsc-2")?.state).toBe("paused");
    expect(printerReportOf(edge, "tsc-9")).toBeNull();
    expect(printerReportOf(undefined, "tsc-1")).toBeNull();
  });

  test("online but unable to print is an error; a legacy spool printer matches by number", () => {
    expect(printerReportOf([{ ...edge[0], canPrint: false }], "tsc-1")?.state).toBe("error");
    expect(printerReportOf([{ id: 3, ip_address: "10.0.0.5", port: 9100, status: "offline", last_seen_at: null }], "3")).toMatchObject({
      state: "offline",
      host: "10.0.0.5",
      model: null,
    });
  });
});

describe("printer settings", () => {
  const stored = { mediaType: null, mediaWidthMm: null, mediaHeightMm: null, gapMm: null, dpi: null, speedInSec: null, density: null, cutterEnabled: false };
  const page = { widthMm: 102, heightMm: 76, gapMm: 2, dpi: 203 as const, speedInSec: 5 as const, density: 9, direction: 0 as const };

  test("unset settings start from the printer's label design", () => {
    expect(preferencesDraft(stored, page)).toEqual({
      mediaType: "gap",
      mediaWidthMm: "102",
      mediaHeightMm: "76",
      gapMm: "2",
      dpi: 203,
      speedInSec: "5",
      density: "9",
      cutterEnabled: false,
    });
    expect(preferencesDraft({ ...stored, mediaType: "black_mark", mediaWidthMm: 50, cutterEnabled: true }, null)).toMatchObject({
      mediaType: "black_mark",
      mediaWidthMm: "50",
      mediaHeightMm: "75",
      dpi: 203,
      cutterEnabled: true,
    });
  });

  test("the server's limits are checked before sending", () => {
    const draft = preferencesDraft(stored, page);
    expect(parsePreferences(draft)).toEqual({
      ok: true,
      input: { mediaType: "gap", mediaWidthMm: 102, mediaHeightMm: 76, gapMm: 2, dpi: 203, speedInSec: 5, density: 9, cutterEnabled: false },
    });
    expect(parsePreferences({ ...draft, mediaWidthMm: "", gapMm: "51", speedInSec: "2.5", density: "16" })).toEqual({
      ok: false,
      errors: { mediaWidthMm: true, gapMm: true, speedInSec: true, density: true },
    });
  });

  test("a legacy printer number goes as a number, an Edge id as text", () => {
    expect(testPrinterId("12")).toBe(12);
    expect(testPrinterId("dev-printer-1")).toBe("dev-printer-1");
  });
});
