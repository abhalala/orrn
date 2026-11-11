import type { Fmt } from "@orrn/domain";
import type { Translate } from "@orrn/i18n";

import { sectionUnit } from "@/shared/lib/fmt-text";
import { followsPlant, SECTION_KG12 } from "@/shared/lib/plant-input";

/**
 * The words that ask for a die reading. A plant on kg per 12 ft keeps "Weight of 12 ft" (the paper's words). A plant on kg per
 * metre or lb per foot types a section weight in its own unit, so the label must not ask for the weight of 12 ft: a person who
 * weighs 12 ft and types 21.6 into a kg/m box stores a reading 3.66 times too heavy.
 */
export function readingWeightLabel(t: Translate, fmt: Fmt): string {
  return followsPlant(fmt, SECTION_KG12) ? t("dieRoom.reading.weight") : t("dieRoom.reading.weightPlant", { sectionUnit: sectionUnit(fmt) });
}

/** The empty-state sentence of the readings tab, in the same terms as the box. */
export function readingEmptyBody(t: Translate, fmt: Fmt): string {
  return followsPlant(fmt, SECTION_KG12) ? t("dieRoom.reading.emptyBody") : t("dieRoom.reading.emptyBodyPlant", { sectionUnit: sectionUnit(fmt) });
}
