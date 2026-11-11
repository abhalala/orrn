import { CANDIDATE_STATES, ROW_STATES } from "./types";
import type {
  CandidateCounts,
  CandidateQuestion,
  CandidateState,
  CandidateSummary,
  IngestTarget,
  MergeRunState,
  QuestionCode,
  RowDecision,
  RowState,
  StagedRow,
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
  held: "warning",
  approved: "success",
  merging: "info",
  merged: "success",
  failed: "danger",
  discarded: "neutral",
};

export function candidateTone(state: CandidateState): Tone {
  return STATE_TONE[state];
}

/** The fit chip: manual and bot mappings read as a new layout the person (or the helper) made. */
export function fitKeyOf(fit: CandidateSummary["fit"]): "ingest.fit.exact" | "ingest.fit.near" | "ingest.fit.none" {
  if (fit === "exact") return "ingest.fit.exact";
  if (fit === "near") return "ingest.fit.near";
  return "ingest.fit.none";
}

export type CandidateGroup = "needsYou" | "ready" | "approved" | "held" | "merged" | "other";

export const GROUP_ORDER: readonly Exclude<CandidateGroup, "other">[] = ["needsYou", "ready", "approved", "held", "merged"];

/** Which list group of the index screen a candidate sits in (`ingest.group.<group>`). */
export function groupOf(state: CandidateState): CandidateGroup {
  switch (state) {
    case "needs_shape":
    case "needs_confirm":
    case "failed":
      return "needsYou";
    case "processing":
    case "ready":
      return "ready";
    case "approved":
    case "merging":
      return "approved";
    case "held":
      return "held";
    case "merged":
      return "merged";
    case "discarded":
      return "other";
  }
}

export function groupKey(group: Exclude<CandidateGroup, "other">): string {
  return `ingest.group.${group}`;
}

