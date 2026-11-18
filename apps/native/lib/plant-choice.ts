/**
 * "Choose a plant" on the phone (plan 2026-11-18, Task 9; owner amendment items 4 and 6). A sign-in
 * (password, code, invite) of a person in more than one plant opens the picker before the app; a cold
 * start with a stored session is not a sign-in and opens the app as before. This tiny external store
 * says whether a pick is still owed since the last sign-in: `afterSignIn` sets it, a pick or a
 * sign-out clears it, and "Choose another plant" (the finish-on-the-web screen) sets it again. Kept in
 * memory: a restart is not a sign-in. No React Native imports, so bun tests it.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let pending = false;

export const plantChoice = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): boolean {
    return pending;
  },
  set(next: boolean): void {
    if (pending === next) return;
    pending = next;
    for (const listener of listeners) listener();
  },
};
