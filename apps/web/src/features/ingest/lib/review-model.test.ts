import { describe, expect, test } from "bun:test";

import { questionList, questionText, sayWords } from "./model";
import { afterDecision, cardLabel, decisionBar, firstOpen, holdReason, nearChanges, nextNeedsYou, readPanel, reasonPieces, reviewDocTitle } from "./review-model";
import { plantUnitsFor } from "./plant-units";
import type { CandidateCounts, CandidateDetail } from "./types";

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 100, create: 3, update: 1, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});
const detail = (over: Record<string, unknown> = {}): Parameters<typeof decisionBar>[0] =>
  ({
    state: "ready", openQuestions: 0, counts: counts(), fit: "exact", holeName: null, fitDiff: null, reasonCode: null, reasonDetail: null,
    target: "dies", sheetName: null, fileName: "dies.csv", questions: [], botAttempts: 0, ...over,
  }) as never;
const ctx = { can: { merge: true, upload: true }, botReady: true, editorOpen: false };
const ids = (bar: ReturnType<typeof decisionBar>) => bar.buttons.map((b) => b.id);
const say = (key: string, vars?: Record<string, string | number>) => {
  const table: Record<string, string> = {
    "ingest.reason.merge_failed": "Not merged. {detail}",
    "ingest.reason.dependency_held": "Waits for {name}, which is held",
    "ingest.hold.owner": "Wait for the owner",
    "ingest.target.dies": "Dies",
    "ingest.list.newTable": "New table",
    "ingest.docTitle.review": "{target}, {file} | Imports | orrn",
  };
  return (table[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
};

describe("the chip counts everything the person must answer (item 6)", () => {
  const open = (code: string, subject = "") => ({ code, subject, params: {}, answer: null, open: true });
  test("the year and a section question are two, whatever count the summary carried", () => {
    const bar = decisionBar(detail({ openQuestions: 1, questions: [open("period_needed"), open("create_legacy_die", "R 2105")] }), ctx);
    expect(bar.chip.words).toEqual({ key: "ingest.state.questions", vars: { count: 2 } });
    expect(bar.blocked!.words).toEqual({ key: "ingest.action.approveBlocked", vars: { count: 2 } });
  });
  test("an answered question and a rate question nobody may answer are not counted", () => {
    const answered = { ...open("unit_unknown", "rate"), open: false, answer: "kg" };
    const rates = { ...open("rates_hidden"), params: { reason: "no_access" } };
    const bar = decisionBar(detail({ openQuestions: 1, questions: [open("period_needed"), answered, rates] }), ctx);
    expect(bar.chip.words).toEqual({ key: "ingest.state.questions", vars: { count: 1 } });
  });
});

describe("Wrong columns? Pick the row (rule 7.2)", () => {
  test("offered while no row is written and to a person who may upload; not once rows are merged, not to one who may not", () => {
    expect(decisionBar(detail(), ctx).overflow.map((o) => o.id)).toContain("repick");
    expect(decisionBar(detail({ counts: counts({ written: 2 }) }), ctx).overflow.map((o) => o.id)).not.toContain("repick");
    expect(decisionBar(detail(), { ...ctx, can: { merge: true, upload: false } }).overflow.map((o) => o.id)).not.toContain("repick");
  });
  test("what it says afterwards points at adding the file again", () => {
    expect(afterDecision({ kind: "repicked", approvedCount: 3, nextId: "x" })).toEqual({ words: { key: "ingest.action.repicked" }, next: null, goMerge: false });
  });
});

describe("Skip these lines (server round 9)", () => {
  test("the count comes from the candidate and is 0 when the server sends none", () => {
    expect(decisionBar(detail({ noDateLines: 4 }), ctx).noDateLines).toBe(4);
    expect(decisionBar(detail(), ctx).noDateLines).toBe(0);
  });
  test("the refusals of the action and of a locked answer are said from their own words", async () => {
    const { ingestErrorWords } = await import("./errors");
    const err = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });
    expect(ingestErrorWords(err("BAD_REQUEST", "No line on this sheet is missing a date"), "action").key).toBe("ingest.error.noDateNone");
    expect(ingestErrorWords(err("BAD_REQUEST", "A sheet of this file is approved. Its answers cannot change now."), "action").key).toBe("ingest.error.answerLocked");
    expect(ingestErrorWords(err("BAD_REQUEST", "This import does not ask that"), "action").key).toBe("ingest.error.doesNotAsk");
  });
});

