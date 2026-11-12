import { TARGETS, UNIT_KINDS, unitsFor, type UnitKind } from "@orrn/ingest";

import { fieldLabelKey } from "./recipe-builder";
import { CANDIDATE_STATES, ROW_STATES } from "./types";
import type {
  CandidateCounts,
  CandidateState,
  CandidateSummary,
  FitDiff,
  IngestQuestion,
  IngestTarget,
  MergeRunState,
  QuestionCode,
  RowDecision,
  RowState,
  StagedRowView,
} from "./types";

/** Look of a chip. The screen maps a tone to its own colours; never raw colour here. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const STATE_KEY = (state: CandidateState) => `ingest.state.${state}` as const;
export const ROW_KEY = (state: Exclude<RowState, "pending">) => `ingest.row.${state}` as const;
export const TARGET_KEY = (target: IngestTarget) => `ingest.target.${target}` as const;
export const FIT_KEY = (fit: "exact" | "near" | "none") => `ingest.fit.${fit}` as const;

export function candidateStateKey(state: CandidateState): string {
  return STATE_KEY(state);
}

const STATE_TONE: Record<CandidateState, Tone> = {
  processing: "info",
  needs_shape: "warning",
  needs_confirm: "warning",
  ready: "success",
  // DESIGN.md rule 1: held is blue. A held import is paused, not in trouble.
  held: "info",
  approved: "success",
  merging: "info",
  merged: "success",
  failed: "danger",
  discarded: "neutral",
};

export function candidateTone(state: CandidateState): Tone {
  return STATE_TONE[state];
}

/** The fit words. A layout orrn made and a layout a person made have their own words (work order M10). */
export function fitKeyOf(
  fit: CandidateSummary["fit"],
): "ingest.fit.exact" | "ingest.fit.near" | "ingest.fit.none" | "ingest.fit.bot" | "ingest.fit.manual" {
  if (fit === "exact") return "ingest.fit.exact";
  if (fit === "near") return "ingest.fit.near";
  if (fit === "bot") return "ingest.fit.bot";
  if (fit === "manual") return "ingest.fit.manual";
  return "ingest.fit.none";
}

/**
 * The four segments of the list (work order 3.2). A held import needs a person, so it sits under `needsYou`. A ready
 * import with open questions cannot be approved, so it sits there too. An import still being checked is in no
 * segment: it shows in the upload strip. A discarded import is in none.
 */
export type CandidateGroup = "needsYou" | "ready" | "approved" | "merged" | "other";

export const GROUP_ORDER: readonly Exclude<CandidateGroup, "other">[] = ["needsYou", "ready", "approved", "merged"];

/** Which list group a candidate sits in (`ingest.group.<group>`). It reads the open question count, not only the state. */
export function groupOf(c: Pick<CandidateSummary, "state" | "openQuestions">): CandidateGroup {
  switch (c.state) {
    case "needs_shape":
    case "needs_confirm":
    case "failed":
    case "held":
      return "needsYou";
    case "ready":
      return c.openQuestions > 0 ? "needsYou" : "ready";
    case "approved":
    case "merging":
      return "approved";
    case "merged":
      return "merged";
    case "processing":
    case "discarded":
      return "other";
  }
}

export function groupKey(group: Exclude<CandidateGroup, "other">): string {
  return `ingest.group.${group}`;
}

/** Candidates grouped in screen order; empty groups, imports still being checked and discarded ones are left out. */
export function groupCandidates<T extends Pick<CandidateSummary, "state" | "openQuestions">>(
  candidates: readonly T[],
): { group: Exclude<CandidateGroup, "other">; key: string; items: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    key: groupKey(group),
    items: candidates.filter((c) => groupOf(c) === group),
  })).filter((g) => g.items.length > 0);
}

/** A state that moves by itself, so the screen polls only now. */
export function isRunningCandidate(state: CandidateState): boolean {
  return state === "processing" || state === "merging";
}

export function isRunningRun(state: MergeRunState): boolean {
  return state === "planning" || state === "running";
}

export function isFinishedRun(state: MergeRunState): boolean {
  return !isRunningRun(state);
}

