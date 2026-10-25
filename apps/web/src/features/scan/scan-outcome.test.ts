import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { addOutcome, blockMessage, offBandText, rejectionMessage, renderScanMessage, scanErrorKey } from "./scan-outcome";

const { t } = createI18n("en");
const say = (reason: string) => renderScanMessage(t, rejectionMessage(reason));

describe("rejectionMessage", () => {
  test("maps every server reason to floor wording", () => {
    expect(say("Bundle is held by D-0007")).toBe("Held for D-0007");
    expect(say("Bundle is held by another dispatch")).toBe("Held for another dispatch");
    expect(say("Bundle is already dispatched")).toBe("Already dispatched");
    expect(say("Bundle is void")).toBe("This bundle is void");
    expect(say("Bundle is reserved")).toBe("Can't add a bundle that is Held");
  });

  test("an unknown reason is shown as the server wrote it", () => {
    expect(say("Something new")).toBe("Something new");
  });

  test("Hindi gets its own words", () => {
    const hi = createI18n("hi").t;
    expect(renderScanMessage(hi, rejectionMessage("Bundle is void"))).toBe("यह bundle रद्द है");
  });
});

describe("blockMessage (structured reasons, T22)", () => {
  const sayBlock = (b: Parameters<typeof blockMessage>[0], tr = t) => renderScanMessage(tr, blockMessage(b));
  test("words each code without reading the English sentence", () => {
    expect(sayBlock({ reason: "ignored", code: "held", status: "reserved", heldBy: "D-0042" })).toBe("Held for D-0042");
    expect(sayBlock({ reason: "ignored", code: "held", status: "reserved", heldBy: null })).toBe("Held for another dispatch");
    expect(sayBlock({ reason: "ignored", code: "dispatched", status: "dispatched", heldBy: null })).toBe("Already dispatched");
    expect(sayBlock({ reason: "ignored", code: "void", status: "void", heldBy: null })).toBe("This bundle is void");
    expect(sayBlock({ reason: "ignored", code: "status", status: "available", heldBy: null })).toBe(
      "Can't add a bundle that is In stock",
    );
  });
  test("Hindi words come from the code too", () => {
    const hi = createI18n("hi").t;
    expect(sayBlock({ reason: "Bundle is void", code: "void", status: "void", heldBy: null }, hi)).toBe("यह bundle रद्द है");
  });
  test("an older server without a code falls back to its sentence", () => {
    expect(sayBlock({ reason: "Bundle is held by D-0007" })).toBe("Held for D-0007");
  });
  test("held for a sales order (FP-OP-17) names the order and its customer", () => {
    const block = { reason: "Held for SO-12 (Anshu Traders)", code: "held_for_order" as const, status: "available" as const, heldBy: null, orderNumber: "SO-12", customerName: "Anshu Traders" };
    expect(sayBlock(block)).toBe("Held for SO-12 (Anshu Traders)");
    expect(sayBlock(block, createI18n("hi").t)).toBe("SO-12 (Anshu Traders) के लिए होल्ड पर है");
    // Without the order (a trimmed report): the server's sentence.
    expect(sayBlock({ reason: "Held for SO-12 (Anshu Traders)", code: "held_for_order" })).toBe("Held for SO-12 (Anshu Traders)");
  });
});

describe("addOutcome", () => {
  const empty = { added: [], alreadyInDispatch: [], notFound: [], unavailable: [] };
  test("reads the scanned serial's line of the report", () => {
    expect(addOutcome({ ...empty, added: ["A"] }, "A")).toEqual({ kind: "added", serial: "A" });
    expect(addOutcome({ ...empty, alreadyInDispatch: ["A"] }, "A")).toEqual({ kind: "already", serial: "A" });
    expect(addOutcome({ ...empty, notFound: ["A"] }, "A")).toEqual({ kind: "notFound", serial: "A" });
    expect(addOutcome({ ...empty, unavailable: [{ serial: "A", reason: "Bundle is void" }] }, "A")).toEqual({
      kind: "rejected",
      serial: "A",
      message: { key: "scan.continuous.void" },
    });
    expect(
      addOutcome(
        { ...empty, unavailable: [{ serial: "A", reason: "x", code: "held", status: "reserved", heldBy: "D-0003" }] },
        "A",
      ),
    ).toEqual({ kind: "rejected", serial: "A", message: { key: "scan.continuous.heldBy", vars: { code: "D-0003" } } });
  });
});

describe("scanErrorKey", () => {
  test("no tRPC code means the request never arrived", () => {
    expect(scanErrorKey(new TypeError("Failed to fetch"), "lookup")).toBe("errors.network");
  });
  test("a closed dispatch says so", () => {
    expect(scanErrorKey({ data: { code: "BAD_REQUEST" } }, "dispatch")).toBe("scan.continuous.closed");
  });
  test("role and session problems", () => {
    expect(scanErrorKey({ data: { code: "FORBIDDEN" } }, "dispatch")).toBe("errors.forbidden");
    expect(scanErrorKey({ data: { code: "UNAUTHORIZED" } }, "lookup")).toBe("errors.sessionExpired");
    expect(scanErrorKey({ data: { code: "INTERNAL_SERVER_ERROR" } }, "lookup")).toBe("errors.generic");
  });
});

describe("one order per packing list and the weight warning (Q36, Q37)", () => {
  test("a bundle outside the order is refused in the floor's words, in every language", () => {
    const block = { reason: "This packing list is for SO-14 only", code: "outside_order" as const, orderNumber: "SO-14" };
    expect(renderScanMessage(t, blockMessage(block))).toBe("This packing list is for SO-14 only");
    expect(renderScanMessage(createI18n("hi").t, blockMessage(block))).toBe("यह packing list सिर्फ़ SO-14 की है");
    expect(renderScanMessage(createI18n("gu").t, blockMessage(block))).toBe("આ packing list ફક્ત SO-14 ની છે");
    // Without the order number the server's sentence is shown as it is.
    expect(renderScanMessage(t, blockMessage({ reason: "This packing list is for one sales order only", code: "outside_order" }))).toBe("This packing list is for one sales order only");
  });

  test("an added bundle off its line's weight carries a warning with both figures; others carry none", () => {
    const report = {
      added: ["26J1", "26J2"],
      alreadyInDispatch: [],
      notFound: [],
      unavailable: [],
      warnings: [{ serial: "26J2", orderNumber: "SO-14", lineNo: 1, bundleMilli: 12_498, lineMilli: 12_000, diffMilli: 498 }],
    };
    expect(offBandText(t, report, "26J2")).toBe("12.498 kg/12ft, SO-14 says 12.000. Check the weight.");
    expect(offBandText(t, report, "26J1")).toBeNull();
    expect(offBandText(t, { warnings: undefined }, "26J2")).toBeNull();
    expect(addOutcome(report, "26J2").kind).toBe("added");
  });
});
