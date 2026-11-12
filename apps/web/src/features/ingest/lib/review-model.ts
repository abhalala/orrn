import type { Recipe } from "@orrn/ingest";

import { fitWords, rowTitle, segmentOf, statusChip, type RowTitle } from "./list-model";
import { sampleValues, isRateColumn, readEntries, type ColumnEntry, type SampleView } from "./mapping-model";
import {
  allowedActions,
  fitDiffView,
  helperOffer,
  openQuestionTotal,
  questionList,
  reasonLine,
  TARGET_KEY,
  type QuestionView,
  type Say,
  type Tone,
  type Words,
} from "./model";
import type { PlantUnits } from "./plant-units";
import type { CandidateDetail, CandidateSummary } from "./types";

/**
 * The review page's decision bar and panels (work order 3.3, M7, M10, M11, M12, M15). The screen draws what this
 * returns. The bar is the one loud element: one primary button at most, secondary ones next to it, the rest in an
 * overflow menu.
 */

export type BarActionId =
  | "approve"
  | "approveAsIs"
  | "hold"
  | "release"
  | "useLayout"
  | "rejectLayout"
  | "mapForMe"
  | "mapMyself"
  | "goMerge"
  | "seeFile";

export type BarButton = {
  id: BarActionId;
  words: Words;
  variant: "primary" | "secondary";
  /** `write` calls the server, `toggle` opens or closes the editor (`aria-expanded`, `aria-controls`), `link` goes to a page. */
  mode: "write" | "toggle" | "link";
};

export type OverflowItem = { id: "discard" | "ignore"; words: Words };

export type BarContext = {
  can: { merge: boolean; upload: boolean };
  /** `useIngestStatus().botReady`. */
  botReady: boolean;
  /** The "Map columns myself" editor is open: "Map columns for me" turns secondary. */
  editorOpen: boolean;
};

export type DecisionBar = {
  chip: { words: Words; tone: Tone };
  /** The effect sentence: "Adds 3 new and updates 0 in orrn." */
  sentence: Words | null;
  /** "2 rows cannot be imported." */
  refused: Words | null;
  /** Plain facts about how the rows were read: rows with no order number, party, date or PO taken from the row above. */
  notes: Words[];
  /** Muted fit text. */
  fit: Words | null;
  /** The amber reason line of a held import, and the server's own English for it. */
  reason: { code: string; detail: string | null } | null;
  /** A ready import with open questions: "Answer 1 question to approve." as a link that scrolls to what is open. */
  blocked: { words: Words; to: "question" | "rows" } | null;
  buttons: BarButton[];
  overflow: OverflowItem[];
  /** The heading of the overflow menu button: "More for {name}" with the title in `name`. */
  moreFor: Words;
};

const approveBtn: BarButton = { id: "approve", words: { key: "ingest.action.approve" }, variant: "primary", mode: "write" };
const holdBtn: BarButton = { id: "hold", words: { key: "ingest.action.hold" }, variant: "secondary", mode: "write" };

/** What the first open thing is: a question when one is open, else a row nobody has decided. */
export function firstOpen(questions: readonly Pick<QuestionView, "answered">[], undecidedRows: number): "question" | "rows" {
  return questions.some((q) => !q.answered) ? "question" : undecidedRows > 0 ? "rows" : "question";
}

/** Imports a person has to leave alone while the candidate moves by itself. */
const MOVING = new Set(["processing", "merging"]);

