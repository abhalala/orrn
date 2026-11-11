import { describe, expect, test } from "bun:test";

import {
  allowedActions, approvedSummary, candidatePollMs, candidateTone, canMergeAll, classifiedRows, decisionOptions,
  diffEntries, dryRunProgress, fitDiffView, fitKeyOf, groupCandidates, groupOf, helperOffer, isRunningCandidate, isRunningRun,
  POLL_MS, questionList, questionView, rateCell, reasonLine, rowNeedsDecision, rowStateCounts, rowStateKey, rowTone,
  runPollMs, writableRows,
} from "./model";
import {
  CANDIDATE_STATES, ROW_STATES, type CandidateCounts, type CandidateState, type CandidateSummary, type IngestQuestion,
} from "./types";

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 100, create: 0, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});

const candidate = (over: Partial<CandidateSummary> & { counts?: Partial<CandidateCounts> } = {}): CandidateSummary => {
  const { counts: c, ...rest } = over;
  return {
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null,
    fit: "exact", fitScore: 950, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 1, dryCursor: 0,
    counts: counts(c), openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "dies.csv", sheetName: null,
    blockOrdinal: 0, updatedAt: 0, ...rest,
  };
};

const question = (over: Partial<IngestQuestion>): IngestQuestion => ({
  code: "unit_unknown", subject: "", params: {}, answer: null, open: true, ...over,
});

describe("candidate states", () => {
  test("every state has a tone and a group", () => {
    for (const state of CANDIDATE_STATES) {
      expect(candidateTone(state)).toBeTruthy();
      expect(groupOf(state)).toBeTruthy();
    }
  });
  test("groups follow the B10 headings", () => {
    expect(groupOf("needs_shape")).toBe("needsYou");
    expect(groupOf("needs_confirm")).toBe("needsYou");
    expect(groupOf("failed")).toBe("needsYou");
    expect(groupOf("ready")).toBe("ready");
    expect(groupOf("processing")).toBe("ready");
    expect(groupOf("approved")).toBe("approved");
    expect(groupOf("merging")).toBe("approved");
    expect(groupOf("held")).toBe("held");
    expect(groupOf("merged")).toBe("merged");
    expect(groupOf("discarded")).toBe("other");
  });
  test("groupCandidates keeps screen order and drops empty groups and discarded ones", () => {
    const list = (["merged", "ready", "held", "discarded", "needs_shape", "ready"] as CandidateState[]).map((state, i) => ({ id: String(i), state }));
    const groups = groupCandidates(list);
    expect(groups.map((g) => g.group)).toEqual(["needsYou", "ready", "held", "merged"]);
    expect(groups.map((g) => g.key)).toEqual([
      "ingest.group.needsYou", "ingest.group.ready", "ingest.group.held", "ingest.group.merged",
    ]);
    expect(groups[1]!.items).toHaveLength(2);
  });
  test("fit chips: manual and bot read as a new layout", () => {
    expect(fitKeyOf("exact")).toBe("ingest.fit.exact");
    expect(fitKeyOf("near")).toBe("ingest.fit.near");
    expect(fitKeyOf("none")).toBe("ingest.fit.none");
    expect(fitKeyOf("manual")).toBe("ingest.fit.none");
    expect(fitKeyOf("bot")).toBe("ingest.fit.none");
  });
});

describe("polling", () => {
  test("only running states poll, every 3 s", () => {
    expect(POLL_MS).toBe(3000);
    expect(candidatePollMs("processing")).toBe(3000);
    expect(candidatePollMs("merging")).toBe(3000);
    for (const state of CANDIDATE_STATES.filter((s) => s !== "processing" && s !== "merging")) {
      expect(candidatePollMs(state)).toBe(false);
    }
    expect(candidatePollMs(undefined)).toBe(false);
    expect(runPollMs("planning")).toBe(3000);
    expect(runPollMs("running")).toBe(3000);
    for (const state of ["done", "done_with_holds", "stopped"] as const) expect(runPollMs(state)).toBe(false);
    expect(isRunningCandidate("ready")).toBe(false);
    expect(isRunningRun("stopped")).toBe(false);
  });
});

