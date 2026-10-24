import { useSyncExternalStore } from "react";

import {
  BOOK_DATE,
  BOOKED_NUMBERS,
  CAST_YEAR,
  isMonthLetterNumber,
  nextCastNumber,
  SERIES_START_SEQ,
  type AlloyCode,
  type OpenedCast,
} from "./fixtures";

export type FoundryPreviewState = {
  k31Locked: boolean;
  k31LockedAt: number | null;
  drossZeroed: boolean;
  balanceReason: string;
  nextSeq: number;
  openedCasts: OpenedCast[];
};

const listeners = new Set<() => void>();

let state: FoundryPreviewState = {
  k31Locked: false,
  k31LockedAt: null,
  drossZeroed: false,
  balanceReason: "",
  nextSeq: SERIES_START_SEQ,
  openedCasts: [],
};

function emit(): void {
  for (const listener of listeners) listener();
}

function update(patch: Partial<FoundryPreviewState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getFoundryPreviewState(): FoundryPreviewState {
  return state;
}

export function subscribeFoundryPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFoundryPreview(): FoundryPreviewState {
  return useSyncExternalStore(subscribeFoundryPreview, getFoundryPreviewState, getFoundryPreviewState);
}

export function setDrossZeroed(on: boolean): void {
  if (state.k31Locked) return;
  update({ drossZeroed: on, balanceReason: on ? state.balanceReason : "" });
}

export function setBalanceReason(text: string): void {
  update({ balanceReason: text.slice(0, 500) });
}

export function lockK31(canLock: boolean): "locked" | "already" | "blocked" {
  if (state.k31Locked) return "already";
  if (!canLock) return "blocked";
  update({ k31Locked: true, k31LockedAt: Date.now() });
  return "locked";
}

export type OpenCastResult = { ok: true; number: string } | { ok: false; error: string };

export function openCast(input: { alloy: AlloyCode; manual: string }): OpenCastResult {
  const manual = input.manual.trim().toUpperCase();
  const seriesNumber = nextCastNumber(state.nextSeq);
  if (manual && isMonthLetterNumber(manual)) {
    return {
      ok: false,
      error: `${manual} is a month-letter number. Accept ${seriesNumber}, or type a legacy code that is not a month-letter number.`,
    };
  }
  const number = manual || seriesNumber;
  const taken = new Set<string>([...BOOKED_NUMBERS, ...state.openedCasts.map((cast) => cast.number)]);
  if (taken.has(number)) {
    return { ok: false, error: `${number} is already a cast in ${CAST_YEAR}.` };
  }
  const opened: OpenedCast = {
    id: `opened-${number}`,
    number,
    numberSource: manual ? "manual" : "series",
    openedOn: BOOK_DATE,
    alloy: input.alloy,
    year: CAST_YEAR,
  };
  update({
    openedCasts: [...state.openedCasts, opened],
    nextSeq: manual ? state.nextSeq : state.nextSeq + 1,
  });
  return { ok: true, number };
}
