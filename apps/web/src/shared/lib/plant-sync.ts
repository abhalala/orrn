import { useSyncExternalStore } from "react";

/**
 * Which plant the screens must wait for (units layer, plant switch).
 *
 * After a person switches plant the server already answers for the new plant, but the cached `auth.me` (or the
 * portal's `me`) still carries the old plant's units until it is read again. A weight read or typed in that gap
 * would be shown or stored under the wrong unit. The switch calls `expectPlant(newId)` first; the signed-in
 * frame renders its content only when the units in hand belong to that plant (`unitsBelongTo`), and the frame
 * clears the expectation once they do. Nothing is expected the rest of the time, and then any units in hand are
 * used as before.
 */
let expected: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function expectPlant(companyId: string): void {
  if (expected === companyId) return;
  expected = companyId;
  emit();
}

export function clearExpectedPlant(): void {
  if (expected === null) return;
  expected = null;
  emit();
}

export function expectedPlant(): string | null {
  return expected;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The plant the screens wait for, or null. */
export function useExpectedPlant(): string | null {
  return useSyncExternalStore(subscribe, expectedPlant, expectedPlant);
}

/** True when nothing is awaited, or the units in hand are the awaited plant's. */
export function unitsBelongTo(expectedId: string | null, heldId: string | null | undefined): boolean {
  return expectedId === null || heldId === expectedId;
}
