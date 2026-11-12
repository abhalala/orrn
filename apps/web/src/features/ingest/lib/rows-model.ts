import type { Recipe } from "@orrn/ingest";

import {
  decisionOptions,
  rowNeedsDecision,
  rowStateKey,
  rowTone,
  rowWaitsOn,
  ROW_KEY,
  type DecisionOption,
  type Tone,
  type Words,
} from "./model";
import type { PlantUnits } from "./plant-units";
import { refusalLines, type RefusalLine } from "./refusals";
import { diffSide, rawCells, rowColumns, rowFieldLabelKey, valueCells, type RowColumn, type ValueCell } from "./row-values";
import type { CandidateCounts, CandidateDetail, RowState, StagedRowView } from "./types";

/** Rows per page in the rows panel (work order 3.3). The server pages by 100; the screen asks for 15 at a time. */
export const ROWS_UI_PAGE = 15;

/** The filters above the rows (work order 3.3, M12). `needsDecision` is a union of ambiguous and conflict rows with no decision. */
export type RowFilter = "needsDecision" | "all" | Exclude<RowState, "pending">;

export type RowFilterOption = {
  id: RowFilter;
  /** `ingest.rows.needsDecision` (it carries the count), `common.all`, or `ingest.row.<state>` with `count` apart. */
  key: string;
  /** Variables for `key`. Only `needsDecision` takes one (`count`). */
  vars: Record<string, number>;
  /** The filter's name without the count, for "Showing {filter}". */
  nameKey: string;
  count: number;
  tone: Tone | null;
};

/** "Needs a decision" first when above 0, then each row state that has rows, then "All". */
export function rowFilters(counts: CandidateCounts): RowFilterOption[] {
  const out: RowFilterOption[] = [];
  const undecided = counts.ambiguous + counts.conflict;
  if (undecided > 0) {
    out.push({ id: "needsDecision", key: "ingest.rows.needsDecision", vars: { count: undecided }, nameKey: "ingest.rows.needsDecisionName", count: undecided, tone: "warning" });
  }
  const by: [Exclude<RowState, "pending">, number][] = [
    ["ambiguous", counts.ambiguous],
    ["conflict", counts.conflict],
    ["refused", counts.refused],
    ["ready_create", counts.create],
    ["ready_update", counts.update],
    ["unchanged", counts.unchanged],
    ["skipped", counts.skipped],
  ];
  for (const [state, count] of by) {
    if (count > 0) out.push({ id: state, key: ROW_KEY(state), vars: {}, nameKey: ROW_KEY(state), count, tone: rowTone(state) });
  }
  out.push({ id: "all", key: "common.all", vars: {}, nameKey: "common.all", count: counts.total, tone: null });
  return out;
}

/**
 * The filter buttons the panel draws. A filter whose count equals All says nothing the All button does not, so it is
 * left out, and so is a Pick a match or Differs filter that holds exactly the rows Needs a decision already holds; with fewer than two groups left there is nothing to choose and the row of filters is not drawn at all.
 */
export function visibleRowFilters(options: readonly RowFilterOption[]): RowFilterOption[] {
  const all = options.find((o) => o.id === "all");
  const decide = options.find((o) => o.id === "needsDecision");
  const kept = options.filter(
    (o) =>
      o.id === "all" ||
      ((!all || o.count !== all.count) &&
        // "Pick a match 1" under "Needs a decision 1" is the same rows twice.
        !(decide && o.id !== "needsDecision" && (o.id === "ambiguous" || o.id === "conflict") && o.count === decide.count)),
  );
  return kept.length >= 2 ? kept : [];
}

/** "Needs a decision" is selected when above 0, else "All". */
export function defaultRowFilter(counts: CandidateCounts): RowFilter {
  return counts.ambiguous + counts.conflict > 0 ? "needsDecision" : "all";
}

/**
 * The filter in force. A filter whose rows are all gone (the last decision was made) falls back to what the person
 * would expect next: "All". The screen keeps its own chosen value, so the filter comes back if rows come back.
 */
export function effectiveFilter(chosen: RowFilter, counts: CandidateCounts): RowFilter {
  if (chosen === "all") return "all";
  const options = rowFilters(counts);
  return options.some((o) => o.id === chosen) ? chosen : "all";
}

/** The server state to ask for. `needsDecision` asks for both and the hook joins them. */
export function serverStatesFor(filter: RowFilter): (Exclude<RowState, "pending"> | undefined)[] {
  if (filter === "all") return [undefined];
  if (filter === "needsDecision") return ["ambiguous", "conflict"];
  return [filter];
}

/** One line for the screen's live region: "Showing Needs a decision, 3 rows, page 1." */
export function rowsShowingWords(filter: RowFilterOption, count: number, page: number): Words {
  return { key: "ingest.rows.showing", vars: { count, n: page + 1 }, varKeys: { filter: filter.nameKey } };
}