describe("how the rows were read (rule 7.1)", () => {
  test("rows with no order number and rows that took party, date or PO from the row above are said once each", () => {
    const bar = decisionBar(detail({ rowsOwnOrder: 2, counts: counts({ filled: 3 }) }), ctx);
    expect(bar.notes).toEqual([
      { key: "ingest.effect.ownOrder", vars: { count: 2 } },
      { key: "ingest.effect.filled", vars: { count: 3 } },
    ]);
    expect(decisionBar(detail(), ctx).notes).toEqual([]);
  });
});

describe("the decision bar (M7)", () => {
  test("ready with nothing open: Approve is the one primary, Hold is secondary, Discard is in the menu", () => {
    const bar = decisionBar(detail(), ctx);
    expect(bar.buttons).toEqual([
      { id: "approve", words: { key: "ingest.action.approve" }, variant: "primary", mode: "write" },
      { id: "hold", words: { key: "ingest.action.hold" }, variant: "secondary", mode: "write" },
    ]);
    expect(bar.overflow.map((o) => o.id)).toEqual(["repick", "discard"]);
    expect(bar.sentence).toEqual({ key: "ingest.effect.line", vars: { create: 3, update: 1 } });
    expect(bar.chip).toEqual({ words: { key: "ingest.state.ready" }, tone: "success" });
    expect(bar.fit).toEqual({ key: "ingest.fit.exact" });
    expect(bar.blocked).toBeNull();
    expect(bar.buttons.filter((b) => b.variant === "primary")).toHaveLength(1);
  });

  test("the sentence adds how many rows cannot be imported, and says so when there is nothing to do", () => {
    expect(decisionBar(detail({ counts: counts({ refused: 4 }) }), ctx).refused).toEqual({ key: "ingest.effect.refused", vars: { count: 4 } });
    expect(decisionBar(detail({ counts: counts({ create: 0, update: 0 }) }), ctx).sentence).toEqual({ key: "ingest.effect.nothing" });
    expect(decisionBar(detail({ counts: counts({ create: 0, update: 0, refused: 2, unchanged: 1 }) }), ctx).sentence).toEqual({ key: "ingest.effect.nothing" });
  });

  test("rows that wait on answers are not empty: the sentence says how many wait, not 'Nothing to add'", () => {
    const bar = decisionBar(detail({ counts: counts({ create: 0, update: 0, ambiguous: 3 }), openQuestions: 1 }), ctx);
    expect(bar.sentence).toEqual({ key: "ingest.effect.waiting", vars: { count: 3 } });
    expect(decisionBar(detail({ counts: counts({ create: 0, update: 0, ambiguous: 2, conflict: 1 }) }), ctx).sentence).toEqual({ key: "ingest.effect.waiting", vars: { count: 3 } });
    // With something to add, the add line leads.
    expect(decisionBar(detail({ counts: counts({ create: 5, update: 0, ambiguous: 3 }) }), ctx).sentence).toEqual({ key: "ingest.effect.line", vars: { create: 5, update: 0 } });
  });

  test("ready with questions: a link that says how many, no Approve, Hold stays", () => {
    const bar = decisionBar(
      detail({ openQuestions: 1, questions: [{ code: "unit_unknown", subject: "weightMinG", params: { field: "weightMinG" }, answer: null, open: true }] }),
      ctx,
    );
    expect(bar.blocked).toEqual({ words: { key: "ingest.action.approveBlocked", vars: { count: 1 } }, to: "question" });
    expect(ids(bar)).toEqual(["hold"]);
    expect(bar.chip).toEqual({ words: { key: "ingest.state.questions", vars: { count: 1 } }, tone: "warning" });
  });

  test("undecided rows with no open question point at the rows", () => {
    const bar = decisionBar(detail({ openQuestions: 2, counts: counts({ ambiguous: 2 }) }), ctx);
    expect(bar.blocked!.to).toBe("rows");
    expect(firstOpen([{ answered: true }], 2)).toBe("rows");
    expect(firstOpen([{ answered: false }], 2)).toBe("question");
  });

  test("a person who may only upload cannot approve, and one with neither has no buttons", () => {
    expect(ids(decisionBar(detail(), { ...ctx, can: { merge: false, upload: true } }))).toEqual(["hold"]);
    expect(ids(decisionBar(detail(), { ...ctx, can: { merge: false, upload: false } }))).toEqual([]);
  });

  test("near fit: use the layout (primary) or map the columns", () => {
    const bar = decisionBar(detail({ state: "needs_confirm", fit: "near", holeName: "Die list", fitDiff: { name: "Die list", renamed: [{ col: 1, from: "Wt", to: "Weight" }], extra: [{ col: 4, header: "Remarks" }], missing: [] } }), ctx);
    expect(bar.buttons.map((b) => [b.id, b.variant])).toEqual([["useLayout", "primary"], ["rejectLayout", "secondary"]]);
    expect(bar.sentence).toEqual({ key: "ingest.near.title", vars: { name: "Die list", count: 2 } });
    expect(bar.fit).toBeNull();
    expect(bar.overflow.map((o) => o.id)).toEqual(["repick", "discard"]);
  });

  test("needs a layout: orrn first when the helper is set up, myself as a toggle; both quiet once the editor is open", () => {
    const state = detail({ state: "needs_shape", fit: "none" });
    expect(decisionBar(state, ctx).buttons.map((b) => [b.id, b.variant, b.mode])).toEqual([["mapForMe", "primary", "write"], ["mapMyself", "secondary", "toggle"]]);
    expect(decisionBar(state, { ...ctx, botReady: false }).buttons.map((b) => [b.id, b.variant])).toEqual([["mapMyself", "primary"]]);
    expect(decisionBar(state, { ...ctx, editorOpen: true }).buttons.map((b) => b.variant)).toEqual(["secondary", "secondary"]);
    expect(decisionBar(detail({ state: "needs_shape", botAttempts: 4 }), ctx).buttons.map((b) => b.id)).toEqual(["mapMyself"]);
    expect(decisionBar(state, ctx).overflow.map((o) => o.id)).toEqual(["ignore", "repick", "discard"]);
  });

  test("held (M15): Check again is primary, Approve as it is only with nothing open, the reason in amber", () => {
    const held = detail({ state: "held", reasonCode: "merge_failed", reasonDetail: "Bundle LRCQCZ is already in orrn." });
    const bar = decisionBar(held, ctx);
    expect(bar.buttons.map((b) => [b.id, b.variant])).toEqual([["release", "primary"], ["approveAsIs", "secondary"]]);
    expect(bar.reason).toEqual({ code: "merge_failed", detail: "Bundle LRCQCZ is already in orrn." });
    expect(bar.chip.tone).toBe("info");
    expect(ids(decisionBar(detail({ state: "held", openQuestions: 1 }), ctx))).toEqual(["release"]);
    expect(ids(decisionBar(held, { ...ctx, can: { merge: false, upload: true } }))).toEqual(["release"]);
  });

  test("approved: Hold and Go to merge; merged: See the file; checking rows: nothing", () => {
    expect(decisionBar(detail({ state: "approved" }), ctx).buttons.map((b) => [b.id, b.mode])).toEqual([["hold", "write"], ["goMerge", "link"]]);
    expect(decisionBar(detail({ state: "merged", counts: counts({ written: 4 }) }), ctx).buttons.map((b) => b.id)).toEqual(["seeFile"]);
    expect(decisionBar(detail({ state: "merged", counts: counts({ written: 4 }) }), ctx).overflow).toEqual([]);
    const moving = decisionBar(detail({ state: "processing" }), ctx);
    expect(moving.buttons).toEqual([]);
    expect(moving.overflow).toEqual([]);
  });

  test("at most one primary in any state", () => {
    for (const state of ["processing", "needs_shape", "needs_confirm", "ready", "held", "approved", "merging", "merged", "failed", "discarded"]) {
      for (const botReady of [true, false]) {
        const bar = decisionBar(detail({ state }), { ...ctx, botReady });
        expect(bar.buttons.filter((b) => b.variant === "primary").length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("after a decision (S6) and the next import", () => {
  test("approved says how many so far and offers the next that needs you and Go to merge", () => {
    expect(afterDecision({ kind: "approved", approvedCount: 3, nextId: "n1" })).toEqual({
      words: { key: "ingest.action.approvedSoFar", vars: { count: 3 } }, next: { id: "n1" }, goMerge: true,
    });
    expect(afterDecision({ kind: "held", approvedCount: 0, nextId: null })).toEqual({ words: { key: "ingest.action.heldDone" }, next: null, goMerge: false });
  });
  test("the next that needs you skips this import", () => {
    const list = [
      { id: "a", state: "needs_shape", openQuestions: 0, blockOrdinal: 0 }, { id: "b", state: "ready", openQuestions: 1, blockOrdinal: 1 },
      { id: "c", state: "ready", openQuestions: 0, blockOrdinal: 2 },
    ] as never[];
    expect(nextNeedsYou(list, "a")).toBe("b");
    expect(nextNeedsYou(list, "x")).toBe("a");
    expect(nextNeedsYou([list[2]!], "c")).toBeNull();
  });
});

describe("names and titles (S11)", () => {
  test("a repeated button or link names the import and its file", () => {
    expect(cardLabel(say, "Approve", { target: "dies", sheetName: null, fileName: "dies-b-RCQCZ.csv" })).toBe("Approve: Dies, dies-b-RCQCZ.csv");
    expect(cardLabel(say, "Review", { target: null, sheetName: "Old list", fileName: "x.xlsx" })).toBe("Review: Old list, x.xlsx");
    expect(cardLabel(say, "Review", { target: null, sheetName: null, fileName: "x.xlsx" })).toBe("Review: New table, x.xlsx");
  });
  test("the page title for each ingest route", () => {
    expect(reviewDocTitle(say, { target: "dies", sheetName: null, fileName: "dies.csv" })).toBe("Dies, dies.csv | Imports | orrn");
  });
});

describe("hold (S5)", () => {
  test("what is typed wins over a chip, a chip fills in when nothing is typed, no reason is fine", () => {
    expect(holdReason(say, "owner", "")).toBe("Wait for the owner");
    expect(holdReason(say, "owner", " My own words ")).toBe("My own words");
    expect(holdReason(say, null, "")).toBeUndefined();
    expect(holdReason(say, null, "x".repeat(400))).toHaveLength(300);
  });
});

describe("the reason line (M17)", () => {
  test("the server's English detail sits in its own piece, marked en", () => {
    expect(reasonPieces(say, "merge_failed", "Bundle LRCQCZ is already in orrn.")).toEqual([
      { text: "Not merged. " }, { text: "Bundle LRCQCZ is already in orrn.", lang: "en" },
    ]);
    expect(reasonPieces(say, "dependency_held", "Customers 1")).toEqual([{ text: "Waits for Customers 1, which is held." }]);
    expect(reasonPieces(say, "person", "Waiting for the PO")).toEqual([{ text: "Waiting for the PO" }]);
    expect(reasonPieces(say, "odd_code", "Exact words")).toEqual([{ text: "Exact words.", lang: "en" }]);
    expect(reasonPieces(say, null, null)).toEqual([]);
  });
});

describe("how orrn read this file, and what changed (M10, M11)", () => {
  const plant = plantUnitsFor({});
  const block = {
    headers: ["Series", "Section code", "Weight (kg/12ft)", "Remarks", "Rate"],
    kinds: ["code", "code", "decimal", "text", "decimal"],
    sample: [["R", "RCQCZ", "1.1", "old", "215"], ["R", "RCQCZ2", "1.2", "", "220"]],
    headerKey: "k", headerRow: 0, headerRows: 1,
  };
  const base = { state: "ready", fit: "exact", target: "dies", recipe: null, block, fitDiff: null };

  test("an exact fit is one line; layouts made by orrn or a person, near fits and needs-layout are open", () => {
    expect(readPanel(base as never, plant, true, true).openByDefault).toBe(false);
    for (const fit of ["bot", "manual", "near", "none"]) expect(readPanel({ ...base, fit } as never, plant, true, true).openByDefault).toBe(true);
    expect(readPanel({ ...base, state: "needs_shape", fit: "none" } as never, plant, true, true).openByDefault).toBe(true);
  });

  test("Change mapping is offered unless the import is merged or merging", () => {
    expect(readPanel(base as never, plant, true, true).canChange).toBe(true);
    expect(readPanel(base as never, plant, true, false).canChange).toBe(false);
    expect(readPanel({ ...base, state: "merged" } as never, plant, true, true).canChange).toBe(false);
  });

  test("renamed, new and missing columns, each with sample values from the file", () => {
    const rows = nearChanges(
      { target: "dies", block, fitDiff: { renamed: [{ col: 2, from: "Wt", to: "Weight (kg/12ft)" }], extra: [{ col: 3, header: "Remarks" }, { col: 4, header: "Rate" }], missing: [{ field: "note", header: "Notes" }] } } as never,
      false,
    );
    expect(rows.map((r) => [r.kind, r.saved, r.now])).toEqual([
      ["renamed", "Wt", "Weight (kg/12ft)"], ["new", null, "Remarks"], ["new", null, "Rate"], ["missing", "Notes", null],
    ]);
    expect(rows[0]!.samples!.values).toEqual(["1.1", "1.2"]);
    expect(rows[1]!.chip).toEqual({ key: "ingest.near.kindNew" });
    // A rate column stays hidden for a person without order.price.
    expect(rows[2]!.samples).toMatchObject({ masked: true, values: [] });
    expect(rows[3]!.samples).toBeNull();
  });

  test("a near fit panel carries the changes; an exact fit does not", () => {
    expect(readPanel({ ...base, fit: "near", fitDiff: { renamed: [], extra: [{ col: 3, header: "Remarks" }], missing: [] } } as never, plant, true, true).changes).toHaveLength(1);
    expect(readPanel(base as never, plant, true, true).changes).toBeNull();
  });
});

describe("question words (S16)", () => {
  const word = (key: string, vars?: Record<string, string | number>) => {
    const table: Record<string, string> = {
      "ingest.q.unit_unknown": "{field} has no unit. Which unit is it?",
      "ingest.field.weightMinG": "Min weight per 12 ft",
      "ingest.q.magnitude_checkHint": "Some {field} values look wrong for {unit}. {count} rows are much {side} what is usual. They may be in {likelyUnit}. Are they right?",
      "ingest.q.magnitude_check": "Some {field} values look wrong for {unit}. {count} rows are much {side} what is usual. Are they right?",
      "ingest.field.weightG": "Weight", "ingest.unit.t": "tonne", "ingest.unit.kg": "kg", "ingest.q.sideAbove": "larger than",
    };
    return (table[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
  };
  test("the field in a question is a label, never a code or an id", () => {
    const [q] = questionList([{ code: "unit_unknown", subject: "weightMinG", params: { field: "weightMinG", kind: "linear_mass" }, answer: null, open: true }], "dies");
    expect(questionText(word, q!)).toBe("Min weight per 12 ft has no unit. Which unit is it?");
    expect(sayWords(word, { key: "ingest.q.unit_unknown", varKeys: { field: "ingest.field.weightMinG" } })).toBe("Min weight per 12 ft has no unit. Which unit is it?");
  });

  test("the value check names the field, the unit and the side in words, and offers the likely unit", () => {
    const [q] = questionList(
      [{ code: "magnitude_check", subject: "weightG", params: { field: "weightG", unit: "t", likelyUnit: "kg", side: "above", count: 12 }, answer: null, open: true }],
      "bundles",
    );
    expect(q!.key).toBe("ingest.q.magnitude_checkHint");
    expect(questionText(word, q!)).toBe("Some Weight values look wrong for tonne. 12 rows are much larger than what is usual. They may be in kg. Are they right?");
    expect(q!.answers.map((a) => [a.value, a.words.key])).toEqual([["as_is", "ingest.q.magnitudeAsIs"], ["kg", "ingest.q.magnitudeUnit"]]);
    expect(q!.canSkipRows).toBe(true);
    expect(q!.control).toMatchObject({ kind: "magnitude", field: "weightG", unit: "t", likelyUnit: "kg", side: "above", count: 12 });
    expect((q!.control as { units: { value: string }[] }).units.map((u) => u.value)).toContain("g");
  });
});
