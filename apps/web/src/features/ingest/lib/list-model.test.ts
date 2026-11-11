import { describe, expect, test } from "bun:test";

import {
  approveAllConfirm, approveAllEligible, defaultSegment, fileGroups, fitWords, foundSummary, listSegments, listStatus, mergeBar,
  mergeConfirm, rowAction, rowTitle, segmentOf, statusChip, uploadLayout, uploadStrip,
} from "./list-model";
import type { UploadItem } from "./upload";
import type { CandidateCounts, CandidateState, CandidateSummary } from "./types";

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 10, create: 0, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});
const cand = (over: Partial<CandidateSummary> & { counts?: Partial<CandidateCounts> } = {}): CandidateSummary => {
  const { counts: c, ...rest } = over;
  return {
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null, fit: "exact", fitScore: 950,
    state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 1, dryCursor: 0, counts: counts(c), openQuestions: 0, botAttempts: 0,
    recipeLocked: false, fileName: "dies-b-RCQCZ.csv", sheetName: null, blockOrdinal: 0, updatedAt: 0, ...rest,
  };
};
const can = { merge: true, upload: true };

describe("segments (M2, M3, M4)", () => {
  test("a ready import with open questions is under Needs you; one being checked is in no segment; held needs you", () => {
    expect(segmentOf(cand({ state: "ready", openQuestions: 2 }))).toBe("needsYou");
    expect(segmentOf(cand({ state: "ready" }))).toBe("ready");
    expect(segmentOf(cand({ state: "processing" }))).toBeNull();
    expect(segmentOf(cand({ state: "held" }))).toBe("needsYou");
    expect(segmentOf(cand({ state: "discarded" }))).toBeNull();
    expect(segmentOf(cand({ state: "merging" }))).toBe("approved");
  });

  test("the four segments carry their counts, and Needs you is the default when it has any", () => {
    const list = [
      cand({ id: "1", state: "needs_shape" }), cand({ id: "2", state: "held" }), cand({ id: "3", state: "ready", openQuestions: 1 }),
      cand({ id: "4", state: "ready" }), cand({ id: "5", state: "approved" }), cand({ id: "6", state: "merged" }),
      cand({ id: "7", state: "processing" }), cand({ id: "8", state: "discarded" }),
    ];
    const segments = listSegments(list);
    expect(segments.map((s) => [s.id, s.count])).toEqual([["needsYou", 3], ["ready", 1], ["approved", 1], ["merged", 1]]);
    expect(segments.map((s) => s.labelKey)).toEqual(["ingest.group.needsYou", "ingest.group.ready", "ingest.group.approved", "ingest.group.merged"]);
    expect(defaultSegment(segments)).toBe("needsYou");
    expect(defaultSegment(listSegments([cand({ state: "ready" })]))).toBe("ready");
    expect(defaultSegment(listSegments([]))).toBe("ready");
  });
});

describe("status block", () => {
  test("approved above 0 is green with rows that will be added and updated", () => {
    const status = listStatus([
      cand({ state: "approved", counts: { create: 1400, update: 2 } }), cand({ state: "approved", counts: { create: 2_00_000 } }),
      cand({ state: "held" }),
    ], { count: (n) => (n >= 1000 ? n.toLocaleString("en-IN") : String(n)) });
    expect(status).toMatchObject({ tone: "success", titleKey: "ingest.list.ready", value: 2 });
    expect(status!.meta).toEqual({ key: "ingest.list.mergeMeta", vars: { created: "2,01,400", updated: "2" } });
    expect(status!.unit).toEqual({ key: "ingest.list.importsUnit", vars: { count: 2 } });
  });
  test("else needs-you above 0 is amber, else nothing", () => {
    expect(listStatus([cand({ state: "needs_shape" }), cand({ state: "ready" })])).toMatchObject({ tone: "warning", value: 1, titleKey: "ingest.group.needsYou", meta: null });
    expect(listStatus([cand({ state: "ready" })])).toBeNull();
    expect(listStatus([])).toBeNull();
  });
});

