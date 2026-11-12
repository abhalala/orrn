import {
  approvedSummary,
  fitKeyOf,
  groupOf,
  TARGET_KEY,
  candidateStateKey,
  candidateTone,
  type CandidateGroup,
  type Tone,
  type Words,
} from "./model";
import type { HeaderAskView } from "./header-step";
import type { PlantUnits } from "./plant-units";
import type { UploadItem } from "./upload";
import type { ArtifactSummary, CandidateSummary } from "./types";

/**
 * The view models of the candidates list and the upload strip (work order 3.1, 3.2; M2 to M6). The screens render
 * what these return: no screen groups, counts or picks a button for itself.
 */

/** How the list writes a number and a day. `listFormat(plant)` is the plant's way; the default is for tests. */
export type ListFormat = { count: (n: number) => string; date: (ms: number) => string };
export const PLAIN_FORMAT: ListFormat = { count: String, date: (ms) => new Date(ms).toISOString().slice(0, 10) };
export function listFormat(plant: Pick<PlantUnits, "count" | "fmt">): ListFormat {
  return { count: plant.count, date: (ms) => plant.fmt.date(ms, { year: false }) };
}

export type Segment = Exclude<CandidateGroup, "other">;
export const SEGMENTS: readonly Segment[] = ["needsYou", "ready", "approved", "merged"];

/** The segment an import is under, or null for one that shows elsewhere (checking rows, discarded). */
export function segmentOf(c: Pick<CandidateSummary, "state" | "openQuestions">): Segment | null {
  const group = groupOf(c);
  return group === "other" ? null : group;
}

export type SegmentOption = { id: Segment; labelKey: string; count: number };

/** The four segments with counts. `SegmentedControl` takes these as they are. */
export function listSegments(candidates: readonly Pick<CandidateSummary, "state" | "openQuestions">[]): SegmentOption[] {
  return SEGMENTS.map((id) => ({
    id,
    labelKey: `ingest.group.${id}`,
    count: candidates.filter((c) => segmentOf(c) === id).length,
  }));
}

/** Needs you when it has anything, else Ready. */
export function defaultSegment(segments: readonly SegmentOption[]): Segment {
  return (segments.find((s) => s.id === "needsYou")?.count ?? 0) > 0 ? "needsYou" : "ready";
}

/** The status block above the list: one loud element. */
export type ListStatus =
  | {
      tone: "success";
      titleKey: "ingest.list.ready";
      /** Approved imports. */
      value: number;
      /** `ingest.list.importsUnit` with `count`. */
      unit: Words;
      meta: Words;
    }
  | { tone: "warning"; titleKey: "ingest.group.needsYou"; value: number; unit: Words; meta: null };

/**
 * Approved above 0: green, "Ready to merge", rows that will be added and updated. Else needs-you above 0: amber.
 * Else nothing. `count` writes a number the plant's way (`plant.count`).
 */
export function listStatus(
  candidates: readonly Pick<CandidateSummary, "state" | "openQuestions" | "counts">[],
  { count }: Pick<ListFormat, "count"> = PLAIN_FORMAT,
): ListStatus | null {
  const approved = approvedSummary(candidates);
  if (approved.count > 0) {
    return {
      tone: "success",
      titleKey: "ingest.list.ready",
      value: approved.count,
      unit: { key: "ingest.list.importsUnit", vars: { count: approved.count } },
      meta: { key: "ingest.list.mergeMeta", vars: { created: count(approved.create), updated: count(approved.update) } },
    };
  }
  const needs = candidates.filter((c) => segmentOf(c) === "needsYou").length;
  if (needs > 0) {
    return { tone: "warning", titleKey: "ingest.group.needsYou", value: needs, unit: { key: "ingest.list.importsUnit", vars: { count: needs } }, meta: null };
  }
  return null;
}

/** What the title of a row is: the target's name, "New table", or the sheet's own name. */
export type RowTitle =
  | { kind: "target"; key: string; sheetName: string | null }
  | { kind: "newTable"; key: "ingest.list.newTable"; sheetName: null }
  | { kind: "sheet"; name: string; sheetName: null };

/** The target in words with the sheet name after it. With no target: the sheet name, or "New table" when there is none. */
export function rowTitle(c: Pick<CandidateSummary, "target" | "sheetName">): RowTitle {
  if (c.target) return { kind: "target", key: TARGET_KEY(c.target), sheetName: c.sheetName };
  if (c.sheetName && c.sheetName.trim() !== "") return { kind: "sheet", name: c.sheetName, sheetName: null };
  return { kind: "newTable", key: "ingest.list.newTable", sheetName: null };
}

