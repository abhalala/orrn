import { describe, expect, test } from "bun:test";

import {
  DIE_COPY_EVENTS,
  DIE_COPY_STATUSES,
  DIE_OWNER_OVERRIDE_PURPOSES,
  canCancelIssue,
  canEditDieCard,
  canIssueDie,
  canReturnDie,
  decideDieOwner,
  dieCopyCode,
  dieCopyNext,
  effectiveDieOwner,
  issueAfterLog,
  normalizeDieCopySearch,
  planTierChange,
  tierChangeNext,
} from "./dieRoom";
import {
  PRESS_RUN_EVENTS,
  canReleasePlan,
  canStartRun,
  planNextOnRuns,
  pressRunNext,
  recoveryBp,
} from "./pressRun";

describe("die copy status machine (FP-DR §6)", () => {
  test("the shared enum, in order", () => {
    expect([...DIE_COPY_STATUSES]).toEqual(["available", "in_use", "at_nitriding", "at_maker", "retired"]);
  });

  test("every move starts from the rack or returns to it", () => {
    expect(dieCopyNext("available", "issue")).toBe("in_use");
    expect(dieCopyNext("in_use", "issueReturn")).toBe("available");
    expect(dieCopyNext("in_use", "issueCancel")).toBe("available");
    expect(dieCopyNext("available", "nitridingOut")).toBe("at_nitriding");
    expect(dieCopyNext("at_nitriding", "nitridingBack")).toBe("available");
    expect(dieCopyNext("available", "makerSend")).toBe("at_maker");
    expect(dieCopyNext("at_maker", "makerReceive")).toBe("available");
    expect(dieCopyNext("at_maker", "makerCancel")).toBe("available");
    expect(dieCopyNext("available", "retire")).toBe("retired");
  });

  test("retire from in_use, at_nitriding or at_maker is refused; a retired copy never moves", () => {
    expect(dieCopyNext("in_use", "retire")).toBeNull();
    expect(dieCopyNext("at_nitriding", "retire")).toBeNull();
    expect(dieCopyNext("at_maker", "retire")).toBeNull();
    for (const e of DIE_COPY_EVENTS) expect(dieCopyNext("retired", e)).toBeNull();
  });

  test("issue only from available (not in_use, nitriding, maker)", () => {
    expect(dieCopyNext("in_use", "issue")).toBeNull();
    expect(dieCopyNext("at_nitriding", "issue")).toBeNull();
    expect(dieCopyNext("at_maker", "issue")).toBeNull();
  });

  test("card edits refused on a press or at the maker", () => {
    expect(canEditDieCard("in_use")).toBe(false);
    expect(canEditDieCard("at_maker")).toBe(false);
    expect(canEditDieCard("available")).toBe(true);
    expect(canEditDieCard("at_nitriding")).toBe(true);
  });

  test("copy code is hyphenated and a typed slash finds it", () => {
    expect(dieCopyCode("12170", 2)).toBe("12170-2");
    expect(normalizeDieCopySearch(" 12170/2 ")).toBe("12170-2");
  });
});

