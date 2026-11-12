import { describe, expect, test } from "bun:test";

import { plantUnitsFor } from "./plant-units";
import { groupRowNotes } from "./rows-model";
import {
  cardFields, decisionButtonName, decisionGroupName, defaultRowFilter, effectiveFilter, rowFilters, rowsShowingWords, rowsTable, rowView,
  serverStatesFor, visibleRowFilters, ROWS_UI_PAGE,
} from "./rows-model";
import { refusalTone } from "./refusals";
import type { CandidateCounts, CandidateDetail, StagedRowView } from "./types";

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 100, create: 0, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});
const plant = plantUnitsFor({ lengthUnit: "mm" });
const candidate = { target: "bundles", block: { headers: ["Id", "Wt"] }, recipe: null } as unknown as Pick<CandidateDetail, "target" | "block" | "recipe">;
const staged = (over: Partial<StagedRowView>): StagedRowView => ({
  id: "r1", rowIndex: 2, state: "ready_create", values: { legacyId: "L1", weightG: 58400 }, entered: null, raw: ["L1", "58.4"], reasons: [], matchId: null,
  options: [], diff: null, decision: null, mergeState: "open", committedType: null, committedId: null, rate: null, rateHidden: false, ...over,
});

describe("filters (M12)", () => {
  test("Needs a decision is first and the default when above 0, then the row states, then All", () => {
    const options = rowFilters(counts({ ambiguous: 2, conflict: 1, create: 90, refused: 7 }));
    expect(options.map((o) => o.id)).toEqual(["needsDecision", "ambiguous", "conflict", "refused", "ready_create", "all"]);
    expect(options[0]).toMatchObject({ key: "ingest.rows.needsDecision", vars: { count: 3 }, count: 3, nameKey: "ingest.rows.needsDecisionName" });
    expect(options.at(-1)).toMatchObject({ key: "common.all", count: 100 });
    expect(defaultRowFilter(counts({ ambiguous: 1 }))).toBe("needsDecision");
    expect(defaultRowFilter(counts({ create: 5 }))).toBe("all");
  });

  test("no needs-decision option with nothing to decide, and a chosen filter that emptied falls back to All", () => {
    expect(rowFilters(counts({ create: 5 })).map((o) => o.id)).toEqual(["ready_create", "all"]);
    expect(effectiveFilter("needsDecision", counts({ create: 5 }))).toBe("all");
    expect(effectiveFilter("needsDecision", counts({ ambiguous: 1 }))).toBe("needsDecision");
    expect(effectiveFilter("refused", counts({ refused: 2 }))).toBe("refused");
    expect(effectiveFilter("refused", counts({ create: 2 }))).toBe("all");
  });

  test("a filter whose count equals All is left out, and with fewer than two groups there is no filter row", () => {
    // Three rows, all waiting: Needs a decision 3, Pick a match 3 and All 3 say the same thing.
    expect(visibleRowFilters(rowFilters(counts({ total: 3, ambiguous: 3 })))).toEqual([]);
    expect(visibleRowFilters(rowFilters(counts({ total: 100, create: 100 })))).toEqual([]);
    // Different groups stay, in order, with All last.
    expect(visibleRowFilters(rowFilters(counts({ total: 100, ambiguous: 2, conflict: 1, create: 90, refused: 7 }))).map((o) => o.id)).toEqual(["needsDecision", "ambiguous", "conflict", "refused", "ready_create", "all"]);
    expect(visibleRowFilters(rowFilters(counts({ total: 10, create: 6, refused: 4 }))).map((o) => o.id)).toEqual(["refused", "ready_create", "all"]);
    // "Pick a match 1" under "Needs a decision 1" is the same rows twice.
    expect(visibleRowFilters(rowFilters(counts({ total: 3, ambiguous: 1, create: 2 }))).map((o) => o.id)).toEqual(["needsDecision", "ready_create", "all"]);
  });

  test("needs a decision asks for two server states; the others for one", () => {
    expect(serverStatesFor("needsDecision")).toEqual(["ambiguous", "conflict"]);
    expect(serverStatesFor("all")).toEqual([undefined]);
    expect(serverStatesFor("refused")).toEqual(["refused"]);
    expect(ROWS_UI_PAGE).toBe(15);
  });

  test("the live line says which filter, how many rows and which page, in words", () => {
    const filter = rowFilters(counts({ ambiguous: 3 }))[0]!;
    expect(rowsShowingWords(filter, 3, 0)).toEqual({ key: "ingest.rows.showing", vars: { count: 3, n: 1 }, varKeys: { filter: "ingest.rows.needsDecisionName" } });
  });
});