/**
 * The fit as muted text: "Known layout", "Close to {name}", "Layout made by orrn", "Layout you made", "New layout".
 * Hidden (null) when the state already says it: an import that needs a layout or a check of the layout.
 */
export function fitWords(c: Pick<CandidateSummary, "fit" | "state" | "holeName">, nearName?: string | null): Words | null {
  if (c.state === "needs_shape" || c.state === "needs_confirm") return null;
  if (c.fit === "near") {
    const name = nearName ?? c.holeName;
    return name ? { key: "ingest.fit.nearNamed", vars: { name } } : { key: fitKeyOf("near") };
  }
  return { key: fitKeyOf(c.fit) };
}

/** The one chip of a row. A ready import with open questions says so (amber) instead of "Ready". */
export function statusChip(c: Pick<CandidateSummary, "state" | "openQuestions">): { words: Words; tone: Tone } {
  if (c.state === "ready" && c.openQuestions > 0) {
    return { words: { key: "ingest.state.questions", vars: { count: c.openQuestions } }, tone: "warning" };
  }
  return { words: { key: candidateStateKey(c.state) }, tone: candidateTone(c.state) };
}

/** Whether the dry run has counted this import's rows yet. */
export function isCounted(state: CandidateSummary["state"]): boolean {
  return state !== "needs_shape" && state !== "needs_confirm" && state !== "processing" && state !== "failed";
}

export type RowActionKind = "approve" | "hold" | "review" | "mapColumns" | "checkLayout";

/** `write` calls the server on the spot; `link` opens the review page. */
export type RowAction = { kind: RowActionKind; labelKey: string; variant: "primary" | "secondary"; mode: "write" | "link" };

const ACTION: Record<RowActionKind, RowAction> = {
  approve: { kind: "approve", labelKey: "ingest.action.approve", variant: "primary", mode: "write" },
  hold: { kind: "hold", labelKey: "ingest.action.hold", variant: "secondary", mode: "write" },
  review: { kind: "review", labelKey: "ingest.action.review", variant: "primary", mode: "link" },
  mapColumns: { kind: "mapColumns", labelKey: "ingest.action.mapColumns", variant: "primary", mode: "link" },
  checkLayout: { kind: "checkLayout", labelKey: "ingest.action.checkLayout", variant: "primary", mode: "link" },
};

/**
 * The one action a row gets. Approve for a ready import with nothing to answer (a person without `ingest.merge`
 * gets Review). Review for a ready import with questions, a failed one and a held one. Map columns for an import
 * that needs a layout. Check layout for a near fit. Hold for an approved one. Nothing for a merged one or one that
 * is still moving.
 */
export function rowAction(
  c: Pick<CandidateSummary, "state" | "openQuestions" | "counts">,
  can: { merge: boolean; upload: boolean },
): RowAction | null {
  switch (c.state) {
    case "ready":
      return c.openQuestions === 0 && can.merge ? ACTION.approve : ACTION.review;
    case "failed":
    case "held":
      return ACTION.review;
    case "needs_shape":
      return ACTION.mapColumns;
    case "needs_confirm":
      return ACTION.checkLayout;
    case "approved":
      return can.merge || can.upload ? ACTION.hold : null;
    default:
      return null;
  }
}

export type ListRow = {
  id: string;
  candidate: CandidateSummary;
  title: RowTitle;
  fit: Words | null;
  chip: { words: Words; tone: Tone };
  /**
   * New, Updates, Questions, Cannot import. A zero is muted; questions above zero are amber. Null while nothing has
   * been counted yet (an import that needs a layout, a check of the layout, still checking or failed): a row of zeros
   * there would say "nothing to do" when the truth is "not looked at".
   */
  numbers: { create: number; update: number; questions: number; cannot: number } | null;
  action: RowAction | null;
  /** The hold or merge reason, shown under the row. */
  reasonCode: string | null;
  reasonDetail: string | null;
};

export type FileGroup = {
  artifactId: string;
  fileName: string;
  /** When the file was added (ms), when the artifact list has it. */
  addedAt: number | null;
  /** `ingest.list.tables` with a date, or `ingest.list.tablesNoDate` when the date is not known. */
  summary: Words;
  rows: ListRow[];
  /** "Approve all N": the imports that may be approved in one press, when there are two or more. */
  approveAll: { ids: string[]; count: number } | null;
};

