import { useSyncExternalStore } from "react";

import {
  WINDOW_MIN,
  evaluateLog,
  feetToMm,
  freshPressDemo,
  type BilletDraft,
  type CutDraft,
  type PressDemoState,
  type ShiftId,
  type Viewer,
} from "./fixtures";

type Listener = () => void;

let state: PressDemoState = freshPressDemo();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function update(recipe: (current: PressDemoState) => PressDemoState): void {
  state = recipe(state);
  emit();
}

function patch42(recipe: (current: PressDemoState["pr42"]) => PressDemoState["pr42"]): void {
  update((current) => ({ ...current, pr42: recipe(current.pr42) }));
}

export function getPressDemo(): PressDemoState {
  return state;
}

export function subscribePressDemo(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePressDemo(): PressDemoState {
  return useSyncExternalStore(subscribePressDemo, getPressDemo, getPressDemo);
}

export function setNothingReleased(on: boolean): void {
  update((current) => ({ ...current, nothingReleased: on }));
}

export function setSecondReportRow(on: boolean): void {
  update((current) => ({ ...current, showSecondReportRow: on }));
}

export function setViewer(viewer: Viewer): void {
  update((current) => ({ ...current, viewer }));
}

export function setPr43Shift(shift: ShiftId): void {
  update((current) => ({ ...current, pr43Shift: shift }));
}

export function resetPressDemo(): void {
  state = freshPressDemo();
  emit();
}

export function showRunning(): void {
  patch42((run) => {
    if (run.phase === "logged") return run;
    return { ...run, phase: "running", runningSinceWall: Date.now() };
  });
}

export function stopPreview(): void {
  patch42((run) => {
    if (run.phase === "logged") return run;
    return { ...run, phase: "stopped", runningSinceWall: null };
  });
}

export function showCounting(): void {
  patch42((run) => {
    if (run.phase === "logged") return run;
    return { ...run, phase: "counting", runningSinceWall: null };
  });
}

export function setStep(step: number): void {
  patch42((run) => ({ ...run, step }));
}

export function setCast(castCode: string): void {
  patch42((run) => ({ ...run, castCode }));
}

export function updateBillet(id: string, patch: Partial<Pick<BilletDraft, "countText" | "kgText" | "lengthMm">>): void {
  patch42((run) => ({
    ...run,
    billets: run.billets.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  }));
}

export function addBillet(): void {
  patch42((run) => {
    if (run.billets.length >= 10) return run;
    const next: BilletDraft = {
      id: `b${run.billets.length + 1}-${Date.now()}`,
      lengthMm: feetToMm(22),
      countText: "1",
      kgText: "",
    };
    return { ...run, billets: [...run.billets, next] };
  });
}

export function removeBillet(id: string): void {
  patch42((run) => {
    if (run.billets.length <= 1) return run;
    return { ...run, billets: run.billets.filter((row) => row.id !== id) };
  });
}

export function updateCut(id: string, patch: Partial<Pick<CutDraft, "pcsText" | "kgText">>): void {
  patch42((run) => ({
    ...run,
    cuts: run.cuts.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  }));
}

export function setButt(text: string): void {
  patch42((run) => ({ ...run, buttText: text }));
}

export function setEnds(text: string): void {
  patch42((run) => ({ ...run, endsText: text }));
}

export function setReject(text: string): void {
  patch42((run) => ({ ...run, rejectText: text }));
}

export function setRejectReason(reason: string): void {
  patch42((run) => ({ ...run, rejectReason: reason }));
}

export function setRejectNote(note: string): void {
  patch42((run) => ({ ...run, rejectNote: note }));
}

export function setPressRemark(text: string): void {
  patch42((run) => ({ ...run, pressRemark: text }));
}

export function setDieRemark(text: string): void {
  patch42((run) => ({ ...run, dieRemark: text }));
}

export function setDrift(text: string): void {
  patch42((run) => ({ ...run, driftText: text }));
}

export function setPressedLength(text: string): void {
  patch42((run) => ({ ...run, pressedLengthText: text }));
}

export function setBilletShortReason(text: string): void {
  patch42((run) => ({ ...run, billetShortReason: text }));
}

export function setPostedInput(text: string): void {
  patch42((run) => ({ ...run, postedInputText: text }));
}

export function handover(name: string): void {
  patch42((run) => ({ ...run, relief: name }));
}

export function startDowntime(reason: string, note: string): string | null {
  if (reason === "") return "A stoppage needs a reason.";
  if (reason === "other" && note.trim() === "") return "Other needs a note.";
  let error: string | null = null;
  patch42((run) => {
    if (run.downtime.some((row) => row.open)) {
      error = "A stoppage is already open.";
      return run;
    }
    const used = run.downtime.reduce((sum, row) => sum + row.minutes, 0);
    if (used >= WINDOW_MIN) {
      error = "That stoppage does not fit between 09:12 and 11:04.";
      return run;
    }
    return {
      ...run,
      downtime: [
        ...run.downtime,
        { id: `dt-${Date.now()}`, reason, note: note.trim(), minutes: 0, open: true },
      ],
    };
  });
  return error;
}

export function stopDowntime(minutes: number): string | null {
  const add = Math.max(1, Math.round(minutes));
  let error: string | null = null;
  patch42((run) => {
    const open = run.downtime.find((row) => row.open);
    if (!open) {
      error = "No stoppage is open.";
      return run;
    }
    const used = run.downtime.reduce((sum, row) => (row.open ? sum : sum + row.minutes), 0);
    if (used + add > WINDOW_MIN) {
      error = "That stoppage runs past the stop. Overlaps are rejected.";
      return run;
    }
    return {
      ...run,
      downtime: run.downtime.map((row) => (row.open ? { ...row, open: false, minutes: add } : row)),
    };
  });
  return error;
}

export function logRun(): string | null {
  const evaluation = evaluateLog(state.pr42, state.viewer);
  if (!evaluation.canLog || !evaluation.snapshot) {
    return evaluation.messages[0] ?? "This run cannot log.";
  }
  patch42((run) => ({
    ...run,
    phase: "logged",
    runningSinceWall: null,
    logged: evaluation.snapshot,
    reopen: "none",
  }));
  return null;
}

export function requestReopen(note: string): string | null {
  if (note.trim().length < 1) return "A reopen needs a note.";
  if (state.pr42.phase !== "logged") return "Only a logged run can be reopened.";
  patch42((run) => ({ ...run, reopen: "requested", reopenNote: note.trim() }));
  return null;
}

export function decideReopen(asOwner: boolean): string | null {
  if (state.pr42.reopen !== "requested") return "There is no reopen request.";
  if (!asOwner) return "You cannot approve your own request.";
  patch42((run) => ({
    ...run,
    phase: "counting",
    logged: null,
    reopen: "approved",
    step: 4,
  }));
  return null;
}

