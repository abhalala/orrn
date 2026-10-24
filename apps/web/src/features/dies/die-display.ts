/** Display helpers shared by the dies list and a die's page. */
import type { LengthUnit } from "@orrn/domain";
import type { Translate } from "@orrn/i18n";

import { geometryText, kgText } from "./die-model";

/** "PATTI 14701": how the floor names a die. */
export function dieCode(d: { series: string; sectionCode: string }): string {
  return `${d.series} ${d.sectionCode}`;
}

/** "2.4-2.6" (the list's range column, kg/12ft in the header). */
export function rangeText(t: Translate, d: { weightMinG: number; weightMaxG: number }): string {
  return t("dies.rangeValue", { min: kgText(d.weightMinG), max: kgText(d.weightMaxG) });
}

/**
 * A die measurement for reading: "3.2 mm", or for inch companies the decimal inches the die
 * room writes ("0.125 in"). Bundle lengths use feet and inches; die sections are small, so
 * decimal inches read better here.
 */
export function measurementText(mm: number, unit: LengthUnit, units: { mm: string; inch: string }): string {
  if (unit === "mm") return `${geometryText(mm, "mm")} ${units.mm}`;
  return `${geometryText(mm, "inch")} ${units.inch}`;
}
