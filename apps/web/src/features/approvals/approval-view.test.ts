import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { APPROVAL_TONE, approvalSubject, decideState, type ApprovalForView } from "./approval-view";

function me(role: string, id = "u-manager"): Me {
  return {
    user: { id, name: "M", email: "m@orrn.local" },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role },
    isPlatformAdmin: false,
    platformRole: null,
  } as Me;
}

function row(over: Partial<ApprovalForView> = {}): ApprovalForView {
  return {
    kind: "dc_note",
    status: "pending",
    subjectId: "note-1",
    requestedBy: "u-office",
    meta: { number: "DN-3", lotId: "lot-9", lotNumber: "LOT-12", type: "debit", reason: "weight" },
    ...over,
  };
}

describe("APPROVAL_TONE", () => {
  test("waiting is amber, approved green, rejected red", () => {
    expect(APPROVAL_TONE).toEqual({ pending: "amber", approved: "green", rejected: "red" });
  });
});

describe("approvalSubject", () => {
  test("a D/C note names the note and its lot and links to the lot", () => {
    expect(approvalSubject(row())).toEqual({
      kindKey: "approvals.kind.dc_note",
      titleKey: "approvals.subject.dcDebit",
      vars: { number: "DN-3", lot: "LOT-12" },
      href: "/purchase/lot-9",
      openKey: "approvals.openLot",
    });
    expect(approvalSubject(row({ meta: { number: "CN-1", lotId: "lot-9", lotNumber: "LOT-12", type: "credit" } })).titleKey).toBe(
      "approvals.subject.dcCredit",
    );
  });

  test("a die re-rank names the copy and the tiers and links to its section", () => {
    expect(
      approvalSubject(
        row({ kind: "die_rerank", meta: { dieInstanceId: "di-1", sectionId: "die-7", code: "14701-B", fromRank: 2, toRank: 1 } }),
      ),
    ).toEqual({
      kindKey: "approvals.kind.die_rerank",
      titleKey: "approvals.subject.dieRerank",
      vars: { code: "14701-B", from: 2, to: 1 },
      href: "/dies/die-7",
      openKey: "approvals.openDie",
    });
  });

  test("kinds without a screen yet fall back to a code or number from meta, no link", () => {
    expect(approvalSubject(row({ kind: "cast_close", meta: { code: "K31" } }))).toEqual({
      kindKey: "approvals.kind.cast_close",
      titleKey: "approvals.subject.generic",
      vars: { ref: "K31" },
      href: null,
      openKey: null,
    });
    expect(approvalSubject(row({ kind: "phantom_void", meta: {} })).vars).toEqual({ ref: "" });
  });

  test("never trusts meta to build an unsafe link", () => {
    expect(approvalSubject(row({ meta: { number: "DN-3", lotId: "../../admin", lotNumber: "LOT-1", type: "debit" } })).href).toBeNull();
  });
});

describe("splitCodes", () => {
  test("cuts a title into text and whole codes, so LOT-13 never breaks at its hyphen", async () => {
    const { splitCodes } = await import("./approval-view");
    expect(splitCodes("Debit note DCN-2 on LOT-13", ["DCN-2", "LOT-13"])).toEqual([
      { text: "Debit note ", code: false },
      { text: "DCN-2", code: true },
      { text: " on ", code: false },
      { text: "LOT-13", code: true },
    ]);
  });

  test("Hindi word order, repeated and missing codes, empty codes ignored", async () => {
    const { splitCodes } = await import("./approval-view");
    expect(splitCodes("LOT-13 पर डेबिट नोट DCN-2", ["DCN-2", "LOT-13", ""])).toEqual([
      { text: "LOT-13", code: true },
      { text: " पर डेबिट नोट ", code: false },
      { text: "DCN-2", code: true },
    ]);
    expect(splitCodes("K31 and K31", ["K31", "Z9"])).toEqual([
      { text: "K31", code: true },
      { text: " and ", code: false },
      { text: "K31", code: true },
    ]);
    expect(splitCodes("Nothing here", [])).toEqual([{ text: "Nothing here", code: false }]);
  });

  test("a longer code wins over a shorter one it contains", async () => {
    const { splitCodes } = await import("./approval-view");
    expect(splitCodes("LOT-1 and LOT-12", ["LOT-1", "LOT-12"])).toEqual([
      { text: "LOT-1", code: true },
      { text: " and ", code: false },
      { text: "LOT-12", code: true },
    ]);
  });
});

describe("unbrokenCodes", () => {
  test("for plain-text titles: a word joiner after each hyphen inside a code, nothing else changes", async () => {
    const { unbrokenCodes } = await import("./approval-view");
    expect(unbrokenCodes("Debit note DCN-2 on LOT-13", ["DCN-2", "LOT-13"])).toBe("Debit note DCN-\u20602 on LOT-\u206013");
    expect(unbrokenCodes("Copy 14701-B, tier 2 to 1", ["14701-B"])).toBe("Copy 14701-\u2060B, tier 2 to 1");
    expect(unbrokenCodes("Well-known LOT-1", ["LOT-1"])).toBe("Well-known LOT-\u20601");
  });
});

describe("subjectCodes", () => {
  test("the note, lot, die copy and fallback codes of a subject, never tier numbers", async () => {
    const { subjectCodes } = await import("./approval-view");
    expect(subjectCodes(approvalSubject(row()))).toEqual(["DN-3", "LOT-12"]);
    expect(
      subjectCodes(approvalSubject(row({ kind: "die_rerank", meta: { sectionId: "die-7", code: "14701-B", fromRank: 2, toRank: 1 } }))),
    ).toEqual(["14701-B"]);
    expect(subjectCodes(approvalSubject(row({ kind: "cast_close", meta: { code: "K31" } })))).toEqual(["K31"]);
  });
});

describe("decideState", () => {
  test("a manager decides someone else's pending D/C note", () => {
    expect(decideState(me("manager"), row())).toBe("decide");
    expect(decideState(me("owner", "u-owner"), row())).toBe("decide");
  });

  test("never your own request, even as owner", () => {
    expect(decideState(me("owner", "u-office"), row())).toBe("own");
  });

  test("roles that are not approvers for the kind only look", () => {
    expect(decideState(me("office", "u-other"), row())).toBe("view");
    // Foundry approves a cast close (digest), not a D/C note.
    expect(decideState(me("foundry", "u-f"), row({ kind: "cast_close" }))).toBe("decide");
    expect(decideState(me("foundry", "u-f"), row())).toBe("view");
  });

  test("a decided request is closed for everyone", () => {
    expect(decideState(me("manager"), row({ status: "approved" }))).toBe("decided");
  });

  test("no company, no decision", () => {
    expect(decideState(null, row())).toBe("view");
  });
});

describe("APPROVAL_KINDS", () => {
  // Completeness against the server's kinds is checked at compile time in approval-view.ts.
  test("lists each kind once and recognises only those", async () => {
    const { APPROVAL_KINDS, isApprovalKind } = await import("./approval-view");
    expect(new Set(APPROVAL_KINDS).size).toBe(APPROVAL_KINDS.length);
    expect(APPROVAL_KINDS.every(isApprovalKind)).toBe(true);
    expect(isApprovalKind("nope")).toBe(false);
    expect(isApprovalKind(undefined)).toBe(false);
  });
});