describe("tier change and lift (FP-DR-10)", () => {
  const copy = { tierRank: 2, bandId: null };

  test("rank only: band ids stay null", () => {
    const r = planTierChange({ copy, toRank: 1 });
    expect(r).toEqual({
      ok: true,
      plan: { fromRank: 2, toRank: 1, fromBandId: null, toBandId: null, isLift: false, rankChanged: true },
    });
  });

  test("lift to a band keeps the rank; back to primary is toBandId null with lift", () => {
    const up = planTierChange({ copy, lift: true, toBandId: "band-heavy" });
    expect(up.ok && up.plan).toEqual({ fromRank: 2, toRank: 2, fromBandId: null, toBandId: "band-heavy", isLift: true, rankChanged: false });
    const back = planTierChange({ copy: { tierRank: 2, bandId: "band-heavy" }, lift: true, toBandId: null });
    expect(back.ok && back.plan.toBandId).toBeNull();
    expect(back.ok && back.plan.fromBandId).toBe("band-heavy");
  });

  test("refusals: nothing changes, bad rank, one pending per copy", () => {
    expect(planTierChange({ copy, toRank: 2 })).toEqual({ ok: false, error: "nothing_changes" });
    expect(planTierChange({ copy: { tierRank: null, bandId: null } })).toEqual({ ok: false, error: "bad_rank" });
    expect(planTierChange({ copy, toRank: 0 })).toEqual({ ok: false, error: "bad_rank" });
    expect(planTierChange({ copy, toRank: 1, pendingExists: true })).toEqual({ ok: false, error: "pending_exists" });
    expect(planTierChange({ copy: { tierRank: 1, bandId: "b" }, lift: true, toBandId: "b" })).toEqual({ ok: false, error: "nothing_changes" });
  });

  test("pending -> applied | rejected, never again", () => {
    expect(tierChangeNext("pending", "approved")).toBe("applied");
    expect(tierChangeNext("pending", "rejected")).toBe("rejected");
    expect(tierChangeNext("applied", "rejected")).toBeNull();
  });
});

describe("ownership (C1, C2, C4, PK §4 step 3)", () => {
  test("purposes include press (D6)", () => {
    expect([...DIE_OWNER_OVERRIDE_PURPOSES]).toEqual(["plan", "press", "pack", "dispatch"]);
  });

  test("effective owner: copy, else section, else none", () => {
    expect(effectiveDieOwner("c", "s")).toBe("c");
    expect(effectiveDieOwner(null, "s")).toBe("s");
    expect(effectiveDieOwner(null, null)).toBeNull();
  });

  test("plant-owned die passes for anyone, plant stock included", () => {
    const d = decideDieOwner({ sectionOwnerId: null, sectionCopyCount: 2, copy: { ownerCustomerId: null }, customerId: null, hasLiveGrant: false });
    expect(d).toEqual({ ok: true, ownerCustomerId: null, viaGrant: false });
  });

  test("owned die for its owner passes; for another party refused naming the owner", () => {
    const base = { sectionOwnerId: "bhavesh", sectionCopyCount: 3, copy: { ownerCustomerId: null }, hasLiveGrant: false };
    expect(decideDieOwner({ ...base, customerId: "bhavesh" }).ok).toBe(true);
    expect(decideDieOwner({ ...base, customerId: "anshu" })).toEqual({ ok: false, block: "owned", ownerCustomerId: "bhavesh" });
    expect(decideDieOwner({ ...base, customerId: null })).toEqual({ ok: false, block: "owned", ownerCustomerId: "bhavesh" });
  });

  test("a live grant lets the other party through; never plant stock", () => {
    const base = { sectionOwnerId: "bhavesh", sectionCopyCount: 3, copy: { ownerCustomerId: null }, hasLiveGrant: true };
    expect(decideDieOwner({ ...base, customerId: "anshu" })).toEqual({ ok: true, ownerCustomerId: "bhavesh", viaGrant: true });
    expect(decideDieOwner({ ...base, customerId: null }).ok).toBe(false);
  });

  test("copy-level owner under a plant section", () => {
    const d = decideDieOwner({ sectionOwnerId: null, sectionCopyCount: 3, copy: { ownerCustomerId: "bhavesh" }, customerId: "anshu", hasLiveGrant: false });
    expect(d).toEqual({ ok: false, block: "owned", ownerCustomerId: "bhavesh" });
  });

  test("no copy picked: 'Pick the die copy', or 'This section has no copies'", () => {
    expect(decideDieOwner({ sectionOwnerId: "bhavesh", sectionCopyCount: 2, copy: null, customerId: "bhavesh", hasLiveGrant: false })).toEqual({
      ok: false,
      block: "pick_copy",
      ownerCustomerId: "bhavesh",
    });
    expect(decideDieOwner({ sectionOwnerId: "bhavesh", sectionCopyCount: 0, copy: null, customerId: "anshu", hasLiveGrant: false })).toEqual({
      ok: false,
      block: "no_copies",
      ownerCustomerId: "bhavesh",
    });
    expect(decideDieOwner({ sectionOwnerId: null, anyCopyOwned: true, sectionCopyCount: 2, copy: null, customerId: "anshu", hasLiveGrant: false }).ok).toBe(false);
    expect(decideDieOwner({ sectionOwnerId: null, sectionCopyCount: 2, copy: null, customerId: "anshu", hasLiveGrant: false }).ok).toBe(true);
  });
});

