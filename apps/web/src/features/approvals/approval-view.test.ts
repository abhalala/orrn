import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";

import { APPROVAL_TONE, approvalSubject, decideState, reallocateMoveOf, subjectCodes, type ApprovalForView } from "./approval-view";

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

describe("BACKLOG 34: a move request says what moves", () => {
  const kd = { customerName: "KD Extrusion", orderNumber: "SO-1", lineNo: 1 };
  const royal = { customerName: "Royal Aluminium", orderNumber: "SO-4", lineNo: 1 };
  const meta = {
    bundleIds: ["b1", "b2"],
    orderIds: ["dev-so-1", "so-4"],
    reasonCode: "length_mismatch",
    kgG: 119_046,
    move: {
      count: 2,
      kgG: 119_046,
      from: [kd],
      to: royal,
      bundles: [
        { serial: "26J4001", weightG: 62_000, from: kd },
        { serial: "26J4002", weightG: 57_046, from: kd },
      ],
    },
  };

  test("the summary is read from the request's meta", () => {
    expect(reallocateMoveOf(meta)).toEqual({
      count: 2,
      kgG: 119_046,
      from: [kd],
      to: royal,
      bundles: meta.move.bundles,
      reasonCode: "length_mismatch",
      orderId: "dev-so-1",
    });
    expect(reallocateMoveOf({ bundleIds: ["b1"], kgG: 5 })).toBeNull();
  });

  test("the title names bundles, kg, from and to, and links the order (en and hi)", () => {
    const subject = approvalSubject(row({ kind: "order_reallocate", meta }));
    expect(subject).toEqual({
      kindKey: "approvals.kind.order_reallocate",
      titleKey: "approvals.subject.reallocate",
      vars: { count: 2, kg: "119.046", from: "KD Extrusion", to: "Royal Aluminium SO-4" },
      href: "/orders/dev-so-1",
      openKey: "approvals.openOrder",
    });
    expect(createI18n("en").t(subject.titleKey, subject.vars)).toBe("2 bundles, 119.046 kg: KD Extrusion to Royal Aluminium SO-4");
    expect(createI18n("hi").t(subject.titleKey, subject.vars)).toBe("2 bundle, 119.046 kg: KD Extrusion से Royal Aluminium SO-4 को");
    expect(subjectCodes(subject)).toContain("SO-4");
    // Plant stock as a source is worded, not blank.
    const fromPlant = approvalSubject(row({ kind: "order_reallocate", meta: { ...meta, move: { ...meta.move, from: [null, kd] } } }), { plant: "plant stock" });
    expect(fromPlant.vars.from).toBe("plant stock, KD Extrusion");
  });

  test("a request from before the summary keeps the generic title", () => {
    expect(approvalSubject(row({ kind: "order_reallocate", meta: { bundleIds: ["b1"] } })).titleKey).toBe("approvals.subject.generic");
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

describe("W3-AG-W: an ageing override request", () => {
  const request = (over: Partial<ApprovalForView> = {}): ApprovalForView => ({
    kind: "ageing_override",
    status: "pending",
    subjectId: "dev-ageing-batch-2",
    requestedBy: "u-supervisor",
    meta: { number: "AG-2", soak: "under_aged", inBandMin: 60 },
    ...over,
  });

  test("names the batch, links to it and keeps its number on one line", () => {
    const subject = approvalSubject(request());
    expect(subject.kindKey).toBe("approvals.kind.ageing_override");
    expect(subject.titleKey).toBe("approvals.subject.ageingOverride");
    expect(subject.vars).toEqual({ number: "AG-2" });
    expect(subject.href).toBe("/ageing/batch/dev-ageing-batch-2");
    expect(subject.openKey).toBe("approvals.openBatch");
    expect(subjectCodes(subject)).toContain("AG-2");
  });

  test("says so in all three languages", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = createI18n(lang).t;
      const subject = approvalSubject(request());
      expect(t(subject.titleKey, subject.vars)).toContain("AG-2");
      expect(t(subject.openKey!)).not.toBe(subject.openKey);
    }
  });

  test("an id that is not an id is no link", () => {
    expect(approvalSubject(request({ subjectId: "../x y" })).href).toBeNull();
  });

  test("the manager decides, the requester never does", () => {
    expect(decideState(me("manager"), request())).toBe("decide");
    expect(decideState(me("supervisor", "u-other"), request())).toBe("view");
    expect(decideState(me("supervisor", "u-supervisor"), request())).toBe("own");
    expect(decideState(me("manager", "u-supervisor"), request())).toBe("own");
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

describe("approvalsPageInput", () => {
  test("pages by offset at a fixed size, so 'Show more' never asks the server for more than its 200 cap", async () => {
    const { APPROVALS_PAGE, approvalsPageInput, nextApprovalsOffset } = await import("./approval-view");
    expect(APPROVALS_PAGE).toBe(25);
    for (const offset of [0, 25, 200, 225, 5_000]) {
      const input = approvalsPageInput({ status: "approved", kind: undefined }, offset);
      expect(input).toEqual({ status: "approved", kind: undefined, limit: 25, offset });
      expect(input.limit).toBeLessThanOrEqual(200);
    }
    // The server's nextOffset drives the next page; null ends the list.
    expect(nextApprovalsOffset({ nextOffset: 225 })).toBe(225);
    expect(nextApprovalsOffset({ nextOffset: null })).toBeUndefined();
  });
});

describe("canOpenSubject", () => {
  test("a D/C note's lot link only for purchase readers (foundry and die room see the inbox, not purchase)", async () => {
    const { canOpenSubject } = await import("./approval-view");
    expect(canOpenSubject(me("manager"), row())).toBe(true);
    expect(canOpenSubject(me("office"), row())).toBe(true);
    expect(canOpenSubject(me("foundry"), row())).toBe(false);
    expect(canOpenSubject(me("die_room"), row())).toBe(false);
    expect(canOpenSubject(null, row())).toBe(false);
    // A die tier change keeps its die link.
    expect(canOpenSubject(me("die_room"), row({ kind: "die_rerank", meta: { code: "1-A", sectionId: "s-1", toRank: 1 } }))).toBe(true);
  });
});
