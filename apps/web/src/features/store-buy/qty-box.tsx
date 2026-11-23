import { NumberInput, type NumberInputProps } from "@orrn/ui/components/field";
import type { Ref } from "react";

import { PlantInput } from "@/shared/components/plant-input";
import { MASS_KG } from "@/shared/lib/plant-input";

import type { StoreUnit } from "@/features/store/store-qty";

/**
 * A store quantity box in the item's own unit, for the buying screens (indent and order lines, reorder
 * levels). A kilogram item takes the plant's weight unit (the draft stays kg text, as on the store's own
 * form); litre, piece, metre, set, box and bag are their own words and stay as they are. Parse the draft
 * with `parseQtyMilli(draft, unit)`.
 */
export function StoreQtyBox({ unit, suffix, ...props }: NumberInputProps & { unit: StoreUnit | null; ref?: Ref<HTMLInputElement> }) {
  if (unit === "kg") return <PlantInput spec={MASS_KG} {...props} />;
  return <NumberInput {...props} suffix={suffix} />;
}
