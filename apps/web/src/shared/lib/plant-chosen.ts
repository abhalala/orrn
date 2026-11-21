/**
 * "A plant was picked since this sign-in" (plan 2026-11-18, Task 9). Kept in `sessionStorage` under
 * `orrn.plantChosen`: one tab, one sign-in. Every sign-in clears it (`useFinishSignIn`) and so does
 * every sign-out (`sign-out-core.ts`), so a person in several plants lands on "Choose a plant" after
 * each sign-in. Blocked storage (private mode) reads as nothing picked and never throws.
 */
export const PLANT_CHOSEN_KEY = "orrn.plantChosen";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPlantChosen(storage: Store | null = sessionStore()): boolean {
  try {
    return storage?.getItem(PLANT_CHOSEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPlantChosen(storage: Store | null = sessionStore()): void {
  try {
    storage?.setItem(PLANT_CHOSEN_KEY, "1");
  } catch {
    // Blocked storage: the picker comes back on the next home redirect, nothing worse.
  }
}

export function clearPlantChosen(storage: Store | null = sessionStore()): void {
  try {
    storage?.removeItem(PLANT_CHOSEN_KEY);
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
