import type { ReactNode } from "react";

/**
 * The two boxes of the older feet and inches entry (a feet box and an inches box side by side) as one named group,
 * so a screen reader hears "Cut length, group" before "Feet" and "Inches". The single-box entry (`PlantInput`) does
 * not need it. Each box keeps its own `aria-label`.
 */
export function FeetInchesGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-2">
      {children}
    </div>
  );
}