describe("die issue lock (FP-DR-16, C6, C43)", () => {
  const copy = { status: "available" as const, sectionId: "s1" };

  test("issue from available onto a queued run of the same section and line", () => {
    expect(canIssueDie({ copy, openIssueForCopy: false, pressLineId: "p1", run: { status: "queued", sectionId: "s1", pressLineId: "p1" } })).toEqual({ ok: true });
    expect(canIssueDie({ copy, openIssueForCopy: false, pressLineId: "p1" })).toEqual({ ok: true });
  });

  test("refusals", () => {
    expect(canIssueDie({ copy, openIssueForCopy: true, pressLineId: "p1" })).toEqual({ ok: false, refusal: "open_issue_exists" });
    expect(canIssueDie({ copy: { ...copy, status: "at_nitriding" }, openIssueForCopy: false, pressLineId: "p1" })).toEqual({
      ok: false,
      refusal: "copy_not_available",
    });
    expect(canIssueDie({ copy, openIssueForCopy: false, pressLineId: "p1", run: { status: "die_issued", sectionId: "s1", pressLineId: "p1" } })).toEqual({
      ok: false,
      refusal: "run_not_queued",
    });
    expect(canIssueDie({ copy, openIssueForCopy: false, pressLineId: "p1", run: { status: "queued", sectionId: "s2", pressLineId: "p1" } })).toEqual({
      ok: false,
      refusal: "section_mismatch",
    });
    expect(canIssueDie({ copy, openIssueForCopy: false, pressLineId: "p1", run: { status: "queued", sectionId: "s1", pressLineId: "p2" } })).toEqual({
      ok: false,
      refusal: "line_mismatch",
    });
  });

  test("return refused between die-in and die-out", () => {
    expect(canReturnDie({ issueStatus: "issued", run: { dieInAt: 1, dieOutAt: null } })).toEqual({ ok: false, refusal: "die_on_press" });
    expect(canReturnDie({ issueStatus: "issued", run: { dieInAt: 1, dieOutAt: 2 } })).toEqual({ ok: true });
    expect(canReturnDie({ issueStatus: "issued", run: null })).toEqual({ ok: true });
    expect(canReturnDie({ issueStatus: "returned" })).toEqual({ ok: false, refusal: "not_issued" });
  });

  test("cancel only before die-in while the run is die_issued", () => {
    expect(canCancelIssue({ issueStatus: "issued", run: { status: "die_issued", dieInAt: null } })).toBe(true);
    expect(canCancelIssue({ issueStatus: "issued", run: { status: "running", dieInAt: 5 } })).toBe(false);
    expect(canCancelIssue({ issueStatus: "cancelled", run: null })).toBe(false);
  });

  test("after log the issue returns unless the next queued run uses the same copy", () => {
    expect(issueAfterLog({ copyId: "c1", nextQueuedRunCopyId: "c1" })).toBe("carry_to_next");
    expect(issueAfterLog({ copyId: "c1", nextQueuedRunCopyId: "c2" })).toBe("return");
    expect(issueAfterLog({ copyId: "c1", nextQueuedRunCopyId: null })).toBe("return");
  });
});

