import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canShareDrawing, SHARE_DAYS, shareMessage } from "../features/dies/share-model";

const read = (rel: string) => readFileSync(join(import.meta.dir, "..", rel), "utf8");

describe("share a drawing from the phone (FP-DR-20)", () => {
  test("the phone's link is the server default of 7 days", () => {
    expect(SHARE_DAYS).toBe(7);
  });

  test("the button shows for the die room and masters holders, and only when the section has a press drawing", () => {
    const roles = { die_room: ["die.card"], manager: ["masters.publish"], office: [] as string[] };
    const allowed = (role: keyof typeof roles) => (action: "die.card" | "masters.publish") => roles[role].includes(action);
    const drawing = { hasDrawing: true };
    expect(canShareDrawing(allowed("die_room"), drawing)).toBe(true);
    expect(canShareDrawing(allowed("manager"), drawing)).toBe(true);
    expect(canShareDrawing(allowed("office"), drawing)).toBe(false);
    expect(canShareDrawing(allowed("die_room"), { hasDrawing: false })).toBe(false);
    expect(canShareDrawing(allowed("die_room"), null)).toBe(false);
  });

  test("the message is one tidy line", () => {
    expect(shareMessage("  Press drawing for Domal 12170.\n Link: https://x/share/die/abc  ")).toBe("Press drawing for Domal 12170. Link: https://x/share/die/abc");
  });

  test("the card wires the panel through the permission check and the panel uses the system share sheet", () => {
    const card = read("features/dies/copy-card.tsx");
    expect(card).toMatch(/canShareDrawing\(\(action\) => can\(me, action\), section\)/);
    const panel = read("features/dies/share-panel.tsx");
    expect(panel).toMatch(/Share\.share\(/);
    expect(panel).toMatch(/trpc\.die\.share\.create\.mutationOptions\(\)/);
    // The server owns the token and the days: the phone sends only the section, the days and the owner.
    expect(panel).not.toMatch(/tokenHash|expiresAt/);
  });
});