describe("rows", () => {
  test("every state but pending has a chip key and a tone", () => {
    for (const state of ROW_STATES) {
      expect(rowTone(state)).toBeTruthy();
      expect(rowStateKey(state)).toBe(state === "pending" ? null : `ingest.row.${state}`);
    }
  });
  test("filter chips show only states with rows, problems first", () => {
    const chips = rowStateCounts(counts({ create: 200, refused: 3, ambiguous: 6, unchanged: 0 }));
    expect(chips.map((c) => [c.state, c.count])).toEqual([["ambiguous", 6], ["refused", 3], ["ready_create", 200]]);
    expect(chips[0]!.key).toBe("ingest.row.ambiguous");
  });
  test("a row needs a decision only when ambiguous or conflict with none", () => {
    expect(rowNeedsDecision({ state: "ambiguous", decision: null })).toBe(true);
    expect(rowNeedsDecision({ state: "conflict", decision: null })).toBe(true);
    expect(rowNeedsDecision({ state: "conflict", decision: "keep_file" })).toBe(false);
    expect(rowNeedsDecision({ state: "ready_create", decision: null })).toBe(false);
  });
  test("counts: writable, classified, progress", () => {
    const c = counts({ total: 200, create: 50, update: 10, unchanged: 20, ambiguous: 5, refused: 15 });
    expect(writableRows(c)).toBe(60);
    expect(classifiedRows(c)).toBe(100);
    expect(dryRunProgress(c)).toBe(0.5);
    expect(dryRunProgress(counts({ total: 0 }))).toBeNull();
    expect(dryRunProgress(counts({ total: 10, create: 30 }))).toBe(1);
  });
});

describe("decision menu", () => {
  const base = { options: [] as { id: string; label: string }[], mergeState: "open" as const };
  test("ambiguous: one entry per match, then add as new, then skip", () => {
    const opts = decisionOptions({ ...base, state: "ambiguous", options: [{ id: "x", label: "Shree Metals" }, { id: "y", label: "Shri Metal" }] });
    expect(opts.map((o) => o.decision)).toEqual(["use_match", "use_match", "create_new", "skip"]);
    expect(opts[0]).toMatchObject({ key: "ingest.decide.useMatch", vars: { name: "Shree Metals" }, matchId: "x" });
  });
  test("ambiguous without a match list still offers add as new and skip", () => {
    expect(decisionOptions({ ...base, state: "ambiguous" }).map((o) => o.decision)).toEqual(["create_new", "skip"]);
  });
  test("conflict: file, orrn, skip", () => {
    expect(decisionOptions({ ...base, state: "conflict" }).map((o) => o.key)).toEqual([
      "ingest.decide.keepFile", "ingest.decide.keepLive", "ingest.decide.skip",
    ]);
  });
  test("a written row, a refused row and an unchanged row have no menu; a ready row can be skipped", () => {
    expect(decisionOptions({ ...base, state: "ready_create", mergeState: "written" })).toEqual([]);
    expect(decisionOptions({ ...base, state: "refused" })).toEqual([]);
    expect(decisionOptions({ ...base, state: "unchanged" })).toEqual([]);
    expect(decisionOptions({ ...base, state: "ready_update" }).map((o) => o.decision)).toEqual(["skip"]);
  });
  test("diff entries show both sides as text", () => {
    expect(diffEntries({ phone: { live: "98250", file: "98251" }, city: { live: null, file: "Rajkot" } })).toEqual([
      { field: "phone", live: "98250", file: "98251" },
      { field: "city", live: "", file: "Rajkot" },
    ]);
    expect(diffEntries(null)).toEqual([]);
  });
  test("a hidden rate is never a value", () => {
    expect(rateCell({ rate: null, rateHidden: true })).toEqual({ hidden: true });
    expect(rateCell({ rate: 21500, rateHidden: false })).toEqual({ hidden: false, value: 21500 });
    expect(rateCell({ rate: null, rateHidden: false })).toEqual({ hidden: false, value: null });
  });
});

describe("questions", () => {
  test("each code maps to its B10 key and variables", () => {
    const view = questionView(question({ code: "unit_unknown", subject: "rate", params: { field: "Rate", kind: "price_per_mass", rows: 40 } }));
    expect(view.key).toBe("ingest.q.unit_unknown");
    expect(view.vars).toEqual({ field: "Rate" });
    expect(view.control).toEqual({ kind: "unit", field: "Rate", unitKind: "price_per_mass" });
    expect(view.answered).toBe(false);
    expect(view.rows).toBe(40);

    expect(questionView(question({ code: "date_format_ambiguous", subject: "orderDate", params: { sample: "03/04/2025" } })).vars)
      .toEqual({ sample: "03/04/2025" });
    expect(questionView(question({ code: "create_legacy_die", subject: "R 2105", params: { code: "R 2105" } })).control).toEqual({ kind: "yesNo" });
    expect(questionView(question({ code: "new_customers", params: { count: 12 } })).vars).toEqual({ count: 12 });
    expect(questionView(question({ code: "period_needed" })).control).toEqual({ kind: "period" });
    expect(questionView(question({ code: "column_meaning_unclear", subject: "X", params: { name: "Misc" } })).control).toEqual({ kind: "column" });
  });
  test("a missing variable becomes empty text, not undefined", () => {
    expect(questionView(question({ code: "create_legacy_die", subject: "x" })).vars).toEqual({ code: "" });
  });
  test("unanswered questions come first", () => {
    const list = questionList([
      question({ code: "period_needed", answer: { fy: "2025-26" }, open: false }),
      question({ code: "unit_unknown", subject: "rate", params: { field: "Rate" } }),
    ]);
    expect(list.map((q) => q.code)).toEqual(["unit_unknown", "period_needed"]);
    expect(list[1]!.answered).toBe(true);
  });
});

