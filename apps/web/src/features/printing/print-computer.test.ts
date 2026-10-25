import { describe, expect, test } from "bun:test";

import { PRINT_COMPUTER_STALE_MS, printComputerBanner } from "./print-computer";

describe("print computer banner (BACKLOG 102)", () => {
  const NOW = Date.parse("2026-10-25T16:00:00Z");
  const ago = (ms: number) => new Date(NOW - ms);
  const node = (over: Partial<{ status: "pending" | "active" | "offline" | "revoked"; lastHeartbeatAt: Date | null; nodeName: string }> = {}) => ({
    status: "pending" as const,
    lastHeartbeatAt: null,
    nodeName: "Print PC",
    ...over,
  });

  test("labels waiting and the print computer has never reported in: say so", () => {
    expect(printComputerBanner([node()], 2, NOW)).toEqual({ kind: "never", nodeName: "Print PC" });
  });

  test("labels waiting and it stopped reporting: offline since its last report", () => {
    const last = ago(PRINT_COMPUTER_STALE_MS + 60_000);
    expect(printComputerBanner([node({ status: "active", lastHeartbeatAt: last })], 1, NOW)).toEqual({ kind: "offline", nodeName: "Print PC", since: last });
    const stored = ago(3_600_000);
    expect(printComputerBanner([node({ status: "offline", lastHeartbeatAt: stored })], 1, NOW)).toEqual({ kind: "offline", nodeName: "Print PC", since: stored });
  });

  test("the offline line is five minutes (five missed 60 s beats): four minutes is still reporting in", () => {
    expect(PRINT_COMPUTER_STALE_MS).toBe(5 * 60_000);
    expect(printComputerBanner([node({ status: "active", lastHeartbeatAt: ago(4 * 60_000) })], 1, NOW)).toBeNull();
    expect(printComputerBanner([node({ status: "active", lastHeartbeatAt: ago(5 * 60_000 + 1) })], 1, NOW)?.kind).toBe("offline");
  });

  test("one print computer reporting in is enough; nothing waiting, or no print computer at all, gives no banner", () => {
    expect(printComputerBanner([node({ status: "active", lastHeartbeatAt: ago(60_000) })], 5, NOW)).toBeNull();
    expect(printComputerBanner([node({ status: "active", lastHeartbeatAt: ago(60_000) }), node({ status: "offline", lastHeartbeatAt: ago(9e6) })], 5, NOW)).toBeNull();
    expect(printComputerBanner([node()], 0, NOW)).toBeNull();
    expect(printComputerBanner([], 4, NOW)).toBeNull();
    expect(printComputerBanner([node({ status: "revoked" })], 4, NOW)).toBeNull();
  });

  test("a set-up print computer that reported once still counts as offline, not never, and the newest report is the 'since'", () => {
    const older = ago(9_000_000);
    const newer = ago(5_000_000);
    expect(printComputerBanner([node({ status: "offline", lastHeartbeatAt: older }), node({ nodeName: "Second", status: "offline", lastHeartbeatAt: newer })], 1, NOW)).toEqual({
      kind: "offline",
      nodeName: "Second",
      since: newer,
    });
  });
});