/** A file whose rows a model read (a scan or a photo). Such rows never skip a person, even a bulk one. */
export function isModelRead(kind: ArtifactSummary["kind"] | undefined): boolean {
  return kind === "pdf_scan" || kind === "image";
}

/**
 * The imports one press of "Approve all N" may approve (lead answer 4): ready, nothing to answer, an exact fit (no
 * unconfirmed near fit), read by a parser, and a year that does not need confirming. A file whose artifact is not
 * known yet has none: the safe answer when information is missing.
 */
export function approveAllEligible(
  rows: readonly Pick<CandidateSummary, "id" | "state" | "openQuestions" | "fit" | "target">[],
  artifact: Pick<ArtifactSummary, "kind" | "periodConfirmed"> | undefined,
): string[] {
  if (!artifact || isModelRead(artifact.kind)) return [];
  return rows
    .filter((c) => {
      if (c.state !== "ready" || c.openQuestions !== 0 || c.fit !== "exact") return false;
      // Orders and bundles are placed in time. Until the person says which year, they are not bulk.
      if ((c.target === "orders" || c.target === "bundles") && !artifact.periodConfirmed) return false;
      return true;
    })
    .map((c) => c.id);
}

/**
 * The list under the segmented control: the imports of one segment, grouped by file (newest file first), each file
 * with its summary line and its rows. `artifacts` come from `useArtifacts()` and give each file's date and kind.
 */
export function fileGroups(
  candidates: readonly CandidateSummary[],
  segment: Segment,
  artifacts: readonly Pick<ArtifactSummary, "id" | "createdAt" | "kind" | "periodConfirmed">[],
  can: { merge: boolean; upload: boolean },
  { date }: Pick<ListFormat, "date"> = PLAIN_FORMAT,
): FileGroup[] {
  const byArtifact = new Map(artifacts.map((a) => [a.id, a]));
  const inSegment = candidates.filter((c) => segmentOf(c) === segment);
  const order: string[] = [];
  const groups = new Map<string, CandidateSummary[]>();
  for (const c of inSegment) {
    if (!groups.has(c.artifactId)) {
      groups.set(c.artifactId, []);
      order.push(c.artifactId);
    }
    groups.get(c.artifactId)!.push(c);
  }
  const out = order.map((artifactId): FileGroup => {
    const items = groups.get(artifactId)!.sort((a, b) => a.blockOrdinal - b.blockOrdinal);
    const artifact = byArtifact.get(artifactId);
    const allOfFile = candidates.filter((c) => c.artifactId === artifactId && c.state !== "discarded").length;
    const eligible = approveAllEligible(items, artifact);
    return {
      artifactId,
      fileName: items[0]!.fileName,
      addedAt: artifact?.createdAt ?? null,
      summary: artifact
        ? { key: "ingest.list.tables", vars: { count: allOfFile, date: date(artifact.createdAt) } }
        : { key: "ingest.list.tablesNoDate", vars: { count: allOfFile } },
      rows: items.map((candidate): ListRow => ({
        id: candidate.id,
        candidate,
        title: rowTitle(candidate),
        fit: fitWords(candidate),
        chip: statusChip(candidate),
        numbers: isCounted(candidate.state)
          ? { create: candidate.counts.create, update: candidate.counts.update, questions: candidate.openQuestions, cannot: candidate.counts.refused }
          : null,
        action: rowAction(candidate, can),
        reasonCode: candidate.reasonCode,
        reasonDetail: candidate.reasonDetail,
      })),
      approveAll: eligible.length >= 2 ? { ids: eligible, count: eligible.length } : null,
    };
  });
  // Newest file first. A file with no known date keeps its place after the dated ones.
  return out
    .map((g, index) => ({ g, index }))
    .sort((a, b) => (b.g.addedAt ?? -1) - (a.g.addedAt ?? -1) || a.index - b.index)
    .map(({ g }) => g);
}