describe("one row", () => {
  test("a ready row needs nothing: no inline buttons, Skip in the menu, plant units in the cells", () => {
    const view = rowView(candidate, staged({}), plant);
    expect(view).toMatchObject({ id: "r1", n: 3, needsDecision: false, decisions: [], chip: { key: "ingest.row.ready_create", tone: "success" } });
    expect(view.menu.map((o) => o.decision)).toEqual(["skip"]);
    expect(view.cells.find((c) => c.field === "weightG")).toMatchObject({ text: "58.4", unit: "kg" });
    expect(view.raw).toEqual([]);
  });

  test("an ambiguous row gets its matches, Add as new and Skip as inline buttons, and no menu", () => {
    const view = rowView(candidate, staged({ state: "ambiguous", options: [{ id: "x", label: "RCQCZ1" }], reasons: ["ambiguous:sectionCode"] }), plant);
    expect(view.needsDecision).toBe(true);
    expect(view.decisions.map((o) => o.decision)).toEqual(["use_match", "create_new", "skip"]);
    expect(view.decisions[0]).toMatchObject({ vars: { name: "RCQCZ1" }, matchId: "x" });
    expect(view.menu).toEqual([]);
    expect(view.reasons).toEqual([{ kind: "refusal", key: "ingest.refuse.ambiguous", fieldKey: "ingest.field.sectionCode" }]);
  });

  test("a conflict row offers the orrn value, the file value, or Skip", () => {
    const view = rowView(candidate, staged({ state: "conflict", diff: { weightG: { live: 100, file: 200 } } }), plant);
    expect(view.decisions.map((o) => o.key)).toEqual(["ingest.decide.keepFile", "ingest.decide.keepLive", "ingest.decide.skip"]);
    // Orrn's value and the file's are shown in the plant's unit, never as the stored grams.
    expect(view.diffs).toEqual([{ fieldKey: "ingest.field.weightG", live: "0.1 kg", file: "0.2 kg", liveKey: null, fileKey: null }]);
  });

  test("a row waiting on a column question points at it and can only be skipped", () => {
    const view = rowView(candidate, staged({ state: "ambiguous", reasons: ["magnitude:weightG", "q:magnitude_check:weightG"] }), plant);
    expect(view.waitsOn).toEqual({ code: "magnitude_check", subject: "weightG" });
    expect(view.decisions.map((o) => o.decision)).toEqual(["skip"]);
    expect(view.reasons).toEqual([{ kind: "refusal", key: "ingest.refuse.magnitude", fieldKey: "ingest.field.weightG" }]);
    // Nothing in the row offers a match, so the chip says what it waits on. The value check is asked, never refused: amber.
    expect(view.chip).toEqual({ key: "ingest.row.waiting", tone: "warning" });
    expect(refusalTone(view.reasons[0]!)).toBe("amber");
  });

  test("a row that really has matches keeps Pick a match; a real refusal stays red", () => {
    const pick = rowView(candidate, staged({ state: "ambiguous", options: [{ id: "x", label: "RCQCZ1" }], reasons: ["ambiguous:sectionCode"] }), plant);
    expect(pick.chip).toEqual({ key: "ingest.row.ambiguous", tone: "warning" });
    expect(refusalTone({ kind: "refusal", key: "ingest.refuse.bad_number", fieldKey: null })).toBe("red");
    expect(refusalTone({ kind: "blocked", blockers: ["po_number"] })).toBe("amber");
  });

  test("columns and card labels say 'Min weight', the unit comes after it in the header", () => {
    const dies = { target: "dies", block: { headers: [] }, recipe: null } as unknown as Pick<CandidateDetail, "target" | "block" | "recipe">;
    const table = rowsTable(dies, [], plantUnitsFor({ lengthUnit: "mm" }));
    const min = table.columns.find((c) => c.field === "weightMinG")!;
    expect(min).toMatchObject({ labelKey: "ingest.fieldHeader.weightMinG", unit: "kg/12ft" });
  });

  test("a decided row says what was chosen, with the matched name", () => {
    const view = rowView(candidate, staged({ state: "ready_update", decision: "use_match", matchId: "x", options: [{ id: "x", label: "RCQCZ1" }] }), plant);
    expect(view.needsDecision).toBe(false);
    expect(view.chosen).toEqual({ key: "ingest.decide.useMatch", vars: { name: "RCQCZ1" } });
  });

  test("a refused row with nothing mapped shows its cells by the file's headers", () => {
    const view = rowView(candidate, staged({ state: "refused", values: null, raw: ["L9", ""], reasons: ["bad_number:weightG"] }), plant);
    expect(view.cells).toEqual([]);
    expect(view.raw).toEqual([{ label: "Id", n: 1, value: "L9" }, { label: "Wt", n: 2, value: "" }]);
    expect(view.menu).toEqual([]);
  });

  test("a written row has no controls", () => {
    const view = rowView(candidate, staged({ mergeState: "written" }), plant);
    expect(view).toMatchObject({ written: true, menu: [], decisions: [] });
  });

  test("a field no row has a value for takes no column, and a conflict shows kg/12ft, not grams", () => {
    const dies = { target: "dies", block: { headers: [] }, recipe: null } as unknown as Pick<CandidateDetail, "target" | "block" | "recipe">;
    const row = rowView(dies, staged({ values: { series: "ZB", sectionCode: "X1", weightMinG: 1100, status: "active" }, diff: null }), plant);
    const table = rowsTable(dies, [row], plant);
    expect(table.columns.map((c) => c.field)).toEqual(["series", "sectionCode", "weightMinG", "status"]);
    const conflict = rowView(dies, staged({ state: "conflict", diff: { weightMinG: { live: 1100, file: 1900 }, status: { live: "active", file: "retired" } } }), plant);
    expect(conflict.diffs).toEqual([
      { fieldKey: "ingest.fieldHeader.weightMinG", live: "1.1 kg/12ft", file: "1.9 kg/12ft", liveKey: null, fileKey: null },
      { fieldKey: "ingest.field.status", live: "", file: "", liveKey: "ingest.enumValue.active", fileKey: "ingest.enumValue.retired" },
    ]);
  });

  test("a decision column is needed only when a row on the page needs one", () => {
    const rows = [rowView(candidate, staged({}), plant)];
    expect(rowsTable(candidate, rows, plant).decisionColumn).toBe(false);
    rows.push(rowView(candidate, staged({ id: "r2", state: "ambiguous" }), plant));
    expect(rowsTable(candidate, rows, plant).decisionColumn).toBe(true);
    expect(rowsTable(candidate, rows, plant).columns.some((c) => c.field === "weightG" && c.unit === "kg")).toBe(true);
  });
});