export function decisionBar(
  c: Pick<CandidateDetail, "state" | "openQuestions" | "counts" | "fit" | "holeName" | "fitDiff" | "reasonCode" | "reasonDetail" | "target" | "sheetName" | "fileName" | "questions" | "botAttempts"> & { rowsOwnOrder?: number },
  ctx: BarContext,
): DecisionBar {
  const { can } = ctx;
  // Every open question counts for the chip and for the line that links to the first one, the year included.
  c = { ...c, openQuestions: openQuestionTotal(c) };
  const allowed = allowedActions(c, can);
  const diff = fitDiffView(c.fitDiff);
  const changed = diff.renamed.length + diff.extra.length + diff.missing.length;
  const chip = statusChip(c);

  let sentence: Words | null = null;
  switch (c.state) {
    case "ready":
    case "held":
      sentence = c.counts.create + c.counts.update > 0
        ? { key: "ingest.effect.line", vars: { create: c.counts.create, update: c.counts.update } }
        // Rows that wait on an answer are not empty: "Nothing to add" is only for rows that are refused or unchanged.
        : c.counts.ambiguous + c.counts.conflict > 0
          ? { key: "ingest.effect.waiting", vars: { count: c.counts.ambiguous + c.counts.conflict } }
          : { key: "ingest.effect.nothing" };
      break;
    case "approved":
      sentence = { key: "ingest.effect.approved" };
      break;
    case "needs_confirm":
      sentence = { key: "ingest.near.title", vars: { name: diff.name ?? c.holeName ?? "", count: changed } };
      break;
    case "needs_shape":
      sentence = { key: "ingest.effect.needsShape" };
      break;
    case "processing":
      sentence = { key: "ingest.effect.processing" };
      break;
    case "failed":
      sentence = { key: "ingest.effect.failed" };
      break;
    case "merged":
      sentence = { key: "ingest.effect.merged", vars: { created: c.counts.create, updated: c.counts.update } };
      break;
    case "discarded":
      sentence = { key: "ingest.effect.discarded" };
      break;
    case "merging":
      sentence = { key: "ingest.state.merging" };
      break;
  }
  const showsCounts = c.state === "ready" || c.state === "held";
  const notes: Words[] = [];
  // An order book: rows with no order number and no PO are one order each (rule 1); a blank party, date or PO took the
  // value of the first row of its order's run (rule 7.1).
  if (showsCounts && (c.rowsOwnOrder ?? 0) > 0) notes.push({ key: "ingest.effect.ownOrder", vars: { count: c.rowsOwnOrder! } });
  if (showsCounts && (c.counts.filled ?? 0) > 0) notes.push({ key: "ingest.effect.filled", vars: { count: c.counts.filled } });
  const refused = showsCounts && c.counts.refused > 0 ? { key: "ingest.effect.refused", vars: { count: c.counts.refused } } : null;

  const buttons: BarButton[] = [];
  const overflow: OverflowItem[] = [];
  let blocked: DecisionBar["blocked"] = null;
  const discard: OverflowItem = { id: "discard", words: { key: "ingest.action.discard" } };

  switch (c.state) {
    case "ready":
      if (c.openQuestions > 0) {
        blocked = {
          words: { key: "ingest.action.approveBlocked", vars: { count: c.openQuestions } },
          to: firstOpen(questionList(c.questions, c.target), c.counts.ambiguous + c.counts.conflict),
        };
      } else if (allowed.approve) buttons.push(approveBtn);
      if (allowed.hold) buttons.push(holdBtn);
      break;
    case "needs_confirm":
      if (can.upload) {
        buttons.push({ id: "useLayout", words: { key: "ingest.near.use" }, variant: "primary", mode: "write" });
        buttons.push({ id: "rejectLayout", words: { key: "ingest.near.reject" }, variant: "secondary", mode: "write" });
      }
      break;
    case "needs_shape": {
      if (can.upload) {
        const offer = helperOffer(c, ctx.botReady);
        const auto = offer === "auto";
        if (auto) buttons.push({ id: "mapForMe", words: { key: "ingest.shape.auto" }, variant: ctx.editorOpen ? "secondary" : "primary", mode: "write" });
        buttons.push({ id: "mapMyself", words: { key: "ingest.shape.manual" }, variant: auto || ctx.editorOpen ? "secondary" : "primary", mode: "toggle" });
        overflow.push({ id: "ignore", words: { key: "ingest.shape.ignore" } });
      }
      break;
    }
    case "held":
      if (allowed.release) buttons.push({ id: "release", words: { key: "ingest.action.release" }, variant: "primary", mode: "write" });
      // Only with nothing open: the server refuses an approval while a question or a row waits.
      if (allowed.approve) buttons.push({ id: "approveAsIs", words: { key: "ingest.action.approveAsIs" }, variant: "secondary", mode: "write" });
      break;
    case "approved":
      if (allowed.hold) buttons.push(holdBtn);
      buttons.push({ id: "goMerge", words: { key: "ingest.action.goMerge" }, variant: "secondary", mode: "link" });
      break;
    case "merged":
      buttons.push({ id: "seeFile", words: { key: "ingest.action.seeFile" }, variant: "secondary", mode: "link" });
      break;
    default:
      break;
  }
  if (allowed.discard && !MOVING.has(c.state)) overflow.push(discard);
  const title = rowTitle(c);
  return {
    chip,
    sentence,
    refused,
    notes,
    fit: fitWords(c, diff.name),
    reason: c.state === "held" && c.reasonCode ? { code: c.reasonCode, detail: c.reasonDetail } : null,
    blocked,
    buttons,
    overflow,
    moreFor: c.target
      ? { key: "ingest.action.more", varKeys: { name: TARGET_KEY(c.target) } }
      : { key: "ingest.action.more", vars: { name: title.kind === "sheet" ? title.name : c.fileName } },
  };
}