/** Candidates grouped in screen order; empty groups and discarded ones are left out. */
export function groupCandidates<T extends { state: CandidateState }>(
  candidates: readonly T[],
): { group: Exclude<CandidateGroup, "other">; key: string; items: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    key: groupKey(group),
    items: candidates.filter((c) => groupOf(c.state) === group),
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
export function rowNeedsDecision(row: Pick<StagedRow, "state" | "decision">): boolean {
  return (row.state === "ambiguous" || row.state === "conflict") && row.decision === null;
}

export const ROW_FILTERS = ROW_STATES.filter((s) => s !== "pending") as Exclude<RowState, "pending">[];

export type StateCount = { state: Exclude<RowState, "pending">; key: string; tone: Tone; count: number };

/** The filter chips of a candidate: one per row state with at least one row, in fixed order. */
export function rowStateCounts(counts: CandidateCounts): StateCount[] {
  const by: Record<Exclude<RowState, "pending">, number> = {
    ready_create: counts.rowsCreate,
    ready_update: counts.rowsUpdate,
    unchanged: counts.rowsUnchanged,
    ambiguous: counts.rowsAmbiguous,
    conflict: counts.rowsConflict,
    refused: counts.rowsRefused,
    skipped: counts.rowsSkipped,
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
  return counts.rowsCreate + counts.rowsUpdate;
}

/** Rows the dry run has classified so far. `rowsTotal` is null until the rows are all put. */
export function classifiedRows(counts: CandidateCounts): number {
  return (
    counts.rowsCreate + counts.rowsUpdate + counts.rowsUnchanged + counts.rowsAmbiguous +
    counts.rowsConflict + counts.rowsRefused + counts.rowsSkipped
  );
}

/** 0 to 1, or null when the total is not known yet. */
export function dryRunProgress(counts: CandidateCounts): number | null {
  if (counts.rowsTotal === null || counts.rowsTotal <= 0) return null;
  return Math.min(1, classifiedRows(counts) / counts.rowsTotal);
}

/** Sums of the approved candidates, for the "Merge {count} approved" button. */
export function approvedSummary(candidates: readonly CandidateSummary[]): { count: number; rows: number } {
  const approved = candidates.filter((c) => c.state === "approved");
  return { count: approved.length, rows: approved.reduce((sum, c) => sum + writableRows(c), 0) };
}

export type ActionName = "approve" | "hold" | "discard";

/** What buttons a candidate offers. Approve and merge are for people holding `ingest.merge`. */
export function allowedActions(
  c: Pick<CandidateSummary, "state" | "openQuestions" | "rowsWritten">,
  can: { merge: boolean; upload: boolean },
): Record<ActionName, boolean> {
  const open = c.openQuestions ?? 0;
  const noWrite = c.rowsWritten === 0;
  return {
    approve: can.merge && c.state === "ready" && open === 0,
    hold: (can.merge || can.upload) && (c.state === "ready" || c.state === "approved"),
    discard: can.upload && noWrite && c.state !== "merging" && c.state !== "merged" && c.state !== "discarded",
  };
}

export const KNOWN_STATES: readonly CandidateState[] = CANDIDATE_STATES;

// ---------------------------------------------------------------------------------------------
// Questions (plan B7). One model for the question card; the screen draws the control.
// ---------------------------------------------------------------------------------------------

export type QuestionControl =
  | { kind: "unit"; field: string; unitKind: string | null }
  | { kind: "choice"; options: { value: string; labelKey?: string; label?: string }[] }
  | { kind: "period" }
  | { kind: "yesNo" }
  | { kind: "column" };

export type QuestionView = {
  code: QuestionCode;
  subject: string;
  /** Dictionary key, `ingest.q.<code>`. */
  key: string;
  vars: Record<string, string | number>;
  control: QuestionControl;
  answered: boolean;
  answer: unknown | null;
  rows: number;
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
};

export function questionView(q: CandidateQuestion): QuestionView {
  const vars: Record<string, string | number> = {};
  for (const name of QUESTION_VARS[q.code]) vars[name] = q.context[name] ?? "";
  let control: QuestionControl;
  switch (q.code) {
    case "unit_unknown":
      control = { kind: "unit", field: String(q.context.field ?? q.subject), unitKind: q.context.kind === undefined ? null : String(q.context.kind) };
      break;
    case "date_format_ambiguous":
      control = { kind: "choice", options: [{ value: "dmy", label: "dd/mm/yyyy" }, { value: "mdy", label: "mm/dd/yyyy" }] };
      break;
    case "period_needed":
      control = { kind: "period" };
      break;
    case "rates_hidden":
      control = { kind: "choice", options: [{ value: "leave_out", labelKey: "ingest.action.hold" }] };
      break;
    case "column_meaning_unclear":
      control = { kind: "column" };
      break;
    case "create_legacy_die":
    case "new_customers":
      control = { kind: "yesNo" };
      break;
  }
  return {
    code: q.code,
    subject: q.subject,
    key: `ingest.q.${q.code}`,
    vars,
    control,
    answered: q.answer !== null && q.answer !== undefined,
    answer: q.answer ?? null,
    rows: q.rows,
  };
}

/** Unanswered questions first, then answered ones, each in the server's order. */
export function questionList(questions: readonly CandidateQuestion[]): QuestionView[] {
  const views = questions.map(questionView);
  return [...views.filter((v) => !v.answered), ...views.filter((v) => v.answered)];
}

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

/** The menu of one row. A refused or finished row has none. */
export function decisionOptions(row: Pick<StagedRow, "state" | "matchId" | "matchOptions" | "mergeState">): DecisionOption[] {
  if (row.mergeState === "written") return [];
  const skip: DecisionOption = { decision: "skip", key: "ingest.decide.skip" };
  switch (row.state) {
    case "ambiguous": {
      const matches = row.matchOptions ?? [];
      const picks = matches.map((m) => ({
        decision: "use_match" as const,
        key: "ingest.decide.useMatch",
        vars: { name: m.name },
        matchId: m.id,
      }));
      return [...picks, { decision: "create_new", key: "ingest.decide.createNew" }, skip];
    }
    case "conflict":
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
  diff: StagedRow["diff"],
): { field: string; live: string; file: string }[] {
  if (!diff) return [];
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
  return Object.entries(diff).map(([field, d]) => ({ field, live: show(d.live), file: show(d.file) }));
}

/** Rates are hidden for people without `order.price`: the screen shows `ingest.rate.hidden`. */
export function rateCell(row: Pick<StagedRow, "rate" | "rateHidden">): { hidden: true } | { hidden: false; value: number | null } {
  if (row.rateHidden) return { hidden: true };
  return { hidden: false, value: row.rate ?? null };
}

/** The reason line of a held or failed candidate: dictionary key and variables from `reasonCode`. */
export function reasonLine(
  reasonCode: string | null,
  reasonDetail: string | null,
): { key: string | null; vars: Record<string, string> } | null {
  if (!reasonCode) return null;
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
  return (c.botAttempts ?? 0) < 4 ? "auto" : "none";
}