describe("cards and names", () => {
  test("a card shows five fields and folds the rest behind Show all fields", () => {
    const cells = Array.from({ length: 8 }, (_, i) => ({ field: `f${i}` })) as never;
    expect(cardFields(cells, false)).toMatchObject({ hidden: 3 });
    expect(cardFields(cells, false).shown).toHaveLength(5);
    expect(cardFields(cells, true)).toMatchObject({ hidden: 0 });
    expect(cardFields(cells.slice(0, 4) as never, false).hidden).toBe(0);
  });

  test("inline buttons end with their row; the group is named by the row", () => {
    const say = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join("|")}` : key);
    expect(decisionButtonName(say, { decision: "create_new", key: "ingest.decide.createNew" }, 3)).toBe("ingest.decide.named:ingest.decide.createNew|3");
    expect(decisionGroupName(say, 3)).toBe("ingest.decide.group:3");
  });
});

describe("what a group of waiting rows repeats is said once (server round 9)", () => {
  const waiting = (n: number, extra: Partial<RowView> = {}): RowView =>
    ({
      id: `r${n}`, n, state: "ambiguous", chip: { key: "ingest.row.waitsOrder", tone: "warning" }, written: false, cells: [], raw: [],
      reasons: [{ kind: "refusal", key: "ingest.refuse.order_waits", fieldKey: null, count: 1 }], diffs: [], needsDecision: true,
      waitsOn: { code: "order_fill_above", subject: "" }, decisions: [], menu: [], chosen: null, ...extra,
    }) as unknown as RowView;

  test("two rows with the same sentence: it moves above the table and each row keeps its chip and its action", () => {
    const g = groupRowNotes([waiting(1), waiting(2)]);
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0]).toMatchObject({ key: "ingest.refuse.order_waits", count: 1 });
    expect(g.waitsOnQuestion).toBe(true);
    expect(g.views.every((v) => v.reasons.length === 0 && v.waitsOn === null && v.chip !== null)).toBe(true);
  });

  test("one row on its own keeps its sentences where they are; a different count is its own sentence", () => {
    const one = groupRowNotes([waiting(1)]);
    expect(one.lines).toEqual([]);
    expect(one.views[0]!.reasons).toHaveLength(1);
    expect(one.waitsOnQuestion).toBe(false);
    const mixed = groupRowNotes([waiting(1), waiting(2), waiting(3, { reasons: [{ kind: "refusal", key: "ingest.refuse.order_waits", fieldKey: null, count: 2 }] as never })]);
    expect(mixed.lines).toHaveLength(1);
    expect(mixed.views[2]!.reasons).toHaveLength(1);
  });

  test("a refusal that is not about waiting stays on its row", () => {
    const refused = waiting(4, { reasons: [{ kind: "refusal", key: "ingest.refuse.order_no_date", fieldKey: null }] as never, waitsOn: null });
    expect(groupRowNotes([refused, waiting(5)]).views[0]!.reasons).toHaveLength(1);
  });
});
