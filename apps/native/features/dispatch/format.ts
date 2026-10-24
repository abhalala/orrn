import { formatKg, formatKgTotal, gToKg } from "@orrn/domain";

/** "1,234.5": a dispatch or group total in kg, one decimal. */
export const kgTotal = (weightG: number): string => formatKgTotal(gToKg(weightG));

/** "52.00": one bundle's kg, two decimals. */
export const kgBundle = (weightG: number): string => formatKg(gToKg(weightG));