describe("the row", () => {
  test("title: the target with the sheet after it; no target is the sheet name, or New table", () => {
    expect(rowTitle({ target: "dies", sheetName: "Sheet1" })).toEqual({ kind: "target", key: "ingest.target.dies", sheetName: "Sheet1" });
    expect(rowTitle({ target: null, sheetName: "Old list" })).toEqual({ kind: "sheet", name: "Old list", sheetName: null });
    expect(rowTitle({ target: null, sheetName: " " })).toMatchObject({ kind: "newTable", key: "ingest.list.newTable" });
    expect(rowTitle({ target: null, sheetName: null })).toMatchObject({ kind: "newTable" });
  });

  test("fit text, hidden when the state says it", () => {
    expect(fitWords(cand({ fit: "exact" }))).toEqual({ key: "ingest.fit.exact" });
    expect(fitWords(cand({ fit: "bot" }))).toEqual({ key: "ingest.fit.bot" });
    expect(fitWords(cand({ fit: "manual" }))).toEqual({ key: "ingest.fit.manual" });
    expect(fitWords(cand({ fit: "none" }))).toEqual({ key: "ingest.fit.none" });
    expect(fitWords(cand({ fit: "near", holeName: "Dies old" }))).toEqual({ key: "ingest.fit.nearNamed", vars: { name: "Dies old" } });
    expect(fitWords(cand({ fit: "near", holeName: null }))).toEqual({ key: "ingest.fit.near" });
    expect(fitWords(cand({ state: "needs_shape", fit: "none" }))).toBeNull();
    expect(fitWords(cand({ state: "needs_confirm", fit: "near" }))).toBeNull();
  });

  test("the chip: a ready import with questions says how many, in amber", () => {
    expect(statusChip(cand({ state: "ready", openQuestions: 3 }))).toEqual({ words: { key: "ingest.state.questions", vars: { count: 3 } }, tone: "warning" });
    expect(statusChip(cand({ state: "ready" }))).toEqual({ words: { key: "ingest.state.ready" }, tone: "success" });
    expect(statusChip(cand({ state: "held" }))).toEqual({ words: { key: "ingest.state.held" }, tone: "info" });
  });

  test("one action per row", () => {
    const a = (over: Parameters<typeof cand>[0], c = can) => rowAction(cand(over), c);
    expect(a({ state: "ready" })).toMatchObject({ kind: "approve", variant: "primary", mode: "write" });
    expect(a({ state: "ready", openQuestions: 1 })).toMatchObject({ kind: "review", mode: "link" });
    expect(a({ state: "ready" }, { merge: false, upload: true })).toMatchObject({ kind: "review" });
    expect(a({ state: "failed" })).toMatchObject({ kind: "review" });
    expect(a({ state: "held" })).toMatchObject({ kind: "review" });
    expect(a({ state: "needs_shape" })).toMatchObject({ kind: "mapColumns", labelKey: "ingest.action.mapColumns" });
    expect(a({ state: "needs_confirm" })).toMatchObject({ kind: "checkLayout" });
    expect(a({ state: "approved" })).toMatchObject({ kind: "hold", variant: "secondary" });
    expect(a({ state: "merged" })).toBeNull();
    expect(a({ state: "processing" })).toBeNull();
    expect(a({ state: "merging" })).toBeNull();
  });
});

describe("file groups", () => {
  const artifact = (id: string, over: Record<string, unknown> = {}) => ({ id, createdAt: Date.UTC(2026, 10, 11), kind: "csv" as const, periodConfirmed: null, ...over });

  test("rows are grouped by file, newest file first, with the table count and the date", () => {
    const list = [
      cand({ id: "1", artifactId: "old", fileName: "old.csv" }), cand({ id: "2", artifactId: "new", fileName: "new.csv", blockOrdinal: 1 }),
      cand({ id: "3", artifactId: "new", fileName: "new.csv", blockOrdinal: 0 }), cand({ id: "4", artifactId: "new", fileName: "new.csv", state: "merged" }),
    ];
    const groups = fileGroups(list, "ready", [artifact("old", { createdAt: 1000 }), artifact("new")], can, { date: (ms) => `d${ms}` });
    expect(groups.map((g) => g.artifactId)).toEqual(["new", "old"]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["3", "2"]);
    expect(groups[0]!.summary).toEqual({ key: "ingest.list.tables", vars: { count: 3, date: `d${Date.UTC(2026, 10, 11)}` } });
  });

  test("a file the artifact list does not know yet still shows, without a date", () => {
    const groups = fileGroups([cand()], "ready", [], can);
    expect(groups[0]!.summary).toEqual({ key: "ingest.list.tablesNoDate", vars: { count: 1 } });
    expect(groups[0]!.approveAll).toBeNull();
  });

  test("the row carries its numbers, fit, chip and action", () => {
    const [group] = fileGroups([cand({ counts: { create: 1400, refused: 2 }, openQuestions: 0 })], "ready", [artifact("a1")], can);
    const row = group!.rows[0]!;
    expect(row.numbers).toEqual({ create: 1400, update: 0, questions: 0, cannot: 2 });
    expect(row.fit).toEqual({ key: "ingest.fit.exact" });
    expect(row.action?.kind).toBe("approve");
    expect(row.title.kind).toBe("target");
  });
});

