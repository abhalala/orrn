import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { addOutcome, blockMessage, blockOf, blocksOf, rejectionMessage, renderScanMessage, scanErrorKey } from "./scan-outcome";

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