/** The sticky bar of the list (work order 3.2 item 5 and 6). */
export type MergeBar = {
  /** The bar shows: from 1 approved import, or while a merge is running. */
  show: boolean;
  /** "{count} imports approved, {rows} rows". Null with nothing approved. */
  summary: Words | null;
  /** "Merge N approved imports": null when a run is active, nothing is approved, or the person cannot merge. */
  merge: { count: number; words: Words } | null;
  /** A merge is running: a secondary link to the run in place of the merge button. */
  running: { runId: string } | null;
  /** The muted line at the end of the list when nothing is approved: `ingest.action.mergeNone`. */
  hint: Words | null;
};

export function mergeBar(
  candidates: readonly Pick<CandidateSummary, "state" | "counts">[],
  activeRunId: string | null,
  canMerge: boolean,
  { count }: Pick<ListFormat, "count"> = PLAIN_FORMAT,
): MergeBar {
  const approved = approvedSummary(candidates);
  const running = activeRunId ? { runId: activeRunId } : null;
  const show = (canMerge && approved.count > 0) || running !== null;
  return {
    show,
    summary: approved.count > 0 ? { key: "ingest.list.bar", vars: { count: approved.count, rows: count(approved.rows) } } : null,
    merge: canMerge && approved.count > 0 && !running ? { count: approved.count, words: { key: "ingest.action.mergeAll", vars: { count: approved.count } } } : null,
    running,
    hint: approved.count === 0 && !running && canMerge ? { key: "ingest.action.mergeNone" } : null,
  };
}

/** The sheet that confirms a merge (S8): each approved import with its counts. */
export function mergeConfirm(candidates: readonly CandidateSummary[], { count }: Pick<ListFormat, "count"> = PLAIN_FORMAT): {
  title: Words;
  note: Words;
  items: { id: string; title: RowTitle; fileName: string; create: string; update: string }[];
} {
  const approved = candidates.filter((c) => c.state === "approved");
  return {
    title: { key: "ingest.merge.confirmTitle", vars: { count: approved.length } },
    note: { key: "ingest.merge.confirmNote" },
    items: approved.map((c) => ({ id: c.id, title: rowTitle(c), fileName: c.fileName, create: count(c.counts.create), update: count(c.counts.update) })),
  };
}

/** The bulk confirm: the count, asked once before it runs. */
export function approveAllConfirm(group: Pick<FileGroup, "approveAll" | "fileName">): { title: Words; body: Words; confirm: Words } | null {
  if (!group.approveAll) return null;
  const n = group.approveAll.count;
  return {
    title: { key: "ingest.bulk.title", vars: { count: n } },
    body: { key: "ingest.bulk.body", vars: { file: group.fileName } },
    confirm: { key: "ingest.bulk.confirm", vars: { count: n } },
  };
}

// ---------------------------------------------------------------------------------------------
// The upload strip
// ---------------------------------------------------------------------------------------------

export type StripEntry =
  | {
      kind: "upload";
      id: string;
      name: string;
      step: UploadItem["step"];
      /** Muted line under the name. */
      words: Words | null;
      /** 0 to 1 for a bar, null for a quiet one, undefined for no bar. */
      progress: number | null | undefined;
      /** A file read: what was found, and the candidates to open. Null before. */
      found: { count: number; parts: { title: RowTitle; fit: Words | null }[]; firstCandidateId: string | null } | null;
      /** Buttons: `retry` for a failed file, `open` for one seen before (with `artifactId`), `review` for a read one. */
      actions: ("retry" | "open" | "review")[];
      artifactId: string | null;
      seenOn: number | null;
      notStored: boolean;
      canonicalMissing: boolean;
      /** While `asking`: the table waiting on the person. */
      ask: HeaderAskView | null;
      /** Rows the reader left out and listed, and blank rows crossed inside a table. */
      notes: UploadItem["notes"];
    }
  | {
      kind: "checking";
      id: string;
      candidateId: string;
      title: RowTitle;
      fileName: string;
      /** Blue "Checking rows" chip. */
      chip: Words;
      progress: number | null;
    };

/**
 * Entries of the strip right under the header. Files being added come first, then imports being checked (state
 * `processing`, which is in no segment). `rowsClassified` per candidate gives the checking bar.
 */