export type RowView = {
  id: string;
  /** The 1-based row number the person sees ("Row 3"). */
  n: number;
  state: RowState;
  /** The status chip: null for a row the dry run has not reached. */
  chip: { key: string; tone: Tone } | null;
  written: boolean;
  cells: ValueCell[];
  /** The file's own cells labelled by header, only for a row with nothing mapped (a refused or unread row). */
  raw: { label: string | null; n: number; value: string }[];
  /** Why the row is refused or waits, in the order the server wrote it. Question markers are left out. */
  reasons: RefusalLine[];
  /** Where a conflict differs: orrn's value against the file's, in the plant's unit. A `...Key` is an enum's words to translate. */
  diffs: { fieldKey: string; live: string; file: string; liveKey: string | null; fileKey: string | null }[];
  /** An ambiguous or conflict row nobody has decided. It gets the amber left border and the inline buttons. */
  needsDecision: boolean;
  /** The question this row waits on. The buttons are then only Skip, and the sentence points at the question. */
  waitsOn: { code: string; subject: string } | null;
  /** Inline buttons for a row that needs a decision. */
  decisions: DecisionOption[];
  /** The one choice a row that needs nothing still has (Skip, in a menu). Empty for refused and written rows. */
  menu: DecisionOption[];
  /** What the person chose, when they did, in the words of the button they pressed. */
  chosen: Words | null;
};

const CHOSEN_KEY: Record<string, string> = {
  skip: "ingest.decide.skip",
  keep_file: "ingest.decide.keepFile",
  keep_live: "ingest.decide.keepLive",
  create_new: "ingest.decide.createNew",
  use_match: "ingest.decide.useMatch",
};

function chosenWords(row: Pick<StagedRowView, "decision" | "matchId" | "options">): Words | null {
  if (!row.decision) return null;
  const key = CHOSEN_KEY[row.decision];
  if (!key) return null;
  if (row.decision !== "use_match") return { key };
  const picked = row.options.find((o) => o.id === row.matchId);
  return picked ? { key, vars: { name: picked.label } } : null;
}

/** One staged row as the table and the cards show it. */
export function rowView(candidate: Pick<CandidateDetail, "target" | "block">, row: StagedRowView, plant: PlantUnits): RowView {
  const cells = valueCells(candidate.target, row, plant);
  const needs = rowNeedsDecision(row);
  const options = decisionOptions({ state: row.state, options: row.options, mergeState: row.mergeState, reasons: row.reasons });
  const key = rowStateKey(row.state);
  const waits = rowWaitsOn(row.reasons);
  return {
    id: row.id,
    n: row.rowIndex + 1,
    state: row.state,
    // A row that waits on a file-level question is not "Pick a match": nothing in the row offers a match. It says what it waits on.
    chip: waits && row.state === "ambiguous" ? { key: "ingest.row.waiting", tone: rowTone(row.state) } : key ? { key, tone: rowTone(row.state) } : null,
    written: row.mergeState === "written",
    cells,
    raw: cells.length === 0 ? rawCells(row.raw, candidate.block.headers) : [],
    reasons: refusalLines(row.reasons, row.values),
    diffs: Object.entries(row.diff ?? {}).map(([field, d]) => {
      const live = diffSide(candidate.target, field, d.live, plant);
      const file = diffSide(candidate.target, field, d.file, plant);
      return { fieldKey: rowFieldLabelKey(field), live: live.text, file: file.text, liveKey: live.textKey, fileKey: file.textKey };
    }),
    needsDecision: needs,
    waitsOn: waits,
    decisions: needs ? options : [],
    menu: needs ? [] : options.filter((o) => o.decision === "skip"),
    chosen: chosenWords(row),
  };
}

/** The table's columns, and whether a decision column is needed at all (only when any row on the page needs one). */
export function rowsTable(
  candidate: Pick<CandidateDetail, "target" | "recipe" | "block">,
  rows: readonly RowView[],
  plant: PlantUnits,
): { columns: RowColumn[]; decisionColumn: boolean } {
  const all = rowColumns(candidate.target, candidate.recipe as Recipe | null, plant);
  // A field no row on this page has a value for (an empty Leg, Notes) takes no column: the table stays as narrow as it can.
  const columns = rows.length === 0 ? all : all.filter((col) => rows.some((r) => r.cells.some((c) => c.field === col.field)));
  return { columns, decisionColumn: rows.some((r) => r.needsDecision) };
}

/** At most `limit` fields of a row for the stacked card, with whether the rest are folded behind "Show all fields". */
export function cardFields(cells: readonly ValueCell[], expanded: boolean, limit = 5): { shown: ValueCell[]; hidden: number } {
  if (expanded || cells.length <= limit) return { shown: [...cells], hidden: 0 };
  return { shown: cells.slice(0, limit), hidden: cells.length - limit };
}

/** The accessible name of an inline decision button: its visible words, then the row ("Add as new, row 3"). */
export function decisionButtonName(say: (key: string, vars?: Record<string, string | number>) => string, option: DecisionOption, n: number): string {
  return say("ingest.decide.named", { label: say(option.key, option.vars), n });
}

/** The group name of the buttons on one row: "Decide: row 3". */
export function decisionGroupName(say: (key: string, vars?: Record<string, string | number>) => string, n: number): string {
  return say("ingest.decide.group", { n });
}
