import { describe, expect, test } from "bun:test";

import { fileGroups, withYearOpen } from "./list-model";
import { questionList, withYearQuestion } from "./model";
import { decisionBar } from "./review-model";
import type { ArtifactSummary, CandidateCounts, CandidateDetail, CandidateSummary, IngestQuestion } from "./types";

// Design check B1: one number says what blocks Approve, on the list (chip and column), the review chip, the bar line and the
// questions panel. The server's `openQuestions` is its listed questions plus the lines that wait; it never holds the year the
// page asks in its own year line.

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 100, create: 3, update: 1, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});
const summary = (over: Partial<CandidateSummary>): CandidateSummary => ({
  id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "orders", holeRef: null, holeName: null, fit: "exact", fitScore: 950,
  state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 1, dryCursor: 0, counts: counts(), openQuestions: 0, botAttempts: 0,
  recipeLocked: false, fileName: "orders.xlsx", sheetName: "Open orders", blockOrdinal: 0, updatedAt: 0, ...over,
});
const file = (over: Partial<ArtifactSummary> = {}) =>
  ({ id: "a1", createdAt: 0, kind: "xlsx", periodConfirmed: null, ...over }) as ArtifactSummary;
const open = (code: string, subject = ""): IngestQuestion => ({ code, subject, params: {}, answer: null, open: true }) as IngestQuestion;
const ctx = { can: { merge: true, upload: true }, botReady: true, editorOpen: false };

/** Every place that shows the count, for one candidate and its file. */
function places(candidate: CandidateSummary, questions: IngestQuestion[], artifact: ArtifactSummary) {
  const [counted] = withYearOpen([candidate], [artifact]);
  const group = fileGroups([counted!], "needsYou", [artifact], ctx.can)[0]!;
  const row = group.rows[0]!;
  const detail = { ...candidate, questions, periodConfirmed: artifact.periodConfirmed } as unknown as CandidateDetail;
  const bar = decisionBar(detail, ctx);
  const panel = questionList(withYearQuestion(detail), detail.target).filter((q) => !q.answered).length;
  const chipCount = (words: { vars?: Record<string, string | number> } | undefined) => Number(words?.vars?.count);
  return {
    listChip: chipCount(row.chip.words),
    listColumn: row.numbers!.questions,
    reviewChip: chipCount(bar.chip.words),
    barTotal: Number(bar.blocked!.words.vars!.count),
    barQuestions: bar.blocked!.words.vars!.questions === undefined ? null : Number(bar.blocked!.words.vars!.questions),
    barRows: bar.blocked!.words.vars!.rows === undefined ? null : Number(bar.blocked!.words.vars!.rows),
    panel,
  };
}

describe("one count for what blocks Approve (design check B1)", () => {
  test("the open orders file: one listed question, two lines that wait, the year asked by the page", () => {
    const p = places(summary({ openQuestions: 3, counts: counts({ ambiguous: 2 }) }), [open("order_fill_above")], file());
    expect(p).toEqual({ listChip: 4, listColumn: 4, reviewChip: 4, barTotal: 4, barQuestions: 2, barRows: 2, panel: 2 });
  });

  test("the conflict file: a line that must be skipped and the year, no question listed", () => {
    const p = places(summary({ openQuestions: 1, counts: counts({ conflict: 1 }) }), [], file());
    expect(p.listChip).toBe(2);
    expect(p.listColumn).toBe(2);
    expect(p.reviewChip).toBe(2);
    expect(p.barTotal).toBe(2);
    expect(p.barQuestions).toBe(1);
    expect(p.barRows).toBe(1);
    // The panel counts the year the bar names, so the link to "the first question" has somewhere to go.
    expect(p.panel).toBe(1);
  });

  test("the year saved is nothing more to answer, on the list and on the page", () => {
    const saved = file({ periodConfirmed: { fy: "2025-26", asOf: "2026-03-31" } });
    const p = places(summary({ openQuestions: 3, counts: counts({ ambiguous: 2 }) }), [open("order_fill_above")], saved);
    expect(p).toEqual({ listChip: 3, listColumn: 3, reviewChip: 3, barTotal: 3, barQuestions: 1, barRows: 2, panel: 1 });
  });

  test("a year the server lists is counted once (the layout takes its date from the period)", () => {
    const p = places(summary({ openQuestions: 1, periodInCount: true }), [open("period_needed")], file());
    expect(p.listChip).toBe(1);
    expect(p.reviewChip).toBe(1);
    expect(p.barTotal).toBe(1);
    expect(p.panel).toBe(1);
  });

  test("a die file has no year to ask: the server's number is the number", () => {
    const p = places(summary({ target: "dies", openQuestions: 2 }), [open("unit_unknown", "rate"), open("create_legacy_die", "R 2105")], file());
    expect(p.listChip).toBe(2);
    expect(p.reviewChip).toBe(2);
    expect(p.barTotal).toBe(2);
    expect(p.panel).toBe(2);
  });
});
