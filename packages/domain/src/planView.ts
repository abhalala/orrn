/**
 * FP-OP-21 (W4-NEXTROWS): the press plan on the owner's phone, read-only. Per plan die: the cut
 * lengths with planned vs pressed pieces and kg, and one run-state chip. Pressed figures come only
 * from LOGGED runs (a running or counting run has no count yet); a voided run is ignored. Pure, so
 * the arithmetic is tested; the server reads the rows and calls this.
 */
import type { PressRunStatus } from "./pressRun";

export type PlanDieState = Exclude<PressRunStatus, "voided"> | "not_started";

export type PlanViewLength = {
  cutLengthMm: number;
  plannedPcs: number;
  plannedG: number;
  pressedPcs: number;
  pressedG: number;
};

export type PlanDieView = {
  lengths: PlanViewLength[];
  plannedPcs: number;
  plannedG: number;
  pressedPcs: number;
  pressedG: number;
  /** Pressed kg against planned kg, basis points (0 with nothing planned). May pass 10000. */
  pressedBp: number;
  state: PlanDieState;
};

export function planDieView(input: {
  planLines: readonly { cutLengthMm: number; pcs: number | null; kgG: number }[];
  /** The die's runs, any order; `createdAt` epoch ms picks the latest. */
  runs: readonly { id: string; status: PressRunStatus; createdAt: number }[];
  /** Counted lines of those runs. */
  runLines: readonly { pressRunId: string; cutLengthMm: number; pcs: number; goodG: number }[];
}): PlanDieView {
  const byLength = new Map<number, PlanViewLength>();
  const at = (mm: number) => {
    let row = byLength.get(mm);
    if (!row) {
      row = { cutLengthMm: mm, plannedPcs: 0, plannedG: 0, pressedPcs: 0, pressedG: 0 };
      byLength.set(mm, row);
    }
    return row;
  };
  for (const l of input.planLines) {
    const row = at(l.cutLengthMm);
    row.plannedPcs += l.pcs ?? 0;
    row.plannedG += l.kgG;
  }
  const logged = new Set(input.runs.filter((r) => r.status === "logged").map((r) => r.id));
  for (const l of input.runLines) {
    if (!logged.has(l.pressRunId)) continue;
    const row = at(l.cutLengthMm);
    row.pressedPcs += l.pcs;
    row.pressedG += l.goodG;
  }
  const lengths = [...byLength.values()].sort((a, b) => a.cutLengthMm - b.cutLengthMm);
  const sum = (k: keyof Omit<PlanViewLength, "cutLengthMm">) => lengths.reduce((s, r) => s + r[k], 0);
  const plannedG = sum("plannedG");
  const pressedG = sum("pressedG");
  const live = input.runs.filter((r) => r.status !== "voided").sort((a, b) => b.createdAt - a.createdAt)[0];
  return {
    lengths,
    plannedPcs: sum("plannedPcs"),
    plannedG,
    pressedPcs: sum("pressedPcs"),
    pressedG,
    pressedBp: plannedG > 0 ? Math.round((pressedG * 10_000) / plannedG) : 0,
    state: live ? (live.status as Exclude<PressRunStatus, "voided">) : "not_started",
  };
}
