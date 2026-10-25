import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { SCAN_OUTCOMES } from "@orrn/server/lib/scan";
import { SCAN_REFUSALS } from "@orrn/server/lib/scanRefusal";

import { ageingRefusalMessage } from "@orrn/server/lib/ageingRefusals";
import { addOutcome, ageingDispatchRefusal, blockMessage, blockOf, blocksOf, offBandText, rejectionMessage, renderScanMessage, resultOutcome, scanErrorKey, scanErrorText, type ScanResultRow } from "./scan-outcome";

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
    ).toEqual({ kind: "rejected", serial: "A", message: { key: "scan.continuous.heldBy", vars: { code: "D-0003" } }, code: "held" });
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

describe("D12 refusals: every code in ORRN wording, in en and hi", () => {
  const hi = createI18n("hi").t;
  const sayBlock = (b: Parameters<typeof blockMessage>[0], tr = t) => renderScanMessage(tr, blockMessage(b));

  test("unassigned, wrong customer and owned die name the customer or owner", () => {
    expect(sayBlock({ reason: "x", code: "unassigned" })).toBe("Not on a sales order");
    expect(sayBlock({ reason: "x", code: "wrong_customer", customerName: "Anshu Aluminium" })).toBe("Packed for Anshu Aluminium");
    expect(sayBlock({ reason: "x", code: "wrong_customer", customerName: null })).toBe("Packed for another customer");
    expect(sayBlock({ reason: "x", code: "owned_die", customerName: "KD Extrusion" })).toBe("Die belongs to KD Extrusion");
    expect(sayBlock({ reason: "x", code: "owned_die" })).toBe("This die belongs to another customer");
  });

  test("ambiguous lists the numbers it could be", () => {
    expect(sayBlock({ reason: "x", code: "ambiguous", candidates: ["26J1", "BG-000001-B001"] })).toBe(
      "More than one bundle has this number: 26J1, BG-000001-B001",
    );
    expect(sayBlock({ reason: "x", code: "ambiguous" })).toBe("More than one bundle has this number. Scan its label.");
  });

  test("reallocation pending", () => {
    expect(sayBlock({ reason: "x", code: "reallocation_pending" })).toBe("Waiting on a reallocation approval");
  });

  test("Hindi has words for every code (never the English sentence)", () => {
    for (const code of ["unassigned", "wrong_customer", "owned_die", "ambiguous", "reallocation_pending", "held", "dispatched", "void"] as const) {
      const said = sayBlock({ reason: "ENGLISH ONLY", code, customerName: "KD", candidates: ["A", "B"], heldBy: "D-1" }, hi);
      expect(said).not.toBe("ENGLISH ONLY");
      expect(said).toMatch(/[\u0900-\u097F]/);
    }
  });
});

describe("refusal details come from `refused`, which names the customer and the candidates", () => {
  const empty = { added: [], alreadyInDispatch: [], notFound: [], unavailable: [] };
  const refused = (over: object) => ({ serial: "26J4090", code: "wrong_customer" as const, reason: "Packed for Anshu", heldBy: null, customerName: "Anshu", candidates: [], ...over });

  test("a refused row is merged into the unavailable one", () => {
    const report = {
      ...empty,
      unavailable: [{ serial: "26J4090", reason: "Packed for Anshu", code: "wrong_customer" as const, status: "available" as const, heldBy: null }],
      refused: [refused({})],
    };
    expect(blockOf(report, "26J4090")).toMatchObject({ code: "wrong_customer", customerName: "Anshu" });
    expect(addOutcome(report, "26J4090")).toEqual({
      kind: "rejected",
      serial: "26J4090",
      message: { key: "scan.continuous.wrongCustomer", vars: { name: "Anshu" } },
      code: "wrong_customer",
    });
  });

  test("an ambiguous code is reported as notFound for old clients but refused: show the candidates, not 'not found'", () => {
    const report = {
      ...empty,
      notFound: ["26J1"],
      refused: [{ serial: "26J1", code: "ambiguous" as const, reason: "Several", heldBy: null, customerName: null, candidates: ["26J1", "BG-000001-B001"] }],
    };
    const out = addOutcome(report, "26J1");
    expect(out.kind).toBe("rejected");
    expect(out).toMatchObject({ code: "ambiguous", candidates: ["26J1", "BG-000001-B001"] });
  });

  test("blocksOf lists each refused serial once", () => {
    const report = {
      ...empty,
      unavailable: [{ serial: "A", reason: "r", code: "unassigned" as const, status: "available" as const, heldBy: null }],
      refused: [refused({ serial: "A", code: "unassigned", customerName: null }), refused({ serial: "B", code: "owned_die", customerName: "KD" })],
    };
    expect(blocksOf(report).map((b) => [b.serial, b.code])).toEqual([
      ["A", "unassigned"],
      ["B", "owned_die"],
    ]);
  });
});