/** The name a repeated button or link carries: "Approve: Sections, dies-b-RCQCZ.csv" (S11, WCAG 2.4.4). */
export function cardLabel(
  say: Say,
  action: string,
  c: Pick<CandidateSummary, "target" | "sheetName" | "fileName">,
): string {
  const title = c.target ? say(TARGET_KEY(c.target)) : c.sheetName && c.sheetName.trim() !== "" ? c.sheetName : say("ingest.list.newTable");
  return `${action}: ${title}, ${c.fileName}`;
}

/** The first import in Needs you other than this one, for "Next that needs you" (S6). */
export function nextNeedsYou(candidates: readonly Pick<CandidateSummary, "id" | "state" | "openQuestions" | "blockOrdinal">[], currentId: string): string | null {
  const next = candidates.find((c) => c.id !== currentId && segmentOf(c) === "needsYou");
  return next ? next.id : null;
}

/** The line in the bar after Approve or Hold (S6): what happened and the next step. */
export function afterDecision(input: {
  kind: "approved" | "held";
  approvedCount: number;
  nextId: string | null;
}): { words: Words; next: { id: string } | null; goMerge: boolean } {
  return {
    words: input.kind === "approved" ? { key: "ingest.action.approvedSoFar", vars: { count: input.approvedCount } } : { key: "ingest.action.heldDone" },
    next: input.nextId ? { id: input.nextId } : null,
    goMerge: input.approvedCount > 0,
  };
}

/** The hold sheet's reasons (S5): short reasons as chips, then a text field. The chip's text is the reason sent. */
export const HOLD_REASONS: readonly { id: string; key: string }[] = [
  { id: "owner", key: "ingest.hold.owner" },
  { id: "wrongFile", key: "ingest.hold.wrongFile" },
  { id: "fixFirst", key: "ingest.hold.fixFirst" },
];

/**
 * The reason text to send to `actions.hold`: what is typed, else the chosen chip's words. Up to 300 characters, the
 * server's limit. Empty gives `undefined`: holding without a reason is fine.
 */
export function holdReason(say: Say, chipId: string | null, typed: string): string | undefined {
  const text = typed.trim() || (chipId ? say(HOLD_REASONS.find((r) => r.id === chipId)?.key ?? "") : "");
  const out = text.trim().slice(0, 300);
  return out === "" ? undefined : out;
}

/**
 * The held reason as pieces of text, so the server's English detail can sit in its own `lang="en"` span (work order
 * M17). `say` is the screen's translate function. A reason with no detail is one plain piece.
 */
export function reasonPieces(say: Say, code: string | null, detail: string | null): { text: string; lang?: "en" }[] {
  const line = reasonLine(code, detail);
  if (!line) return [];
  // A reason the person typed when holding is their own words, in whatever language they wrote it.
  if (line.key === null) return detail ? (code === "person" ? [{ text: detail }] : endSentence([{ text: detail, lang: "en" }])) : [];
  const marker = "\u0000";
  const filled = say(line.key, { ...line.vars, ...(line.vars.detail !== undefined ? { detail: marker } : {}) });
  if (!filled.includes(marker)) return endSentence([{ text: filled }]);
  const [before = "", after = ""] = filled.split(marker);
  const pieces: { text: string; lang?: "en" }[] = [];
  if (before) pieces.push({ text: before });
  if (line.vars.detail) pieces.push({ text: line.vars.detail, lang: "en" });
  if (after) pieces.push({ text: after });
  return endSentence(pieces);
}

