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

function readStored(runId: string): Draft | null {
  try {
    const raw = store()?.getItem(storageKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    return Array.isArray(parsed.billets) && Array.isArray(parsed.lines) && Array.isArray(parsed.qc) ? parsed : null;
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
 * The draft of one counting run. Started once (from storage, else from the server's rows) and never
 * re-seeded by a refetch, so typing is not overwritten by a poll or a failed save.
 */
export function useCountDraft(runId: string, data: RunDetail, unit: LengthUnit) {
  const [draft, setDraft] = useState<Draft>(() => readStored(runId) ?? initDraft(data, unit));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      store()?.setItem(storageKey(runId), JSON.stringify(draft));
    } catch {
      // storage full or blocked: the draft still lives in state
    }
  }, [draft, runId]);
  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);
  return { draft, setDraft, patch };
}