describe("every server scan outcome has a floor mapping (fails when the server adds an unmapped code)", () => {
  const row = (outcome: ScanResultRow["outcome"]): ScanResultRow => ({
    code: "BG-000001-B001",
    outcome,
    message: "ENGLISH ONLY",
    bundleId: "b1",
    serial: "BG-000001-B001",
    heldBy: "D-0042",
    customerName: "Anshu Aluminium",
    orderNumber: "SO-12",
    candidates: ["26J1", "26J2"],
    note: null,
  });

  test("each SCAN_OUTCOMES code gives a kind, and every refusal a key in en, hi and gu", () => {
    for (const outcome of SCAN_OUTCOMES) {
      const out = resultOutcome(row(outcome));
      if (outcome === "added") expect(out.kind).toBe("added");
      else if (outcome === "already_on_dispatch") expect(out.kind).toBe("already");
      else if (outcome === "not_found") expect(out.kind).toBe("notFound");
      else {
        expect(out.kind).toBe("rejected");
        if (out.kind !== "rejected") continue;
        // A key, never the server's English sentence.
        expect("key" in out.message).toBe(true);
        for (const lang of ["en", "hi", "gu"] as const) {
          const said = renderScanMessage(createI18n(lang).t, out.message);
          expect(said).not.toBe("ENGLISH ONLY");
          if (lang === "hi") expect(said).toMatch(/[\u0900-\u097F]/);
          if (lang === "gu") expect(said).toMatch(/[\u0A80-\u0AFF]/);
        }
      }
    }
  });

  test("every SCAN_REFUSALS code is a scan outcome and maps through blockMessage", () => {
    for (const code of SCAN_REFUSALS) {
      expect((SCAN_OUTCOMES as readonly string[]).includes(code)).toBe(true);
      const msg = blockMessage({ reason: "ENGLISH ONLY", code, customerName: "KD", candidates: ["A"], heldBy: "D-1", orderNumber: "SO-1" });
      expect("key" in msg).toBe(true);
    }
  });

  test("held_for_order from dispatch.scan names the order and customer in gu", () => {
    const out = resultOutcome(row("held_for_order"));
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(renderScanMessage(t, out.message)).toBe("Held for SO-12 (Anshu Aluminium)");
    expect(renderScanMessage(createI18n("gu").t, out.message)).toBe("SO-12 (Anshu Aluminium) માટે હોલ્ડ પર છે");
  });

  test("a refused held_for_order row carries its order number into the block", () => {
    const report = {
      added: [],
      alreadyInDispatch: [],
      notFound: [],
      unavailable: [{ serial: "S1", reason: "Held for SO-12 (Anshu)" }],
      refused: [{ serial: "S1", code: "held_for_order" as const, reason: "Held for SO-12 (Anshu)", heldBy: null, customerName: "Anshu", candidates: [], orderNumber: "SO-12" }],
    };
    expect(renderScanMessage(t, blockMessage(blockOf(report, "S1")!))).toBe("Held for SO-12 (Anshu)");
  });
});

describe("one order per packing list and the weight warning (Q36, Q37)", () => {
  test("a bundle outside the order is refused in the floor's words, in every language", () => {
    const block = { reason: "This packing list is for SO-14 only", code: "outside_order" as const, orderNumber: "SO-14" };
    expect(renderScanMessage(t, blockMessage(block))).toBe("This packing list is for SO-14 only");
    expect(renderScanMessage(createI18n("hi").t, blockMessage(block))).toBe("यह packing list सिर्फ़ SO-14 की है");
    expect(renderScanMessage(createI18n("gu").t, blockMessage(block))).toBe("આ packing list ફક્ત SO-14 ની છે");
    // Without the order number the plain key is shown, translated (never the server's English).
    const plain = { reason: "server wording", code: "outside_order" as const };
    expect(blockMessage(plain)).toEqual({ key: "scan.continuous.outsideOrderPlain" });
    expect(renderScanMessage(t, blockMessage(plain))).toBe("This packing list is for one sales order only");
    expect(renderScanMessage(createI18n("hi").t, blockMessage(plain))).toBe("यह packing list सिर्फ़ एक sales order की है");
    expect(renderScanMessage(createI18n("gu").t, blockMessage(plain))).toBe("આ packing list ફક્ત એક sales order ની છે");
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

describe("W3-AG-W: dispatch refuses a bundle in ageing", () => {
  const failure = (code: "bundle_in_ageing" | "bundle_ageing_held" | "bundle_not_aged") => {
    const { code: trpc, message } = ageingRefusalMessage(code, { serial: "26J12", batch: "AG-38" });
    return { message, data: { code: trpc } };
  };

  test("each of the three server sentences maps to its own words with the bundle and batch", () => {
    expect(ageingDispatchRefusal(failure("bundle_in_ageing"))).toEqual({ key: "ageing.refusal.bundleInAgeing", vars: { serial: "26J12", batch: "AG-38" } });
    expect(ageingDispatchRefusal(failure("bundle_ageing_held"))).toEqual({ key: "ageing.refusal.bundleAgeingHeld", vars: { serial: "26J12", batch: "AG-38" } });
    expect(ageingDispatchRefusal(failure("bundle_not_aged"))?.key).toBe("ageing.refusal.bundleNotAged");
  });

  test("a failure that is not about ageing is left to the generic words", () => {
    expect(ageingDispatchRefusal({ message: "Dispatch is closed", data: { code: "BAD_REQUEST" } })).toBeNull();
    expect(ageingDispatchRefusal(null)).toBeNull();
    const t = createI18n("en").t;
    expect(scanErrorText(t, { message: "Dispatch is closed", data: { code: "BAD_REQUEST" } }, "dispatch")).toBe(t(scanErrorKey({ data: { code: "BAD_REQUEST" } }, "dispatch")));
  });

  test("the floor hears it in its own language, naming the bundle", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = createI18n(lang).t;
      for (const code of ["bundle_in_ageing", "bundle_ageing_held", "bundle_not_aged"] as const) {
        const said = scanErrorText(t, failure(code), "dispatch");
        expect(said).toContain("26J12");
        expect(said).not.toContain("ageing.refusal");
      }
      expect(scanErrorText(t, failure("bundle_in_ageing"), "dispatch")).toContain("AG-38");
    }
  });
});
