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

describe("H1 (final explore): a late entry request says what is approved", () => {
  const meta = {
    reason: "Tablet was down on the night shift",
    productionDay: "2026-10-24",
    shiftSeq: 2,
    runNumber: "PR-13",
    pressLineCode: "P2",
    copyCode: "14701-2",
    // 21:00 and 23:05 IST on 24 Oct 2026.
    startedAt: Date.UTC(2026, 9, 24, 15, 30),
    stoppedAt: Date.UTC(2026, 9, 24, 17, 35),
  };

  test("title names the run and the press, and links to the run", async () => {
    const { lateEntryOf } = await import("./approval-view");
    const r = row({ kind: "press_late_entry", subjectId: "run-13", meta });
    const subject = approvalSubject(r);
    expect(subject).toMatchObject({ titleKey: "approvals.subject.lateEntry", vars: { number: "PR-13", line: "P2" }, href: "/press/runs/run-13", openKey: "approvals.openRun" });
    expect(createI18n("en").t(subject.titleKey, subject.vars)).toBe("Run PR-13 on P2, entered late");
    expect(createI18n("hi").t(subject.titleKey, subject.vars)).toBe("P2 पर रन PR-13, बाद में भरा गया");
    expect(subjectCodes(subject)).toContain("PR-13");
    expect(lateEntryOf(r)).toEqual({
      runId: "run-13",
      runNumber: "PR-13",
      pressLineCode: "P2",
      copyCode: "14701-2",
      startedAt: meta.startedAt,
      stoppedAt: meta.stoppedAt,
      productionDay: "2026-10-24",
      shiftSeq: 2,
    });
  });

  test("an older request (run number only) still links to the run; no number falls back to the kind", async () => {
    const old = approvalSubject(row({ kind: "press_late_entry", subjectId: "dev-run-13090-2-late", meta: { runNumber: "PR-9", productionDay: "2026-10-24", shiftSeq: 3 } }));
    expect(old).toMatchObject({ titleKey: "approvals.subject.lateEntryNoLine", vars: { number: "PR-9" }, href: "/press/runs/dev-run-13090-2-late" });
    const bare = approvalSubject(row({ kind: "press_late_entry", subjectId: "run-1", meta: {} }));
    expect(bare.titleKey).toBe("approvals.subject.generic");
    // A subject id that is not an id never becomes a link.
    expect(approvalSubject(row({ kind: "press_late_entry", subjectId: "../x y", meta })).href).toBeNull();
  });

  test("times are the plant's clock, whatever the device's zone; a run past midnight names both days", async () => {
    const { lateWindowText, durationText, plantTimeText } = await import("./approval-view");
    expect(lateWindowText(meta.startedAt, meta.stoppedAt, "Asia/Kolkata")).toBe("24 Oct 21:00 to 23:05");
    expect(durationText(meta.startedAt, meta.stoppedAt)).toBe("2 h 05 min");
    expect(durationText(0, 40 * 60_000)).toBe("40 min");
    expect(lateWindowText(Date.UTC(2026, 9, 24, 17, 30), Date.UTC(2026, 9, 24, 19, 0), "Asia/Kolkata")).toBe("24 Oct 23:00 to 25 Oct 00:30");
    expect(plantTimeText(meta.startedAt, "Asia/Kolkata")).toBe("24 Oct 21:00");
  });
});

describe("M6 (final explore): a band lift names the bands", () => {
  const words = { plant: "plant stock", mainBand: "main band", otherBand: "another band" };
  test("main band to the heavy band, not 'tier 2 to 2'", () => {
    const subject = approvalSubject(
      row({ kind: "die_rerank", meta: { code: "14701-2", sectionId: "die-7", fromRank: 2, toRank: 2, isLift: true, fromBandId: null, toBandId: "band-h", fromBandText: null, toBandText: "Heavy" } }),
      words,
    );
    expect(subject).toMatchObject({ titleKey: "approvals.subject.dieLift", vars: { code: "14701-2", from: "main band", to: "Heavy" }, href: "/dies/die-7" });
    expect(createI18n("en").t(subject.titleKey, subject.vars)).toBe("Copy 14701-2: main band to Heavy");
  });

  test("a lift that also changes the tier says both; an older lift with only ids says 'another band'", () => {
    const both = approvalSubject(
      row({ kind: "die_rerank", meta: { code: "14701-2", sectionId: "die-7", fromRank: 1, toRank: 2, isLift: true, fromBandId: null, toBandId: "band-h", toBandText: "6.200-6.600" } }),
      words,
    );
    expect(createI18n("en").t(both.titleKey, both.vars)).toBe("Copy 14701-2, tier 1 to 2: main band to 6.200-6.600");
    const old = approvalSubject(row({ kind: "die_rerank", meta: { code: "14701-2", sectionId: "die-7", fromRank: 2, toRank: 2, isLift: true, fromBandId: "band-h", toBandId: null } }), words);
    expect(old.vars).toMatchObject({ from: "another band", to: "main band" });
    // A plain rank change keeps its wording.
    expect(approvalSubject(row({ kind: "die_rerank", meta: { code: "1-A", sectionId: "s-1", fromRank: 2, toRank: 1, isLift: false } }), words).titleKey).toBe("approvals.subject.dieRerank");
  });
});

