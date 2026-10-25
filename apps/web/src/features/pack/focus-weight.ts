/**
 * BACKLOG 64 / final explore L1: landing on the weight field. A plain `focus()` restores the
 * field's old selection, which for a value React wrote is the caret at 0: keystrokes that arrive in
 * the same frame land IN FRONT of the weight ("21" + "50.1" = 2,150.1 kg). So the field is focused
 * with its whole text selected (typing replaces it, an empty field just takes the caret), and a
 * deferred focus never pulls the caret back once the person has moved to another field.
 */
export type FocusableField = {
  focus(opts?: { preventScroll?: boolean }): void;
  setSelectionRange(start: number, end: number): void;
  value: string;
};

/** Focus without the browser's own scroll, the whole value selected. */
export function focusSelected(el: FocusableField | null | undefined): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  try {
    el.setSelectionRange(0, el.value.length);
  } catch {
    // type=number and friends refuse selection ranges; the weight field is text (inputMode decimal).
  }
  return true;
}

/**
 * A focus deferred to the next frame still applies only while focus is where it was when it was
 * asked for (or nowhere): a field the person tapped or a test filled in between keeps it.
 */
export function stillMayFocus(before: unknown, now: unknown, body: unknown): boolean {
  return now === before || now === body || now === null;
}