describe("fit diff", () => {
  test("reads a stored diff and survives a bad one", () => {
    expect(fitDiffView({ name: "Dies sheet", renamed: [{ old: "Wt", new: "Weight" }], extra: ["Notes 2"], missing: [] })).toEqual({
      name: "Dies sheet", renamed: [{ old: "Wt", new: "Weight" }], extra: ["Notes 2"], missing: [],
    });
    expect(fitDiffView(null)).toEqual({ name: null, renamed: [], extra: [], missing: [] });
    expect(fitDiffView({ renamed: [{ nope: 1 }], extra: [1, "A"] })).toEqual({ name: null, renamed: [], extra: ["A"], missing: [] });
  });
});

describe("actions and merge button", () => {
  test("approve needs ready, no open question and the merge action", () => {
    expect(allowedActions(candidate(), { merge: true, upload: true }).approve).toBe(true);
    expect(allowedActions(candidate({ openQuestions: 2 }), { merge: true, upload: true }).approve).toBe(false);
    expect(allowedActions(candidate({ state: "processing" }), { merge: true, upload: true }).approve).toBe(false);
    expect(allowedActions(candidate(), { merge: false, upload: true }).approve).toBe(false);
  });
  test("discard is refused once a row is written, while merging, and when already done", () => {
    const can = { merge: true, upload: true };
    expect(allowedActions(candidate(), can).discard).toBe(true);
    expect(allowedActions(candidate({ counts: { written: 1 } }), can).discard).toBe(false);
    expect(allowedActions(candidate({ state: "merging" }), can).discard).toBe(false);
    expect(allowedActions(candidate({ state: "merged" }), can).discard).toBe(false);
    expect(allowedActions(candidate({ state: "discarded" }), can).discard).toBe(false);
  });
  test("hold from ready or approved", () => {
    const can = { merge: true, upload: true };
    expect(allowedActions(candidate({ state: "approved" }), can).hold).toBe(true);
    expect(allowedActions(candidate({ state: "held" }), can).hold).toBe(false);
  });
  test("approved summary and the merge button", () => {
    const list = [
      candidate({ id: "1", state: "approved", counts: { create: 10, update: 2 } }),
      candidate({ id: "2", state: "approved", counts: { create: 5 } }),
      candidate({ id: "3", state: "ready", counts: { create: 99 } }),
    ];
    expect(approvedSummary(list)).toEqual({ count: 2, rows: 17 });
    expect(canMergeAll(2, null, true)).toBe(true);
    expect(canMergeAll(0, null, true)).toBe(false);
    expect(canMergeAll(2, "run1", true)).toBe(false);
    expect(canMergeAll(2, null, false)).toBe(false);
  });
  test("helper offer: auto while attempts remain, off with no key, none after 4 tries", () => {
    expect(helperOffer({ state: "needs_shape", botAttempts: 0 }, true)).toBe("auto");
    expect(helperOffer({ state: "needs_shape", botAttempts: 3 }, true)).toBe("auto");
    expect(helperOffer({ state: "needs_shape", botAttempts: 4 }, true)).toBe("none");
    expect(helperOffer({ state: "needs_shape", botAttempts: 0 }, false)).toBe("off");
    expect(helperOffer({ state: "ready", botAttempts: 0 }, true)).toBe("none");
  });
});

describe("reason lines", () => {
  test("known codes map to their keys with the right variable", () => {
    expect(reasonLine("merge_failed", "Section exists")).toEqual({ key: "ingest.reason.merge_failed", vars: { detail: "Section exists" } });
    expect(reasonLine("dependency_held", "Customers 1")).toEqual({ key: "ingest.reason.dependency_held", vars: { name: "Customers 1" } });
    expect(reasonLine("module_off", "Orders")).toEqual({ key: "ingest.reason.module_off", vars: { module: "Orders" } });
    expect(reasonLine("confirm_blocked", "No PO")).toEqual({ key: "ingest.reason.confirm_blocked", vars: { detail: "No PO" } });
  });
  test("no code gives nothing; an unknown code with detail has no key", () => {
    expect(reasonLine(null, "x")).toBeNull();
    expect(reasonLine("odd_code", "Exact words")).toEqual({ key: null, vars: { detail: "Exact words" } });
    expect(reasonLine("odd_code", null)).toBeNull();
  });
});
