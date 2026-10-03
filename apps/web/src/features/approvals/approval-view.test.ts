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
    });
  });

  test("kinds without a screen yet fall back to a code or number from meta, no link", () => {
    expect(approvalSubject(row({ kind: "cast_close", meta: { code: "K31" } }))).toEqual({
      kindKey: "approvals.kind.cast_close",
      titleKey: "approvals.subject.generic",
      vars: { ref: "K31" },
      href: null,
    });
    expect(approvalSubject(row({ kind: "phantom_void", meta: {} })).vars).toEqual({ ref: "" });
  });

  test("never trusts meta to build an unsafe link", () => {
    expect(approvalSubject(row({ meta: { number: "DN-3", lotId: "../../admin", lotNumber: "LOT-1", type: "debit" } })).href).toBeNull();
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
