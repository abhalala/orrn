import type { ReactNode } from "react";

/**
 * The scanner's answer chip: a glyph and a word, so colour is never the only
 * signal. "ok" is the app's Added, "no" its Not added. The glyph is drawing
 * only; the word carries the meaning for a screen reader.
 */
export function StatusChip({ state, children }: { state: "ok" | "no"; children: ReactNode }) {
  return (
    <span className="marketing-chip" data-state={state}>
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        {state === "ok" ? <path d="M2.5 6.5l2.2 2.2L9.5 3.5" /> : <path d="M3 3l6 6M9 3l-6 6" />}
      </svg>
      {children}
    </span>
  );
}