export const POLL_MS = 3000;

/** `refetchInterval` for a candidate query: 3 s while its state runs, else off. */
export function candidatePollMs(state: CandidateState | undefined): number | false {
  return state && isRunningCandidate(state) ? POLL_MS : false;
}

export function runPollMs(state: MergeRunState | undefined): number | false {
  return state && isRunningRun(state) ? POLL_MS : false;
}

const ROW_TONE: Record<RowState, Tone> = {
  pending: "neutral",
  ready_create: "success",
  ready_update: "info",
  unchanged: "neutral",
  ambiguous: "warning",
  conflict: "warning",
  refused: "danger",
  skipped: "neutral",
};

export function rowTone(state: RowState): Tone {
  return ROW_TONE[state];
}

/** The row chip key. A `pending` row has no chip yet (the dry run has not reached it). */
export function rowStateKey(state: RowState): string | null {
  return state === "pending" ? null : ROW_KEY(state);
}

/** A row that still needs a person: ambiguous or conflict with no decision. */
export function rowNeedsDecision(row: Pick<StagedRowView, "state" | "decision">): boolean {
  return (row.state === "ambiguous" || row.state === "conflict") && row.decision === null;
}

export const ROW_FILTERS = ROW_STATES.filter((s) => s !== "pending") as Exclude<RowState, "pending">[];

export type StateCount = { state: Exclude<RowState, "pending">; key: string; tone: Tone; count: number };

/** The filter chips of a candidate: one per row state with at least one row, in fixed order. */
export function rowStateCounts(counts: CandidateCounts): StateCount[] {
  const by: Record<Exclude<RowState, "pending">, number> = {
    ready_create: counts.create,
    ready_update: counts.update,
    unchanged: counts.unchanged,
    ambiguous: counts.ambiguous,
    conflict: counts.conflict,
    refused: counts.refused,
    skipped: counts.skipped,
  };
  const order: Exclude<RowState, "pending">[] = [
    "ambiguous", "conflict", "refused", "ready_create", "ready_update", "unchanged", "skipped",
  ];
  return order
    .map((state) => ({ state, key: ROW_KEY(state), tone: ROW_TONE[state], count: by[state] }))
    .filter((c) => c.count > 0);
}

/** Rows a merge would write: new rows plus rows that fill blanks. */
export function writableRows(counts: CandidateCounts): number {
  return counts.create + counts.update;
}

/** Rows the dry run has classified so far. */
export function classifiedRows(counts: CandidateCounts): number {
  return counts.create + counts.update + counts.unchanged + counts.ambiguous + counts.conflict + counts.refused + counts.skipped;
}

/** 0 to 1, or null when the total is not known yet (no rows counted). */
export function dryRunProgress(counts: CandidateCounts): number | null {
  if (counts.total <= 0) return null;
  return Math.min(1, classifiedRows(counts) / counts.total);
}

/** Sums of the approved candidates, for the sticky merge bar and the status block. */
export function approvedSummary(candidates: readonly Pick<CandidateSummary, "state" | "counts">[]): {
  count: number;
  /** Rows a merge would write: new plus updates. */
  rows: number;
  create: number;
  update: number;
} {
  const approved = candidates.filter((c) => c.state === "approved");
  const create = approved.reduce((sum, c) => sum + c.counts.create, 0);
  const update = approved.reduce((sum, c) => sum + c.counts.update, 0);
  return { count: approved.length, rows: create + update, create, update };
}

export type ActionName = "approve" | "hold" | "discard" | "release";

/**
 * What buttons a candidate offers. Approve and merge are for people holding `ingest.merge`; hold, check again and
 * discard follow the server's own guards (`candidate.hold` and `candidate.release` take either permission,
 * `candidate.discard` needs `ingest.upload`). A held import may be approved again as it is when nothing is open.
 */
