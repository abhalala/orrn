import { useSyncExternalStore } from "react";

import type { PreviewLocale } from "./fixtures";

/**
 * Switches the settings screen flips and the other preview screens read.
 * Module memory only — not `orrn.locale`, not localStorage, not the plant.
 */
export type PlatformPreviewState = {
  locale: PreviewLocale;
  dieBands: boolean;
  priceOnSalesOrder: boolean;
  dieRequiredOnSalesOrder: boolean;
  hiddenDieProbe: boolean;
};

const initial: PlatformPreviewState = {
  locale: "en",
  dieBands: true,
  priceOnSalesOrder: false,
  dieRequiredOnSalesOrder: true,
  hiddenDieProbe: false,
};

let state: PlatformPreviewState = initial;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getPlatformPreviewState(): PlatformPreviewState {
  return state;
}

export function updatePlatformPreviewState(patch: Partial<PlatformPreviewState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlatformPreviewState(): PlatformPreviewState {
  return useSyncExternalStore(subscribe, getPlatformPreviewState, getPlatformPreviewState);
}