describe("Approve all N (lead answer 4)", () => {
  const ok = (id: string, over: Partial<CandidateSummary> = {}) => cand({ id, ...over });
  const parser = { kind: "csv" as const, periodConfirmed: null };

  test("only exact fit, nothing to answer, ready, read by a parser", () => {
    const ids = approveAllEligible(
      [ok("a"), ok("b", { openQuestions: 1 }), ok("c", { fit: "near" }), ok("d", { fit: "bot" }), ok("e", { state: "held" }), ok("f")],
      parser,
    );
    expect(ids).toEqual(["a", "f"]);
  });
  test("a file read by a model never gets a bulk press", () => {
    expect(approveAllEligible([ok("a"), ok("b")], { ...parser, kind: "pdf_scan" })).toEqual([]);
    expect(approveAllEligible([ok("a"), ok("b")], { ...parser, kind: "image" })).toEqual([]);
  });
  test("orders and bundles wait for a confirmed year; an unknown file has none", () => {
    expect(approveAllEligible([ok("a", { target: "orders" }), ok("b", { target: "bundles" }), ok("c")], parser)).toEqual(["c"]);
    expect(approveAllEligible([ok("a", { target: "orders" })], { ...parser, periodConfirmed: { fy: "2025-26", asOf: "2026-03-31" } })).toEqual(["a"]);
    expect(approveAllEligible([ok("a")], undefined)).toEqual([]);
  });
  test("the file's group offers it only with two or more, and asks once with the count", () => {
    const artifacts = [{ id: "a1", createdAt: 1, kind: "csv" as const, periodConfirmed: null }];
    const one = fileGroups([ok("a")], "ready", artifacts, can);
    expect(one[0]!.approveAll).toBeNull();
    const two = fileGroups([ok("a"), ok("b", { blockOrdinal: 1 })], "ready", artifacts, can);
    expect(two[0]!.approveAll).toEqual({ ids: ["a", "b"], count: 2 });
    const confirm = approveAllConfirm(two[0]!);
    expect(confirm!.title).toEqual({ key: "ingest.bulk.title", vars: { count: 2 } });
    expect(confirm!.confirm).toEqual({ key: "ingest.bulk.confirm", vars: { count: 2 } });
    expect(approveAllConfirm(one[0]!)).toBeNull();
  });
});

describe("the sticky merge bar (M5)", () => {
  test("from 1 approved import: summary and the merge button", () => {
    const bar = mergeBar([cand({ state: "approved", counts: { create: 700, update: 2 } }), cand({ state: "ready" })], null, true);
    expect(bar.show).toBe(true);
    expect(bar.summary).toEqual({ key: "ingest.list.bar", vars: { count: 1, rows: "702" } });
    expect(bar.merge).toEqual({ count: 1, words: { key: "ingest.action.mergeAll", vars: { count: 1 } } });
    expect(bar.hint).toBeNull();
  });
  test("nothing approved: no bar, one muted line", () => {
    const bar = mergeBar([cand({ state: "ready" })], null, true);
    expect(bar).toMatchObject({ show: false, merge: null, summary: null, hint: { key: "ingest.action.mergeNone" } });
  });
  test("a merge already running: a link to the run in place of the button", () => {
    const bar = mergeBar([cand({ state: "approved" })], "run1", true);
    expect(bar).toMatchObject({ show: true, merge: null, running: { runId: "run1" }, hint: null });
  });
  test("a person who cannot merge sees no merge button and no hint", () => {
    const bar = mergeBar([cand({ state: "approved" })], null, false);
    expect(bar).toMatchObject({ show: false, merge: null, hint: null });
  });
  test("the confirm sheet lists each approved import with its counts", () => {
    const sheet = mergeConfirm([cand({ id: "1", state: "approved", counts: { create: 5, update: 1 } }), cand({ id: "2", state: "ready" })]);
    expect(sheet.title).toEqual({ key: "ingest.merge.confirmTitle", vars: { count: 1 } });
    expect(sheet.items).toEqual([{ id: "1", title: expect.objectContaining({ kind: "target" }), fileName: "dies-b-RCQCZ.csv", create: "5", update: "1" }]);
  });
});

