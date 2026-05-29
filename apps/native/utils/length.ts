import type { LengthUnit } from "@orrn/api/lib/length";
import { formatLength, formatLengthValue, parseLength, parseLengthDecimal, lengthUnitLabel } from "@orrn/api/lib/length";
import { useMemo } from "react";

import { useMe } from "./me";

export type LengthUnitInfo = {
  unit: LengthUnit;
  formatLength: (mm: number) => string;
  formatLengthValue: (mm: number) => string;
  parseLength: (value: string) => number;
  parseLengthDecimal: (value: string) => number;
  label: string;
};

export function useLengthUnit(): LengthUnitInfo {
  const me = useMe();
  const unit: LengthUnit = (me.data?.company?.settings?.lengthUnit as LengthUnit) ?? "mm";

  return useMemo(
    () => ({
      unit,
      formatLength: (mm: number) => formatLength(mm, unit),
      formatLengthValue: (mm: number) => formatLengthValue(mm, unit),
      parseLength: (value: string) => parseLength(value, unit),
      parseLengthDecimal: (value: string) => parseLengthDecimal(value, unit),
      label: lengthUnitLabel(unit),
    }),
    [unit],
  );
}