describe("press run machine (C6, C7, PR §6)", () => {
  test("queued -> die_issued -> running -> stopped -> counting -> logged", () => {
    expect(pressRunNext("queued", "issue")).toBe("die_issued");
    expect(pressRunNext("die_issued", "start")).toBe("running");
    expect(pressRunNext("running", "stop")).toBe("stopped");
    expect(pressRunNext("stopped", "count")).toBe("counting");
    expect(pressRunNext("counting", "close")).toBe("logged");
    expect(pressRunNext("logged", "reopen")).toBe("counting");
  });

  test("start needs die_issued; void only before start; no 'ready'", () => {
    expect(pressRunNext("queued", "start")).toBeNull();
    expect(pressRunNext("queued", "void")).toBe("voided");
    expect(pressRunNext("die_issued", "void")).toBe("voided");
    expect(pressRunNext("running", "void")).toBeNull();
    expect(pressRunNext("die_issued", "unissue")).toBe("queued");
    expect(PRESS_RUN_EVENTS.length).toBe(10);
  });

  test("start lock: open issue must match copy and line; one running run per line", () => {
    const run = { status: "die_issued" as const, dieInstanceId: "c1", pressLineId: "p1" };
    const openIssue = { dieInstanceId: "c1", pressLineId: "p1" };
    expect(canStartRun({ run, openIssue, lineHasRunningRun: false })).toEqual({ ok: true });
    expect(canStartRun({ run: { ...run, status: "queued" }, openIssue, lineHasRunningRun: false })).toEqual({ ok: false, refusal: "not_issued" });
    expect(canStartRun({ run, openIssue: null, lineHasRunningRun: false })).toEqual({ ok: false, refusal: "no_open_issue" });
    expect(canStartRun({ run, openIssue: { ...openIssue, dieInstanceId: "c2" }, lineHasRunningRun: false })).toEqual({ ok: false, refusal: "issue_mismatch" });
    expect(canStartRun({ run, openIssue, lineHasRunningRun: true })).toEqual({ ok: false, refusal: "line_busy" });
  });

  test("recovery: 234.2 of 310.4 kg is 7545 bp (75.5 %)", () => {
    expect(recoveryBp(234_200, 310_400)).toBe(7545);
    expect(recoveryBp(1, 0)).toBeNull();
  });
});

describe("press plan (FP-OP-11..13)", () => {
  const H = 60 * 60 * 1000;
  test("release: draft, window 0 < span <= 24 h, at least one die and line", () => {
    expect(canReleasePlan({ status: "draft", windowStartMs: 0, windowEndMs: 24 * H, dieCount: 1, lineCount: 1 })).toEqual({ ok: true });
    expect(canReleasePlan({ status: "draft", windowStartMs: 0, windowEndMs: 24 * H + 1, dieCount: 1, lineCount: 1 })).toEqual({ ok: false, refusal: "window" });
    expect(canReleasePlan({ status: "draft", windowStartMs: 5, windowEndMs: 5, dieCount: 1, lineCount: 1 })).toEqual({ ok: false, refusal: "window" });
    expect(canReleasePlan({ status: "draft", windowStartMs: 0, windowEndMs: H, dieCount: 1, lineCount: 0 })).toEqual({ ok: false, refusal: "empty" });
    expect(canReleasePlan({ status: "released", windowStartMs: 0, windowEndMs: H, dieCount: 1, lineCount: 1 })).toEqual({ ok: false, refusal: "not_draft" });
  });

  test("cancel a released plan only while every run is still queued; close when all are finished", () => {
    expect(planNextOnRuns("released", ["queued", "queued"], "cancel")).toEqual({ ok: true, to: "cancelled" });
    expect(planNextOnRuns("released", ["queued", "die_issued"], "cancel")).toEqual({ ok: false, refusal: "runs_started" });
    expect(planNextOnRuns("released", ["logged", "voided"], "close")).toEqual({ ok: true, to: "closed" });
    expect(planNextOnRuns("released", ["logged", "running"], "close")).toEqual({ ok: false, refusal: "runs_open" });
    expect(planNextOnRuns("draft", [], "cancel")).toEqual({ ok: true, to: "cancelled" });
  });
});