describe("the upload strip (M3, M6)", () => {
  const item = (over: Partial<UploadItem>): UploadItem => ({
    id: "up-1", name: "dies.csv", size: 1, kind: "csv", step: "queued", progress: null, sent: null, artifactId: null, seenOn: null,
    notStored: false, problem: null, ...over,
  });

  test("reading shows rows read of rows total and a bar", () => {
    const [entry] = uploadStrip([item({ step: "reading", progress: { sheet: "Sheet1", rowsRead: 820, rowsTotal: 1400 } as never })], [], { count: (n) => (n === 1400 ? "1,400" : String(n)), date: String });
    expect(entry).toMatchObject({ kind: "upload", progress: 820 / 1400 });
    expect((entry as { words: unknown }).words).toEqual({ key: "ingest.read.progress", vars: { done: "820", total: "1,400" } });
  });

  test("a read file says what it found and offers Review", () => {
    const list = [cand({ id: "c1", artifactId: "a1", target: "dies", fit: "exact" })];
    const [entry] = uploadStrip([item({ step: "done", artifactId: "a1" })], list);
    expect(entry).toMatchObject({ kind: "upload", actions: ["review"], found: { count: 1, firstCandidateId: "c1" } });
    const found = (entry as { found: Parameters<typeof foundSummary>[1] }).found;
    const say = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(foundSummary(say, found)).toBe('ingest.drop.done{"count":1,"summary":"ingest.target.dies, ingest.fit.exact"}');
  });

  test("seen before offers Open it, a failed file offers Retry", () => {
    const [seen] = uploadStrip([item({ step: "seenBefore", artifactId: "a1", seenOn: 5 })], [], { count: String, date: (ms) => `on ${ms}` });
    expect(seen).toMatchObject({ actions: ["open"], words: { key: "ingest.drop.seenBefore", vars: { date: "on 5" } } });
    const [failed] = uploadStrip([item({ step: "failed" })], []);
    expect(failed).toMatchObject({ actions: ["retry"], words: { key: "ingest.read.failed" } });
  });

  test("an import being checked shows in the strip with a Checking rows chip and a bar, not in a segment", () => {
    const list = [cand({ id: "p", state: "processing", counts: { total: 100, create: 40, unchanged: 10 } })];
    const strip = uploadStrip([], list);
    expect(strip).toHaveLength(1);
    expect(strip[0]).toMatchObject({ kind: "checking", candidateId: "p", chip: { key: "ingest.state.processing" }, progress: 0.5 });
    expect(listSegments(list).every((s) => s.count === 0)).toBe(true);
  });

  test("the drop zone is only for a true empty; the note shows once files are chosen", () => {
    expect(uploadLayout(false, false)).toEqual({ dropZone: true, headerAdd: false, noteField: false });
    expect(uploadLayout(true, false)).toEqual({ dropZone: false, headerAdd: true, noteField: false });
    expect(uploadLayout(false, true)).toEqual({ dropZone: false, headerAdd: true, noteField: true });
  });
});

describe("states are all covered", () => {
  test("every state either has an action or is deliberately without one", () => {
    const noAction: CandidateState[] = ["processing", "merging", "merged", "discarded"];
    for (const state of ["processing", "needs_shape", "needs_confirm", "ready", "held", "approved", "merging", "merged", "failed", "discarded"] as CandidateState[]) {
      const action = rowAction(cand({ state }), can);
      expect(action === null).toBe(noAction.includes(state));
    }
  });
});