export function allowedActions(
  c: Pick<CandidateSummary, "state" | "openQuestions"> & { counts: Pick<CandidateCounts, "written"> },
  can: { merge: boolean; upload: boolean },
): Record<ActionName, boolean> {
  const open = c.openQuestions;
  const noWrite = c.counts.written === 0;
  return {
    approve: can.merge && (c.state === "ready" || c.state === "held") && open === 0,
    hold: (can.merge || can.upload) && (c.state === "ready" || c.state === "approved"),
    release: (can.merge || can.upload) && c.state === "held",
    discard: can.upload && noWrite && c.state !== "merging" && c.state !== "merged" && c.state !== "discarded",
  };
}

export const KNOWN_STATES: readonly CandidateState[] = CANDIDATE_STATES;

// ---------------------------------------------------------------------------------------------
// Questions (plan B7, work order 3.3 and M12). One model for the question row; the screen draws the control.
// ---------------------------------------------------------------------------------------------

/** Words as a key and its variables. `varKeys` names variables that are themselves dictionary keys to translate first. */
export type Words = {
  key: string;
  vars?: Record<string, string | number>;
  varKeys?: Record<string, string>;
  /** Variables that are lists of dictionary keys: each is translated, then joined with ", ". */
  varLists?: Record<string, string[]>;
  /** Literal text with no dictionary entry (a date order such as dd/mm/yyyy). Used when `key` is empty. */
  text?: string;
  /** Names from `varKeys` that sit mid-sentence: their words are lower-cased ("See bundles in stock"). */
  lowerKeys?: string[];
};

/** One answer button. Every answer button is secondary: the decision bar holds the one loud element. */
export type QuestionAnswer = { value: string | boolean; words: Words };

export type UnitChoice = { value: string; labelKey: string };

export type QuestionControl =
  | { kind: "unit"; field: string; unitKind: string | null; units: UnitChoice[] }
  | { kind: "choice"; options: { value: string; labelKey?: string; label?: string }[] }
  | { kind: "period" }
  | { kind: "yesNo" }
  | { kind: "column" }
  | {
      kind: "magnitude";
      field: string;
      /** The unit the layout read the column in (a recipe unit id), "" when every flagged row is settled. */
      unit: string;
      /** A unit to offer first, or null when the flagged rows do not agree on one. */
      likelyUnit: string | null;
      side: "above" | "below" | null;
      /** Flagged rows still waiting. */
      count: number;
      /** Every unit of the column's kind, for "they are in another unit". */
      units: UnitChoice[];
    };

export type QuestionView = {
  code: QuestionCode;
  subject: string;
  /** Dictionary key of the sentence, `ingest.q.<code>` (`magnitude_checkHint` when a likely unit is offered). */
  key: string;
  vars: Record<string, string | number>;
  /** Variables that are dictionary keys: `field` is `ingest.field.<name>`, `unit` is `ingest.unit.<id>`, `side` its words. */
  varKeys: Record<string, string>;
  control: QuestionControl;
  /** The buttons, for the kinds drawn as buttons (`choice`, `yesNo`, `magnitude`). Empty for a select. */
  answers: QuestionAnswer[];
  answered: boolean;
  answer: unknown | null;
  /** "Answered: {answer}" for an answered question, else null. */
  answeredWords: Words | null;
  rows: number;
  /** The 1-based row the question is about, when the server says one. A link to that row. */
  aboutRow: number | null;
  /** True when "Skip the rows" is a way to answer: the question is about rows that can be left out. */
  canSkipRows: boolean;
};

/** The variables each sentence needs, taken from the question's context. Missing ones become empty text. */
const QUESTION_VARS: Record<QuestionCode, string[]> = {
  unit_unknown: ["field"],
  date_format_ambiguous: ["sample"],
  period_needed: [],
  rates_hidden: [],
  column_meaning_unclear: ["name"],
  create_legacy_die: ["code"],
  new_customers: ["count"],
  magnitude_check: ["field", "unit", "likelyUnit", "side", "count"],
  order_po: ["order", "customer", "pos", "count"],
  bundles_no_old_id: ["count"],
};

/** Recipe unit id to its dictionary key: `kg/12ft` is `ingest.unit.kg_12ft`. */
export function unitLabelKey(unit: string): string {
  return `ingest.unit.${unit.replace(/\//g, "_")}`;
}

