/**
 * What the operator has typed in the counting stepper. It lives in the screen's state (and in
 * sessionStorage, so a reload or a dropped connection does not lose it), starts from what the
 * server already holds, and is never cleared by a failed save (station rule).
 */
import { lengthFromInput, MM_PER_INCH, type LengthUnit } from "@orrn/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import { gToKgText, type BilletDraft, type LineDraft, type QcDraft } from "./model";
import type { RunDetail } from "./types";

export type Draft = {
  /** The saved rows this draft started against (`serverBase`); a different base means the server moved on. */
  base: string;
  step: number;
  castId: string;
  billets: BilletDraft[];
  lines: LineDraft[];
  pressedLengthText: string;
  discardText: string;
  endsText: string;
  qc: QcDraft[];
  pressRemark: string;
  dieRemark: string;
  readingText: string;
  billetShortReason: string;
  trialResult: "" | "pass" | "fail";
};

let counter = 0;
export const rowKey = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyBillet = (): BilletDraft => ({ key: rowKey(), lengthText: "", countText: "", kgText: "" });
export const emptyQc = (): QcDraft => ({ key: rowKey(), pcsText: "", kgText: "", reasonCodeId: "", note: "", runLine: null });
export const emptyCut = (): LineDraft => ({ key: rowKey(), cutLengthMm: null, cutText: "", pcsText: "", kgText: "", pressPlanLineId: null, orderNumber: null, releasedPcs: null });

/** A length field's text for a stored mm value (inches for an inch company, else mm). */
export function lengthToText(mm: number | null | undefined, unit: LengthUnit): string {
  if (mm === null || mm === undefined) return "";
  return unit === "inch" ? String(Math.round((mm / MM_PER_INCH) * 100) / 100) : String(Math.round(mm));
}

/** The reverse: a typed length to whole mm for the company's unit (inch companies type inches). */
export function textToLength(text: string, unit: LengthUnit): number | null {
  return unit === "inch" ? lengthFromInput({ unit, inches: text }) : lengthFromInput({ unit, mm: text });
}

/**
 * A fingerprint of the entries the server holds for the run. A draft remembers the one it started
 * against (and takes the new one after this tablet's own saves); when the server's differs at
 * mount, another device saved in between and the server's rows win (review r1 m-6).
 */
export function serverBase(data: RunDetail): string {
  return JSON.stringify([
    data.run.castId ?? null,
    data.billets.map((b) => [b.lengthMm, b.count, b.kgG]),
    data.lines.map((l) => [l.pressPlanLineId ?? null, l.cutLengthMm, l.pcs, l.goodG]),
    data.qc.map((q) => [q.pcs, q.kgG, q.reasonCodeId ?? null, q.note ?? null]),
    data.run.pressedLengthMm ?? null,
    data.run.discardG ?? null,
    data.run.endsG ?? null,
    data.run.pressRemark ?? null,
    data.run.dieRemark ?? null,
    data.run.billetShortReason ?? null,
    data.run.trialResult ?? null,
  ]);
}

