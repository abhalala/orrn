import { describe, expect, test } from "bun:test";

import { complaintNext } from "@orrn/domain";

import {
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_TONE,
  complaintActions,
  complaintErrorKey,
  complaintsModuleOn,
  filterCount,
  investigationPayload,
  parseComplaintSearch,
  parsePiecesHit,
  portalCreateErrorKey,
  readTrace,
  statusAfterInvestigate,
  traceLinks,
} from "./model";

const err = (code: string, message: string) => ({ message, data: { code } });

describe("status chip and actions", () => {
  test("every status has a tone", () => {
    expect(COMPLAINT_STATUSES.map((s) => COMPLAINT_STATUS_TONE[s])).toEqual(["amber", "blue", "green", "neutral"]);
  });
  test("closed is final, the rest offer every write", () => {
    expect(complaintActions("closed")).toEqual({ investigate: false, reply: false, close: false });
    for (const s of ["open", "investigating", "replied"] as const) expect(complaintActions(s)).toEqual({ investigate: true, reply: true, close: true });
  });
  test("saving the investigation follows the flow, replied goes back to investigating", () => {
    expect(statusAfterInvestigate("open")).toBe("investigating");
    expect(statusAfterInvestigate("replied")).toBe("investigating");
    expect(statusAfterInvestigate("investigating")).toBe("investigating");
    for (const s of ["open", "replied"] as const) expect(complaintNext(s, statusAfterInvestigate(s))).toBe(true);
  });
});

describe("the list's URL", () => {
  test("keeps a known filter, drops the default and the unknown", () => {
    expect(parseComplaintSearch({ status: "replied" })).toEqual({ status: "replied" });
    expect(parseComplaintSearch({ status: "all" })).toEqual({ status: "all" });
    expect(parseComplaintSearch({ status: "active" })).toEqual({});
    expect(parseComplaintSearch({ status: "bogus" })).toEqual({});
    expect(parseComplaintSearch({ status: 4 })).toEqual({});
    expect(parseComplaintSearch({})).toEqual({});
  });
  test("counts per chip", () => {
    const counts = { open: 2, investigating: 3, replied: 1, closed: 10 };
    expect(filterCount("active", counts)).toBe(6);
    expect(filterCount("all", counts)).toBe(16);
    expect(filterCount("closed", counts)).toBe(10);
    expect(filterCount("open", undefined)).toBe(0);
  });
});

describe("the frozen trace", () => {
  const raw = {
    bundle: { id: "b1", serial: "26I4086", partyNo: "P-7", status: "dispatched", pcs: 40, packedAt: 5 },
    section: { code: "12170", name: "Domal" },
    copy: { id: "c1", code: "12170-2" },
    cast: { id: "k1", number: "C-91", alloy: "6063" },
    runs: [{ id: "r1", number: "PR-12", press: "P1", productionDay: "2026-10-01", shiftSeq: 1 }, { number: "no id" }],
    ageing: { batchId: "ab1", number: "AB-3" },
    order: { id: "o1", number: "SO-9", poNumber: "PO 44" },
    dispatch: { id: "d1", code: "DS-5", plNumber: "PL-21", invoiceNumber: null, completedAt: 9 },
  };
  test("links to the bundle, runs, ageing batch, order and dispatch", () => {
    expect(traceLinks(readTrace(raw)).map((l) => [l.kind, l.href, l.label, l.detail])).toEqual([
      ["bundle", "/b/26I4086", "26I4086", "P-7"],
      ["run", "/press/runs/r1", "PR-12", "P1"],
      ["ageing", "/ageing/batch/ab1", "AB-3", null],
      ["order", "/orders/o1", "SO-9", "PO 44"],
      ["dispatch", "/dispatches/d1", "DS-5", "PL-21"],
    ]);
  });
  test("an empty or odd trace renders nothing instead of throwing", () => {
    expect(traceLinks(readTrace(null))).toEqual([]);
    expect(traceLinks(readTrace({ bundle: "x", runs: "y" }))).toEqual([]);
    expect(readTrace({}).runs).toEqual([]);
  });
  test("a serial with a slash is encoded", () => {
    expect(traceLinks(readTrace({ bundle: { serial: "A/B" } }))[0]!.href).toBe("/b/A%2FB");
  });
});