const DATE_ORDER_TEXT: Record<string, string> = { dmy: "dd/mm/yyyy", mdy: "mm/dd/yyyy", ymd: "yyyy/mm/dd" };

function unitChoices(kind: string | null): UnitChoice[] {
  if (!kind || !(UNIT_KINDS as readonly string[]).includes(kind)) return [];
  return unitsFor(kind as UnitKind).map((value) => ({ value, labelKey: unitLabelKey(value) }));
}

function fieldKindOf(target: IngestTarget | null | undefined, field: string): string | null {
  if (!target) return null;
  const def = TARGETS[target].fields.find((f) => f.name === field);
  return def && (UNIT_KINDS as readonly string[]).includes(def.kind) ? def.kind : null;
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** The POs of an `order_po` question: the server joins them with ", ". */
function poChoices(raw: unknown): string[] {
  return str(raw).split(", ").map((p) => p.trim()).filter((p) => p !== "");
}

export function questionView(q: IngestQuestion, target?: IngestTarget | null): QuestionView {
  const vars: Record<string, string | number> = {};
  const varKeys: Record<string, string> = {};
  for (const name of QUESTION_VARS[q.code]) vars[name] = q.params[name] ?? "";
  const field = str(q.params.field ?? q.subject);
  const answered = !q.open;
  const answer = q.answer ?? null;
  let key = `ingest.q.${q.code}`;
  let control: QuestionControl;
  let answers: QuestionAnswer[] = [];
  let answeredWords: Words | null = null;
  let canSkipRows = false;

  switch (q.code) {
    case "unit_unknown": {
      const kind = q.params.kind === undefined ? fieldKindOf(target, field) : str(q.params.kind);
      control = { kind: "unit", field, unitKind: kind, units: unitChoices(kind) };
      vars.field = "";
      varKeys.field = fieldLabelKey(field);
      if (answered && typeof answer === "string") answeredWords = { key: unitLabelKey(answer) };
      break;
    }
    case "date_format_ambiguous": {
      const options = [
        { value: "dmy", label: DATE_ORDER_TEXT.dmy! },
        { value: "mdy", label: DATE_ORDER_TEXT.mdy! },
      ];
      control = { kind: "choice", options };
      answers = options.map((o) => ({ value: o.value, words: { key: "", text: o.label } }));
      if (answered && typeof answer === "string") answeredWords = { key: "", text: DATE_ORDER_TEXT[answer] ?? answer };
      break;
    }
    case "period_needed":
      control = { kind: "period" };
      break;
    case "rates_hidden": {
      // Two answers that read as what they do: the rates are left out of the merge, or the owner merges the file.
      const options = [
        { value: "leave_out", labelKey: "ingest.q.leaveRatesOut" },
        { value: "owner_merges", labelKey: "ingest.q.ownerMerges" },
      ];
      control = { kind: "choice", options };
      answers = options.map((o) => ({ value: o.value, words: { key: o.labelKey } }));
      const hit = options.find((o) => o.value === answer);
      if (answered && hit) answeredWords = { key: hit.labelKey };
      break;
    }
    case "column_meaning_unclear":
      control = { kind: "column" };
      if (answered && typeof answer === "string") answeredWords = { key: fieldLabelKey(answer) };
      break;
    case "create_legacy_die":
      // Lead answer 3: "Add it" adds an old section, "Skip these rows" refuses the rows that use it.
      control = { kind: "yesNo" };
      answers = [
        { value: true, words: { key: "ingest.q.addIt" } },
        { value: false, words: { key: "ingest.q.skipRows" } },
      ];
      if (answered) answeredWords = { key: answer === true ? "ingest.q.addIt" : "ingest.q.skipRows" };
      break;
    case "new_customers":
      control = { kind: "yesNo" };
      answers = [
        { value: true, words: { key: "common.yes" } },
        { value: false, words: { key: "common.no" } },
      ];
      if (answered) answeredWords = { key: answer === true ? "common.yes" : "common.no" };
      break;
    case "magnitude_check": {
      const kind = fieldKindOf(target, field);
      const unit = str(q.params.unit);
      const likely = str(q.params.likelyUnit);
      const side = q.params.side === "above" || q.params.side === "below" ? q.params.side : null;
      const count = typeof q.params.count === "number" ? q.params.count : Number(q.params.count) || 0;
      const units = unitChoices(kind);
      control = { kind: "magnitude", field, unit, likelyUnit: likely === "" ? null : likely, side, count, units };
      // `vars` keeps a placeholder for each translated variable so the sentence always has every name it needs.
      vars.field = "";
      vars.unit = "";
      vars.likelyUnit = "";
      vars.side = "";
      vars.count = count;
      varKeys.field = fieldLabelKey(field);
      if (unit !== "") varKeys.unit = unitLabelKey(unit);
      if (likely !== "") {
        varKeys.likelyUnit = unitLabelKey(likely);
        key = "ingest.q.magnitude_checkHint";
      }
      varKeys.side = side === "above" ? "ingest.q.sideAbove" : side === "below" ? "ingest.q.sideBelow" : "ingest.q.sideEither";
      answers = [{ value: "as_is", words: { key: "ingest.q.magnitudeAsIs" } }];
      if (likely !== "") answers.push({ value: likely, words: { key: "ingest.q.magnitudeUnit", varKeys: { unit: unitLabelKey(likely) } } });
      canSkipRows = true;
      if (answered && typeof answer === "string") {
        answeredWords = answer === "as_is"
          ? { key: "ingest.q.magnitudeAsIs" }
          : { key: "ingest.q.magnitudeUnit", varKeys: { unit: unitLabelKey(answer) } };
      }
      break;
    }
    case "bundles_no_old_id":
      // Rule 7.5: bundles with no old bundle number. orrn cannot tell if the same bundles arrive in another file.
      control = { kind: "yesNo" };
      answers = [
        { value: true, words: { key: "ingest.q.importThem" } },
        { value: false, words: { key: "ingest.q.doNotImport" } },
      ];
      if (answered) answeredWords = { key: answer === true ? "ingest.q.importThem" : "ingest.q.doNotImport" };
      break;
    case "order_po": {
      // One old order whose rows carry two or more POs: the person picks the PO the whole order takes, or leaves it out.
      const pos = poChoices(q.params.pos);
      const options = pos.map((po) => ({ value: po, label: po }));
      control = { kind: "choice", options };
      answers = [
        ...pos.map((po) => ({ value: po, words: { key: "", text: po } })),
        { value: "skip", words: { key: "ingest.q.skipOrder" } },
      ];
      if (answered) {
        if (answer === "skip") answeredWords = { key: "ingest.q.skipOrder" };
        else if (answer && typeof answer === "object" && typeof (answer as { po?: unknown }).po === "string") {
          answeredWords = { key: "", text: (answer as { po: string }).po };
        }
      }
      canSkipRows = false;
      break;
    }
  }
  return {
    code: q.code,
    subject: q.subject,
    key,
    vars,
    varKeys,
    control,
    answers,
    answered,
    answer,
    answeredWords,
    rows: typeof q.params.rows === "number" ? q.params.rows : 0,
    aboutRow: typeof q.params.row === "number" ? q.params.row + 1 : null,
    canSkipRows,
  };
}

/**
 * Everything the person must still answer, counted from the questions themselves: the year, a section, a unit, a value
 * check. The review bar says this number, so it never says "1 question" while two things are open. A rate question a
 * person who cannot see rates is not asked is not counted (the server's rule). The server's own `openQuestions` is the
 * floor, for a candidate whose questions are not loaded.
 */
export function openQuestionTotal(c: { questions?: readonly IngestQuestion[]; openQuestions: number }): number {
  const counted = (c.questions ?? []).filter((q) => q.open && (q.code !== "rates_hidden" || q.params.reason === "pricing_off")).length;
  return Math.max(c.openQuestions, counted);
}

/** Unanswered questions first, then answered ones, each in the server's order. */
export function questionList(questions: readonly IngestQuestion[], target?: IngestTarget | null): QuestionView[] {
  const views = questions.map((q) => questionView(q, target));
  return [...views.filter((v) => !v.answered), ...views.filter((v) => v.answered)];
}

/** `ingest.q.*` words for a question, with its dictionary-key variables translated first. `say` is the screen's `t`. */
export function questionText(say: Say, q: Pick<QuestionView, "key" | "vars" | "varKeys">): string {
  const vars: Record<string, string | number> = { ...q.vars };
  for (const [name, key] of Object.entries(q.varKeys)) vars[name] = say(key);
  return say(q.key, vars);
}

/** The words of anything that is a key and its variables. */
export function sayWords(say: Say, w: Words): string {
  if (w.key === "") return w.text ?? "";
  const vars: Record<string, string | number> = { ...(w.vars ?? {}) };
  for (const [name, key] of Object.entries(w.varKeys ?? {})) vars[name] = w.lowerKeys?.includes(name) ? say(key).toLocaleLowerCase() : say(key);
  for (const [name, keys] of Object.entries(w.varLists ?? {})) vars[name] = keys.map((k) => say(k)).join(", ");
  return say(w.key, vars);
}

/** The screen's translate function in the shape the helpers take. `translateKey(t, ...)` fits. */
export type Say = (key: string, vars?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------------------------
// Row decisions
// ---------------------------------------------------------------------------------------------

export type DecisionOption = {
  decision: RowDecision;
  /** Dictionary key, `ingest.decide.*`. */
  key: string;
  vars?: Record<string, string>;
  matchId?: string;
};

/** The question a row waits on (`q:<code>` markers the dry run writes), or null. The question says it, not the row. */
export function rowWaitsOn(reasons: readonly string[] | undefined): { code: QuestionCode; subject: string } | null {
  for (const r of reasons ?? []) {
    if (!r.startsWith("q:")) continue;
    const [, code = "", ...rest] = r.split(":");
    const subject = rest.join(":");
    if (code === "magnitude_check") return { code: "magnitude_check", subject };
    if (code === "customer_new") return { code: "new_customers", subject: "" };
    if (code === "section_unknown") return { code: "create_legacy_die", subject };
  }
  return null;
}

/**
 * The choices of one row. A refused or finished row has none. The server refuses some choices, so they are not
 * offered: a row that waits on a question can only be skipped (the question answers the rest), and a line that is
 * not on the live order can only keep the orrn order or be skipped.
 */
export function decisionOptions(
  row: Pick<StagedRowView, "state" | "options" | "mergeState"> & { reasons?: readonly string[] },
): DecisionOption[] {
  if (row.mergeState === "written") return [];
  const skip: DecisionOption = { decision: "skip", key: "ingest.decide.skip" };
  const reasons = row.reasons ?? [];
  const waits = rowWaitsOn(reasons) !== null;
  switch (row.state) {
    case "ambiguous": {
      // A line that waits on other lines of its order has nothing to pick: the others are fixed or skipped first.
      if (waits || reasons.some((r) => r.startsWith("order_waits:"))) return [skip];
      const picks = row.options.map((m) => ({
        decision: "use_match" as const,
        key: "ingest.decide.useMatch",
        vars: { name: m.label },
        matchId: m.id,
      }));
      return [...picks, { decision: "create_new", key: "ingest.decide.createNew" }, skip];
    }
    case "conflict":
      if (reasons.includes("order_line_new") || reasons.includes("po_on_live_order:poNumber")) {
        return [{ decision: "keep_live", key: "ingest.decide.keepLive" }, skip];
      }
      // Two different values of one whole-order field in a run: keep the file's value on the row, or skip it (rule 7.1).
      if (reasons.some((r) => r.startsWith("order_run_differs:"))) return [{ decision: "keep_file", key: "ingest.decide.keepFile" }, skip];
      // One PO on two old orders: keeping both cannot work, so the only way out is to skip the rows of one of them.
      if (reasons.includes("po_on_two_orders:poNumber")) return [skip];
      // The same old order in another file: keep it in this one, or skip it here.
      if (reasons.includes("order_in_other_file:order")) return [{ decision: "keep_file", key: "ingest.decide.keepHere" }, skip];
      return [
        { decision: "keep_file", key: "ingest.decide.keepFile" },
        { decision: "keep_live", key: "ingest.decide.keepLive" },
        skip,
      ];
    case "ready_create":
    case "ready_update":
      return [skip];
    default:
      return [];
  }
}

/** Fields of a conflict row where the file and orrn differ, for the "show both" card. */
export function diffEntries(
  diff: StagedRowView["diff"],
): { field: string; live: string; file: string }[] {
  if (!diff) return [];
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
  return Object.entries(diff).map(([field, d]) => ({ field, live: show(d.live), file: show(d.file) }));
}

/** Rates are hidden for people without `order.price`: the screen shows `ingest.rate.hidden`. */
export function rateCell(row: Pick<StagedRowView, "rate" | "rateHidden">): { hidden: true } | { hidden: false; value: number | null } {
  if (row.rateHidden) return { hidden: true };
  return { hidden: false, value: row.rate };
}

/** The reason line of a held or failed candidate: dictionary key and variables from `reasonCode`. */
export function reasonLine(
  reasonCode: string | null,
  reasonDetail: string | null,
): { key: string | null; vars: Record<string, string> } | null {
  if (!reasonCode) return null;
  // The browser told the server it could not read the file; the next step is the same for every cause.
  if (reasonCode === "read_failed") return { key: "ingest.read.failed", vars: {} };
  // A person's own words for holding it, and an ignored sheet, are shown as typed or not at all.
  if (reasonCode === "ignored") return null;
  const known = ["merge_failed", "dependency_held", "module_off", "confirm_blocked"];
  if (!known.includes(reasonCode)) return reasonDetail ? { key: null, vars: { detail: reasonDetail } } : null;
  const detail = reasonDetail ?? "";
  switch (reasonCode) {
    case "dependency_held":
      return { key: "ingest.reason.dependency_held", vars: { name: detail } };
    case "module_off":
      return { key: "ingest.reason.module_off", vars: { module: detail } };
    default:
      return { key: `ingest.reason.${reasonCode}`, vars: { detail } };
  }
}

/** "Merge {count} approved" is offered when something is approved and no run is active. */
export function canMergeAll(approvedCount: number, activeRunId: string | null, canMerge: boolean): boolean {
  return canMerge && approvedCount > 0 && activeRunId === null;
}

/** Whether the helper offer shows: needs_shape, helper ready, attempts left (4 per block, plan B6). */
export function helperOffer(c: Pick<CandidateSummary, "state" | "botAttempts">, botReady: boolean): "auto" | "off" | "none" {
  if (c.state !== "needs_shape") return "none";
  if (!botReady) return "off";
  return c.botAttempts < 4 ? "auto" : "none";
}

/**
 * Reads a stored fit diff safely: unknown or missing parts become empty lists. The engine stores
 * `renamed: { col, from, to }[]`, `extra: { col, header }[]` and `missing: { field, header }[]`; plain strings
 * (older rows) read too. `col` is the column of this file, for its sample values.
 */
export function fitDiffView(raw: unknown): FitDiff {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const col = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  const renamed = list(obj.renamed).flatMap((r) => {
    const o = rec(r);
    const from = typeof o.old === "string" ? o.old : typeof o.from === "string" ? o.from : null;
    const to = typeof o.new === "string" ? o.new : typeof o.to === "string" ? o.to : null;
    return from !== null && to !== null ? [{ old: from, new: to, col: col(o.col) }] : [];
  });
  const extra = list(obj.extra).flatMap((e) => {
    if (typeof e === "string") return [{ header: e, col: null }];
    const o = rec(e);
    return typeof o.header === "string" ? [{ header: o.header, col: col(o.col) }] : [];
  });
  const missing = list(obj.missing).flatMap((m) => {
    if (typeof m === "string") return [{ header: m, field: null }];
    const o = rec(m);
    return typeof o.header === "string" ? [{ header: o.header, field: typeof o.field === "string" ? o.field : null }] : [];
  });
  return {
    name: typeof obj.name === "string" ? obj.name : typeof obj.holeName === "string" ? obj.holeName : null,
    renamed,
    extra,
    missing,
  };
}
