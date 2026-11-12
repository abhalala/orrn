import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeping the person's place (M13, WCAG 2.4.3) and telling a screen reader once (work order section 6).
 * The pure functions say where focus goes and what is announced; the hooks hold the element refs and the message.
 */

/** The neighbour to focus when `id` leaves the list: the one after it, else the one before it, else null. */
export function nextFocus(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id);
  if (at < 0) return ids[0] ?? null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

/**
 * After a decision on a row of the rows panel: the same row's first control while the row is still in the view, else
 * the next row's, else null (the panel's filter button). `stillListed` is whether the row is in the view after the
 * decision (for "Needs a decision" it has left).
 */
export function focusAfterRowDecision(ids: readonly string[], decidedId: string, stillListed: boolean): string | null {
  return stillListed ? decidedId : nextFocus(ids, decidedId);
}

/** The key under which a row's first control registers with `useFocusReturn`. */
export const rowFocusKey = (rowId: string) => `row:${rowId}`;
/** The key of a list row's action button. */
export const actionFocusKey = (candidateId: string) => `action:${candidateId}`;
/** The key of the merge button in the sticky bar: where focus goes when no row is left. */
export const MERGE_BAR_FOCUS = "merge-bar";

/**
 * After Approve, Hold or Discard on a list row: the next row's action, or the merge bar's button when none is left.
 * `visible` is the ids of the rows in the segment in order.
 */
export function focusAfterListAction(visible: readonly string[], actedId: string): string {
  const next = nextFocus(visible, actedId);
  return next === null || next === actedId ? MERGE_BAR_FOCUS : actionFocusKey(next);
}

/**
 * Registers elements by key and focuses the first of several candidate keys that is mounted, after the next paint.
 * Use `ref(key)` on the element, and `request([...keys])` once the action has finished and the list was refreshed.
 */
export function useFocusReturn(): {
  ref: (key: string) => (el: HTMLElement | null) => void;
  request: (keys: readonly string[]) => void;
  focus: (key: string) => boolean;
} {
  const els = useRef(new Map<string, HTMLElement>());
  const [want, setWant] = useState<{ keys: readonly string[]; n: number } | null>(null);
  const counter = useRef(0);
  const ref = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    [],
  );
  const focus = useCallback((key: string) => {
    const el = els.current.get(key);
    if (!el) return false;
    el.focus();
    return true;
  }, []);
  const request = useCallback((keys: readonly string[]) => {
    counter.current += 1;
    setWant({ keys, n: counter.current });
  }, []);
  useEffect(() => {
    if (!want) return;
    const frame = requestAnimationFrame(() => {
      const hit = want.keys.find((k) => els.current.has(k));
      if (hit) {
        els.current.get(hit)!.focus();
        setWant(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [want]);
  return { ref, request, focus };
}

/** Which of 0, 25, 50, 75 and 100 percent a long read has just reached, or null. Announces once per step, never per row. */
export function progressStep(previous: number | null, next: number | null): 0 | 25 | 50 | 75 | 100 | null {
  if (next === null) return null;
  const steps = [0, 25, 50, 75, 100] as const;
  const at = (p: number | null) => (p === null ? -1 : steps.reduce((acc, s, i) => (p >= s ? i : acc), -1));
  const to = at(Math.round(next * 100));
  if (to < 0 || to <= at(previous === null ? null : Math.round(previous * 100))) return null;
  return steps[to]!;
}

/**
 * The one polite status region of a screen. Mount `<p role="status" aria-live="polite" className="sr-only">{message}</p>`
 * always, empty at first. `announce(text)` fills it; the same text twice still reads twice (a trailing space flips).
 */
export function useAnnouncer(): { message: string; announce: (text: string) => void; clear: () => void } {
  const [state, setState] = useState({ text: "", flip: false });
  const announce = useCallback((text: string) => setState((s) => ({ text, flip: s.text === text ? !s.flip : false })), []);
  const clear = useCallback(() => setState({ text: "", flip: false }), []);
  return { message: state.flip ? `${state.text} ` : state.text, announce, clear };
}