describe("BACKLOG 89: the sheet reads live facts for a move and for a tier change", () => {
  const moveFacts = {
    kind: "order_reallocate" as const,
    target: { customerName: "Royal Aluminium", orderNumber: "SO-9", lineNo: 1, orderOpen: true, partyRule: "series" as const },
    bundles: [
      { id: "b1", serial: "26J1", weightG: 10_000, status: "available", partyNo: "26J1", willMove: true, renumbers: true },
      { id: "b2", serial: "26J2", weightG: 11_000, status: "void", partyNo: "26J2", willMove: false, renumbers: true },
      { id: "b3", serial: "26J3", weightG: 9_000, status: "available", partyNo: "26J3", willMove: true, renumbers: false },
    ],
    willMove: { count: 2, kgG: 19_000 },
  };

  test("only move and tier requests read live facts", async () => {
    const { hasLiveFacts } = await import("./approval-view");
    expect(hasLiveFacts("order_reallocate")).toBe(true);
    expect(hasLiveFacts("die_rerank")).toBe(true);
    for (const kind of ["dc_note", "cast_close", "press_late_entry", "dispatch_overdraw"]) expect(hasLiveFacts(kind)).toBe(false);
  });

  test("move: counts what would move, names who takes a new number, marks the ones that changed", async () => {
    const { moveFactsView } = await import("./approval-view");
    const v = moveFactsView(moveFacts);
    expect(v).toMatchObject({ total: 3, moving: 2, kgG: 19_000, skipped: 1, nothingMoves: false, closed: false, partyRule: "series", customer: "Royal Aluminium" });
    expect(v.rows.map((r) => [r.serial, r.willMove, r.newNumber])).toEqual([
      ["26J1", true, true],
      ["26J2", false, false],
      ["26J3", true, false],
    ]);
    const gone = moveFactsView({ ...moveFacts, target: { ...moveFacts.target, orderOpen: false }, bundles: moveFacts.bundles.map((b) => ({ ...b, willMove: false })), willMove: { count: 0, kgG: 0 } });
    expect(gone).toMatchObject({ nothingMoves: true, closed: true });
    expect(moveFactsView({ ...moveFacts, target: null }).closed).toBe(true);
  });

  const tierFacts = {
    kind: "die_rerank" as const,
    copy: { code: "14701-2", status: "available", tierRank: 2, band: { text: "5.900-6.200", minG: 5_900, maxG: 6_200, main: true } },
    request: { fromRank: 2, toRank: 1, isLift: false, fromBandText: null, toBandText: null, status: "pending" },
    changedSince: false,
    reading: { kgPer12ftMilli: 6_480, readAt: 1_700_000_000_000 },
  };

  test("tier: now against asked, the last reading against the live band", async () => {
    const { tierFactsView } = await import("./approval-view");
    const words = { mainBand: "main band" };
    expect(tierFactsView(tierFacts, words)).toMatchObject({ code: "14701-2", nowTier: "2", askedFromTier: "2", askedToTier: "1", tierChanges: true, nowBand: "main band 5.900-6.200", bandChange: null, readingKg: "6.480", position: "above", changedSince: false });
    expect(tierFactsView({ ...tierFacts, reading: { kgPer12ftMilli: 6_000, readAt: 1 } }, words).position).toBe("inside");
    expect(tierFactsView({ ...tierFacts, reading: { kgPer12ftMilli: 5_800, readAt: 1 } }, words).position).toBe("below");
    expect(tierFactsView({ ...tierFacts, reading: null }, words)).toMatchObject({ readingKg: null, position: null });
  });

  test("tier: a lift names both bands (never 'tier 2 to 2'); a copy changed since the ask is flagged", async () => {
    const { tierFactsView } = await import("./approval-view");
    const words = { mainBand: "main band" };
    const lift = tierFactsView(
      { ...tierFacts, request: { fromRank: 2, toRank: 2, isLift: true, fromBandText: null, toBandText: "6.2-6.6", status: "pending" }, changedSince: true },
      words,
    );
    expect(lift).toMatchObject({ tierChanges: false, bandChange: { from: "main band", to: "6.2-6.6" }, changedSince: true });
    const none = tierFactsView({ ...tierFacts, copy: { ...tierFacts.copy, tierRank: null }, request: { ...tierFacts.request, fromRank: null } }, words);
    expect(none).toMatchObject({ nowTier: null, askedFromTier: null, askedToTier: "1" });
  });
});