export function initDraft(data: RunDetail, unit: LengthUnit): Draft {
  const savedLines = data.lines;
  const lines: LineDraft[] =
    savedLines.length > 0
      ? savedLines.map((l) => {
          const plan = data.planLines.find((p) => p.id === l.pressPlanLineId);
          return {
            key: rowKey(),
            cutLengthMm: plan ? l.cutLengthMm : null,
            cutText: plan ? "" : lengthToText(l.cutLengthMm, unit),
            pcsText: String(l.pcs),
            kgText: gToKgText(l.goodG),
            pressPlanLineId: l.pressPlanLineId ?? null,
            orderNumber: l.orderNumber ?? plan?.orderNumber ?? null,
            releasedPcs: plan?.pcs ?? null,
          };
        })
      : data.planLines.length > 0
        ? data.planLines.map((p) => ({
            key: rowKey(),
            cutLengthMm: p.cutLengthMm,
            cutText: "",
            pcsText: "",
            kgText: "",
            pressPlanLineId: p.id,
            orderNumber: p.orderNumber,
            releasedPcs: p.pcs,
          }))
        : [emptyCut()];
  return {
    base: serverBase(data),
    step: 0,
    castId: data.run.castId ?? "",
    billets:
      data.billets.length > 0
        ? data.billets.map((b) => ({ key: rowKey(), lengthText: lengthToText(b.lengthMm, unit), countText: String(b.count), kgText: gToKgText(b.kgG) }))
        : [emptyBillet()],
    lines,
    pressedLengthText: lengthToText(data.run.pressedLengthMm, unit),
    discardText: data.run.discardG ? gToKgText(data.run.discardG) : "",
    endsText: data.run.endsG ? gToKgText(data.run.endsG) : "",
    qc:
      data.qc.length > 0
        ? data.qc.map((q) => ({ key: rowKey(), pcsText: String(q.pcs), kgText: gToKgText(q.kgG), reasonCodeId: q.reasonCodeId ?? "", note: q.note ?? "", runLine: null }))
        : [emptyQc()],
    pressRemark: data.run.pressRemark ?? "",
    dieRemark: data.run.dieRemark ?? "",
    readingText: "",
    billetShortReason: data.run.billetShortReason ?? "",
    trialResult: data.run.trialResult === "pass" || data.run.trialResult === "fail" ? data.run.trialResult : "",
  };
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const storageKey = (runId: string) => `orrn.press.draft.${runId}`;

/**
 * What goes to sessionStorage: the draft with every length held as whole mm (the canonical value, like the pack draft's
 * `lengthMm`), not as text in the unit the person was typing in. The unit can change under a stored draft (the Company tab's
 * mm/inch switch, the Units tab's length choice), and "45000" typed as mm must never come back as 45000 inches. Text that
 * is not a length yet (a lone "." mid-typing) is stored as blank. `v: 2` marks this shape; a draft without it is dropped.
 */
type StoredDraft = Omit<Draft, "billets" | "lines" | "pressedLengthText"> & {
  v: 2;
  billets: (Omit<BilletDraft, "lengthText"> & { lengthMm: number | null })[];
  lines: (Omit<LineDraft, "cutText"> & { typedCutMm: number | null })[];
  pressedLengthMm: number | null;
};

const blankToNull = (text: string, unit: LengthUnit) => (text.trim() === "" ? null : textToLength(text, unit));

export function draftForStorage(draft: Draft, unit: LengthUnit): StoredDraft {
  return {
    ...draft,
    v: 2,
    billets: draft.billets.map(({ lengthText, ...b }) => ({ ...b, lengthMm: blankToNull(lengthText, unit) })),
    lines: draft.lines.map(({ cutText, ...l }) => ({ ...l, typedCutMm: blankToNull(cutText, unit) })),
    pressedLengthMm: blankToNull(draft.pressedLengthText, unit),
    pressedLengthText: undefined,
  } as StoredDraft;
}

/** A stored draft read into the unit the screen types in now; null for any other shape (an older draft is dropped, never misread). */
export function draftFromStorage(raw: unknown, unit: LengthUnit): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<StoredDraft>;
  if (d.v !== 2 || !Array.isArray(d.billets) || !Array.isArray(d.lines) || !Array.isArray(d.qc)) return null;
  const mmOk = (n: unknown): n is number | null => n === null || (typeof n === "number" && Number.isFinite(n));
  if (!d.billets.every((b) => b && mmOk(b.lengthMm)) || !d.lines.every((l) => l && mmOk(l.typedCutMm)) || !mmOk(d.pressedLengthMm)) return null;
  const { v: _v, billets, lines, pressedLengthMm, ...rest } = d as StoredDraft;
  return {
    ...rest,
    billets: billets.map(({ lengthMm, ...b }) => ({ ...b, lengthText: lengthToText(lengthMm, unit) })),
    lines: lines.map(({ typedCutMm, ...l }) => ({ ...l, cutText: lengthToText(typedCutMm, unit) })),
    pressedLengthText: lengthToText(pressedLengthMm, unit),
  };
}

/** The draft in memory when the plant's length unit changes under it: every typed length is re-written in the new unit. */
export function convertDraftUnit(draft: Draft, from: LengthUnit, to: LengthUnit): Draft {
  if (from === to) return draft;
  const text = (t: string) => lengthToText(blankToNull(t, from), to);
  return {
    ...draft,
    billets: draft.billets.map((b) => ({ ...b, lengthText: text(b.lengthText) })),
    lines: draft.lines.map((l) => ({ ...l, cutText: text(l.cutText) })),
    pressedLengthText: text(draft.pressedLengthText),
  };
}

function readStored(runId: string, unit: LengthUnit): Draft | null {
  try {
    const raw = store()?.getItem(storageKey(runId));
    return raw ? draftFromStorage(JSON.parse(raw), unit) : null;
  } catch {
    return null;
  }
}

export function clearDraft(runId: string) {
  try {
    store()?.removeItem(storageKey(runId));
  } catch {
    // storage unavailable: nothing to clear
  }
}

/**
 * The draft a screen starts with: the stored one when it began against the rows the server holds
 * now, otherwise the server's rows (`stale` says a stored draft was set aside). The step the person
 * was on is kept either way.
 */
export function chooseDraft(stored: Draft | null, data: RunDetail, unit: LengthUnit): { draft: Draft; stale: boolean } {
  if (!stored) return { draft: initDraft(data, unit), stale: false };
  if (stored.base === serverBase(data)) return { draft: stored, stale: false };
  return { draft: { ...initDraft(data, unit), step: stored.step }, stale: true };
}

/**
 * The draft of one counting run. Started once (from storage, else from the server's rows) and never
 * re-seeded by a refetch, so typing is not overwritten by a poll or a failed save.
 */
export function useCountDraft(runId: string, data: RunDetail, unit: LengthUnit) {
  const [start] = useState(() => chooseDraft(readStored(runId, unit), data, unit));
  const [draft, setDraft] = useState<Draft>(start.draft);
  // The plant's length unit can change while the screen is open (`me` refetches): the typed lengths follow it, so "45000" mm
  // does not become 45000 inches. State is adjusted while rendering, before anything reads the old text in the new unit.
  const [textUnit, setTextUnit] = useState(unit);
  if (unit !== textUnit) {
    setDraft((d) => convertDraftUnit(d, textUnit, unit));
    setTextUnit(unit);
  }
  const [stale, setStale] = useState(start.stale);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      store()?.setItem(storageKey(runId), JSON.stringify(draftForStorage(draft, textUnit)));
    } catch {
      // storage full or blocked: the draft still lives in state
    }
  }, [draft, runId, textUnit]);
  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);
  return { draft, setDraft, patch, stale, dismissStale: () => setStale(false) };
}
