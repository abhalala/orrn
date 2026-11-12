import { convertText, type Fmt, type LengthUnit } from "@orrn/domain";
import { useMemo } from "react";

import { useFmt } from "./fmt";

/**
 * Length for the screens that already call `useLengthUnit()`. It is a thin skin over the plant's `Fmt` now, so a
 * plant on feet and inches reads "11 ft 6 in" everywhere (the old server helper printed "138.00 in" on these
 * screens, the domain helper "11 ft 6 in" on others: two helpers, one name), and a plant on metres reads "3.658 m".
 * `unit` stays the legacy pair ("mm" or "inch") that the entry forms branch on: feet and inches get the two-box form,
 * everything else the single box.
 */
export type LengthUnitInfo = {
  unit: LengthUnit;
  formatLength: (mm: number) => string;
  formatLengthValue: (mm: number) => string;
  /** Whole mm from text typed in the plant's unit ("144" is inches on an inch plant, metres on a metre plant). 0 when it is not a number. */
  parseLength: (value: string) => number;
  /** The same to one decimal of a mm. */
  parseLengthDecimal: (value: string) => number;
  label: string;
};

const TENTH_MM = { kind: "length", storage: "tenth_mm" } as const;
const WHOLE_MM = { kind: "length", storage: "mm" } as const;

/** Typed text in the plant's length unit to storage, exact, half away from zero. 0 for text that is not a plain number. */
function readLength(fmt: Fmt, target: typeof TENTH_MM | typeof WHOLE_MM, value: string): number {
  const unit = fmt.unitOf("length");
  const r = convertText(target, value, unit.composite ? "in" : unit.id, { mode: "round", style: fmt.style });
  return r.ok ? r.value : 0;
}

export function lengthUnitInfo(fmt: Fmt): LengthUnitInfo {
  const unit = fmt.unitOf("length");
  return {
    unit: unit.composite ? "inch" : "mm",
    formatLength: (mm) => fmt.q("bundle.length", mm),
    formatLengthValue: (mm) => fmt.n("bundle.length", mm),
    parseLength: (value) => readLength(fmt, WHOLE_MM, value),
    parseLengthDecimal: (value) => readLength(fmt, TENTH_MM, value) / 10,
    label: unit.composite ? "in" : unit.symbol,
  };
}

export function useLengthUnit(): LengthUnitInfo {
  const fmt = useFmt();
  return useMemo(() => lengthUnitInfo(fmt), [fmt]);
}