describe("forms", () => {
  test("pieces hit: empty ok, whole number up to the bundle's pieces", () => {
    expect(parsePiecesHit("", 40)).toEqual({ ok: true, value: undefined });
    expect(parsePiecesHit(" 12 ", 40)).toEqual({ ok: true, value: 12 });
    expect(parsePiecesHit("40", 40)).toEqual({ ok: true, value: 40 });
    for (const bad of ["0", "41", "-1", "2.5", "1,2", "abc"]) expect(parsePiecesHit(bad, 40)).toEqual({ ok: false });
  });
  test("a blank investigation box clears the field", () => {
    expect(investigationPayload({ rootCause: "  ", correctiveAction: " fix die ", ownerId: "", due: "", done: false })).toEqual({
      rootCause: null,
      correctiveAction: "fix die",
      actionOwnerId: null,
      actionDue: null,
      actionDone: false,
    });
    expect(investigationPayload({ rootCause: "x", correctiveAction: "y", ownerId: "u1", due: "2026-12-01", done: true })).toMatchObject({ actionOwnerId: "u1", actionDue: "2026-12-01", actionDone: true });
  });
  test("module switch: complaints is opt-in (PROD-GATE), on only when named", () => {
    expect(complaintsModuleOn([])).toBe(false);
    expect(complaintsModuleOn(["complaints"])).toBe(true);
    expect(complaintsModuleOn(undefined)).toBe(false);
    expect(complaintsModuleOn(["press", "Complaints"])).toBe(true);
    expect(complaintsModuleOn(["press"])).toBe(false);
  });
});

describe("refusals never show the server's words", () => {
  test("known sentences map to keys", () => {
    expect(complaintErrorKey(err("CONFLICT", "This complaint changed since you opened it. Open it again."))).toBe("reg.complaints.errors.changed");
    expect(complaintErrorKey(err("BAD_REQUEST", "This complaint is closed"))).toBe("reg.complaints.errors.closed");
    expect(complaintErrorKey(err("BAD_REQUEST", "A complaint cannot move to that status from here"))).toBe("reg.complaints.errors.badMove");
    expect(complaintErrorKey(err("BAD_REQUEST", "The person for the action is not a member of this plant"))).toBe("reg.complaints.errors.notMember");
    expect(complaintErrorKey(err("BAD_REQUEST", "More pieces than the bundle has"))).toBe("reg.complaints.errors.tooManyPieces");
    expect(complaintErrorKey(err("NOT_FOUND", "Complaint not found"))).toBe("reg.complaints.notFound");
    expect(complaintErrorKey(err("NOT_FOUND", "Bundle not found"))).toBe("reg.complaints.errors.bundleNotFound");
    expect(complaintErrorKey(err("FORBIDDEN", "You cannot do that"))).toBe("reg.complaints.errors.noPermission");
  });
  test("an unknown sentence is the generic save error", () => {
    expect(complaintErrorKey(err("BAD_REQUEST", "Something new"))).toBe("reg.complaints.errors.saveFailed");
    expect(complaintErrorKey(new Error("boom"))).toBe("reg.complaints.errors.saveFailed");
  });
  test("portal create: a miss is the bundle sentence", () => {
    expect(portalCreateErrorKey(err("NOT_FOUND", "Not found"))).toBe("reg.complaints.portal.bundleNotFound");
    expect(portalCreateErrorKey(err("BAD_REQUEST", "x"))).toBe("reg.complaints.portal.sendFailed");
  });
});
