import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { addOutcome, rejectionMessage, renderScanMessage, scanErrorKey } from "./scan-outcome";

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