export function uploadStrip(
  items: readonly UploadItem[],
  candidates: readonly CandidateSummary[],
  { count, date }: ListFormat = PLAIN_FORMAT,
): StripEntry[] {
  const entries: StripEntry[] = items.map((item): StripEntry => {
    const of = item.artifactId ? candidates.filter((c) => c.artifactId === item.artifactId && c.state !== "discarded") : [];
    let words: Words | null = null;
    let progress: number | null | undefined;
    switch (item.step) {
      case "queued":
      case "hashing":
        progress = null;
        break;
      case "reading": {
        const total = item.progress?.rowsTotal ?? 0;
        progress = total > 0 ? Math.min(1, (item.progress?.rowsRead ?? 0) / total) : null;
        words = total > 0
          ? { key: "ingest.read.progress", vars: { done: count(item.progress?.rowsRead ?? 0), total: count(total) } }
          : { key: "ingest.read.reading", vars: { sheet: item.progress?.sheet ?? item.name, rows: count(item.progress?.rowsRead ?? 0) } };
        break;
      }
      case "saving":
        words = { key: "ingest.read.uploading" };
        progress = null;
        break;
      case "sending":
        progress = item.sent?.total ? item.sent.rows / item.sent.total : null;
        words = { key: "ingest.read.sending", vars: { done: count(item.sent?.rows ?? 0), total: count(item.sent?.total ?? 0) } };
        break;
      case "seenBefore":
        words = { key: "ingest.drop.seenBefore", vars: { date: item.seenOn ? date(item.seenOn) : "" } };
        break;
      case "refused":
        words = item.problem ? { key: item.problem.key, vars: item.problem.vars } : null;
        break;
      case "failed":
        words = { key: "ingest.read.failed" };
        break;
      case "kept":
        words = { key: "ingest.kept.added" };
        break;
      case "asking":
      case "done":
        break;
    }
    const found = item.step === "done"
      ? {
          count: of.length,
          parts: of.map((c) => ({ title: rowTitle(c), fit: fitWords(c) })),
          firstCandidateId: of.find((c) => c.state !== "processing")?.id ?? of[0]?.id ?? null,
        }
      : null;
    const actions: ("retry" | "open" | "review")[] = [];
    if (item.step === "failed") actions.push("retry");
    if (item.step === "seenBefore" && item.artifactId) actions.push("open");
    if (found && found.firstCandidateId) actions.push("review");
    return {
      kind: "upload",
      id: item.id,
      name: item.name,
      step: item.step,
      words,
      progress,
      found,
      actions,
      artifactId: item.artifactId,
      seenOn: item.seenOn,
      notStored: item.notStored,
      canonicalMissing: item.canonicalMissing === true,
      ask: item.step === "asking" ? (item.ask ?? null) : null,
      notes: item.step === "done" ? (item.notes ?? []) : [],
    };
  });
  const shown = new Set(items.map((i) => i.artifactId).filter((id): id is string => Boolean(id)));
  for (const c of candidates) {
    if (c.state !== "processing") continue;
    // A file being added already shows its own row; its checking rows join that row once it is read.
    if (shown.has(c.artifactId) && items.some((i) => i.artifactId === c.artifactId && i.step !== "done")) continue;
    const total = c.counts.total;
    const classified = c.counts.create + c.counts.update + c.counts.unchanged + c.counts.ambiguous + c.counts.conflict + c.counts.refused + c.counts.skipped;
    entries.push({
      kind: "checking",
      id: `check-${c.id}`,
      candidateId: c.id,
      title: rowTitle(c),
      fileName: c.fileName,
      chip: { key: "ingest.state.processing" },
      progress: total > 0 ? Math.min(1, classified / total) : null,
    });
  }
  return entries;
}

/** "Read. 2 tables: Sections, Known layout; Customers, Known layout." The words of a read file, joined by the screen's `say`. */
export function foundSummary(
  say: (key: string, vars?: Record<string, string | number>) => string,
  found: { count: number; parts: { title: RowTitle; fit: Words | null }[] },
): string {
  const parts = found.parts.map((p) => {
    const title = p.title.kind === "sheet" ? p.title.name : say(p.title.kind === "target" ? p.title.key : "ingest.list.newTable");
    const fit = p.fit ? say(p.fit.key, p.fit.vars) : "";
    return fit ? `${title}, ${fit}` : title;
  });
  return say("ingest.drop.done", { count: found.count, summary: parts.join("; ") });
}

/** What the person may do about the file picker given what is on screen: the note field shows once files are chosen. */
export function uploadLayout(hasCandidates: boolean, hasItems: boolean): { dropZone: boolean; headerAdd: boolean; noteField: boolean } {
  return { dropZone: !hasCandidates && !hasItems, headerAdd: hasCandidates || hasItems, noteField: hasItems };
}