/** The reason is a sentence: end it with a full stop when the words (the server's own text) lack one. */
function endSentence(pieces: { text: string; lang?: "en" }[]): { text: string; lang?: "en" }[] {
  const last = pieces[pieces.length - 1];
  if (!last || /[.!?\u0964\u2026]\s*$/.test(last.text)) return pieces;
  return [...pieces.slice(0, -1), { ...last, text: `${last.text.trimEnd()}.` }];
}

// ---------------------------------------------------------------------------------------------
// "How orrn read this file" and "What changed"
// ---------------------------------------------------------------------------------------------

export type ReadPanel = {
  /** Open by default for layouts made by orrn or a person, near fits and imports that need a layout. Exact fits are one line. */
  openByDefault: boolean;
  summary: Words;
  entries: ColumnEntry[];
  /** The "Change mapping" button: only when the layout can change. */
  canChange: boolean;
  /** A near fit adds the "What changed" table. */
  changes: NearChangeRow[] | null;
};

export type NearChangeRow = {
  kind: "renamed" | "new" | "missing";
  /** The chip: "Renamed", "New", "Missing" (amber). */
  chip: Words;
  /** The saved layout's column, or null for a new column. */
  saved: string | null;
  /** The column in this file, or null for a missing one. */
  now: string | null;
  samples: SampleView | null;
};

/** Rows of the "What changed" table: renamed, new and missing columns, with sample values from `block.sample`. */
export function nearChanges(
  c: Pick<CandidateDetail, "fitDiff" | "block" | "target">,
  canSeePrices: boolean,
): NearChangeRow[] {
  const diff = fitDiffView(c.fitDiff);
  const sample = (col: number | null, header: string): SampleView | null => {
    if (col === null) return null;
    return sampleValues(c.block, col, !canSeePrices && isRateColumn(header, null, c.target));
  };
  return [
    ...diff.renamed.map((r): NearChangeRow => ({ kind: "renamed", chip: { key: "ingest.near.kindRenamed" }, saved: r.old, now: r.new, samples: sample(r.col, r.new) })),
    ...diff.extra.map((e): NearChangeRow => ({ kind: "new", chip: { key: "ingest.near.kindNew" }, saved: null, now: e.header, samples: sample(e.col, e.header) })),
    ...diff.missing.map((m): NearChangeRow => ({ kind: "missing", chip: { key: "ingest.near.kindMissing" }, saved: m.header, now: null, samples: null })),
  ];
}

export function readPanel(
  c: Pick<CandidateDetail, "state" | "fit" | "target" | "recipe" | "block" | "fitDiff">,
  plant: PlantUnits,
  canSeePrices: boolean,
  canChange: boolean,
): ReadPanel {
  const read = readEntries({ target: c.target, recipe: (c.recipe ?? null) as Recipe | null, block: c.block }, plant, canSeePrices);
  const loud = c.fit !== "exact" || c.state === "needs_shape" || c.state === "needs_confirm";
  return {
    openByDefault: loud,
    summary: { key: "ingest.read.summary", vars: { used: read.used, unused: read.unused } },
    entries: read.entries,
    canChange: canChange && c.state !== "merged" && c.state !== "merging",
    changes: c.fit === "near" || c.state === "needs_confirm" ? nearChanges(c, canSeePrices) : null,
  };
}

/** The page title: the target, or "New table" / the sheet name. And the subtitle parts the screen joins with " · ". */
export function reviewHeader(c: Pick<CandidateDetail, "target" | "sheetName" | "fileName" | "block" | "counts">): {
  title: RowTitle;
  fileName: string;
  sheetName: string | null;
  rows: number;
  columns: number;
} {
  return { title: rowTitle(c), fileName: c.fileName, sheetName: c.sheetName, rows: c.counts.total || c.block.rowCount, columns: c.block.columnCount };
}

/** For `document.title` on each ingest route: "{target}, {file} | Imports | orrn". */
export function reviewDocTitle(say: Say, c: Pick<CandidateDetail, "target" | "sheetName" | "fileName">): string {
  const title = c.target ? say(TARGET_KEY(c.target)) : c.sheetName && c.sheetName.trim() !== "" ? c.sheetName : say("ingest.list.newTable");
  return say("ingest.docTitle.review", { target: title, file: c.fileName });
}
