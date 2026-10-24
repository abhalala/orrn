import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDeduper, DEDUPE_WINDOW_MS } from "../features/scan/dedupe";
import { addOutcome, rejectionMessage, scanErrorKey, type AddBundlesReport } from "../features/scan/outcome";
import { lookupTarget, needsResolve, scanLogEntry } from "../features/scan/scan-flow";

const ROOT = join(import.meta.dir, "..");

describe("1.5 s de-dupe (a camera sees the label on every frame)", () => {
  test("the window is 1.5 s", () => {
    expect(DEDUPE_WINDOW_MS).toBe(1500);
  });

  test("a label held in front of the camera is read once", () => {
    let now = 0;
    const d = createDeduper(DEDUPE_WINDOW_MS, () => now);
    expect(d.accept("26I4086")).toBe(true);
    now = 400;
    expect(d.accept("26I4086")).toBe(false);
    now = 1800; // still in sight: each sighting restarts the window
    expect(d.accept("26I4086")).toBe(false);
    now = 3400; // out of sight for 1.6 s
    expect(d.accept("26I4086")).toBe(true);
  });

  test("other labels pass straight through, and reset forgets everything", () => {
    let now = 0;
    const d = createDeduper(DEDUPE_WINDOW_MS, () => now);
    expect(d.accept("A1")).toBe(true);
    expect(d.accept("B2")).toBe(true);
    d.reset();
    expect(d.accept("A1")).toBe(true);
  });
});

const report = (over: Partial<AddBundlesReport> = {}): AddBundlesReport => ({
  added: [],
  alreadyInDispatch: [],
  notFound: [],
  unavailable: [],
  ...over,
});

describe("dispatch mode outcome per scanned serial", () => {
  test("added, already in this dispatch (calm, Review Focus 1), not found", () => {
    expect(addOutcome(report({ added: ["S1"] }), "S1")).toEqual({ kind: "added", serial: "S1" });
    expect(addOutcome(report({ alreadyInDispatch: ["S1"] }), "S1")).toEqual({ kind: "already", serial: "S1" });
    expect(addOutcome(report({ notFound: ["S1"] }), "S1")).toEqual({ kind: "notFound", serial: "S1" });
  });

  test("a structured code (ruling T22) wins over the English reason", () => {
    const blocked = report({ unavailable: [{ serial: "S1", reason: "whatever", code: "held", heldBy: "D-0007" } as never] });
    expect(addOutcome(blocked, "S1")).toEqual({
      kind: "rejected",
      serial: "S1",
      message: { key: "scan.continuous.heldBy", vars: { code: "D-0007" } },
    });
    const voided = report({ unavailable: [{ serial: "S1", reason: "x", code: "void" } as never] });
    expect(addOutcome(voided, "S1")).toMatchObject({ message: { key: "scan.continuous.void" } });
    const pending = report({ unavailable: [{ serial: "S2", reason: "x", code: "reallocation_pending" }] });
    expect(addOutcome(pending, "S2")).toMatchObject({ message: { key: "scan.continuous.reallocationPending" } });
    const held = report({
      unavailable: [{ serial: "S3", reason: "Held for SO-7 (Shreeji)", code: "held_for_order", orderNumber: "SO-7", customerName: "Shreeji" }],
    });
    expect(addOutcome(held, "S3")).toMatchObject({
      message: { key: "scan.continuous.heldForOrder", vars: { order: "SO-7", customer: "Shreeji" } },
    });
    // Without the order number the English sentence is shown as sent.
    const bare = report({ unavailable: [{ serial: "S4", reason: "Held for SO-7 (Shreeji)", code: "held_for_order" }] });
    expect(addOutcome(bare, "S4")).toMatchObject({ message: { text: "Held for SO-7 (Shreeji)" } });
  });

  test("older servers: the English reason is mapped to floor wording", () => {
    expect(rejectionMessage("Bundle is held by D-0007")).toEqual({ key: "scan.continuous.heldBy", vars: { code: "D-0007" } });
    expect(rejectionMessage("Bundle is held by another dispatch")).toEqual({ key: "scan.continuous.heldElsewhere" });
    expect(rejectionMessage("Bundle is already dispatched")).toEqual({ key: "scan.continuous.dispatched" });
    expect(rejectionMessage("Bundle is void")).toEqual({ key: "scan.continuous.void" });
    expect(rejectionMessage("Bundle is reserved")).toEqual({ key: "scan.continuous.wrongStatus", status: "reserved" });
    expect(rejectionMessage("Odd new reason")).toEqual({ text: "Odd new reason" });
  });

  test("request failures say what happened", () => {
    expect(scanErrorKey({ data: { code: "FORBIDDEN" } }, "dispatch")).toBe("errors.forbidden");
    expect(scanErrorKey({ data: { code: "BAD_REQUEST" } }, "dispatch")).toBe("scan.continuous.closed");
    expect(scanErrorKey({ data: { code: "NOT_FOUND" } }, "lookup")).toBe("errors.generic");
    expect(scanErrorKey(new Error("Network request failed"), "lookup")).toBe("errors.network");
  });
});

describe("what a read becomes", () => {
  test("stored numbers go straight to the dispatch; old month-only numbers and legacy ids are resolved first", () => {
    expect(needsResolve("26I4086")).toBe(false);
    expect(needsResolve("BG-000001-B001")).toBe(false);
    expect(needsResolve("J540")).toBe(true);
    expect(needsResolve("clx1a2b3c4d5e6f7g8h9i0")).toBe(true);
  });

  test("lookup: a bundle opens its page, an ambiguous number asks, unknown text explains", () => {
    expect(lookupTarget({ kind: "bundle", number: "26I4086" })).toEqual({ kind: "open", href: "/b/26I4086" });
    expect(lookupTarget({ kind: "bundle", number: "BG 1/2" })).toEqual({ kind: "open", href: "/b/BG%201%2F2" });
    expect(lookupTarget({ kind: "ambiguous", candidates: [{ bundleId: "x", number: "25J540", year: 2025 }] })).toEqual({
      kind: "choose",
      candidates: [{ bundleId: "x", number: "25J540", year: 2025 }],
    });
    expect(lookupTarget({ kind: "not_found" })).toEqual({ kind: "message", key: "scan.notFound" });
  });

  test("the recent-scans log keeps the newest 8, newest first", () => {
    let log: ReturnType<typeof scanLogEntry>[] = [];
    for (let i = 0; i < 10; i++) log = [scanLogEntry({ serial: `S${i}`, kind: "added" }, i), ...log].slice(0, 8);
    expect(log.map((e) => e.serial)).toEqual(["S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2"]);
  });
});

describe("the camera scanner (spec §3 Scan, plan T29)", () => {
  const src = readFileSync(join(ROOT, "features/scan/scan-view.tsx"), "utf8");

  test("reads QR and Code128 with expo-camera's CameraView", () => {
    expect(src).toMatch(/<CameraView\b/);
    expect(src).toMatch(/barcodeScannerSettings=\{\{\s*barcodeTypes:\s*\["qr",\s*"code128"\]\s*\}\}/);
  });

  test("has a torch toggle and a typed entry that works without the camera (brief a11y 9)", () => {
    expect(src).toMatch(/enableTorch=\{torch\}/);
    expect(src).toMatch(/scan\.torchOn/);
    expect(src).toMatch(/scan\.manualLabel/);
  });

  test("de-dupes reads and gives haptic plus spoken feedback (haptics never the only signal)", () => {
    expect(src).toMatch(/createDeduper\(/);
    expect(src).toMatch(/feedback\.(success|error)\(/);
    expect(src).toMatch(/announce\(/);
  });
});
