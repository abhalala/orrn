import { formatWeightRange12ft, kgPer12ft } from "./weight-range";

export type PackingGroupKey = "manual" | "die" | "weightRange";

export function packingGroupKeyFromSettings(settings: unknown): PackingGroupKey {
  const key = (settings as { packingGroupKey?: unknown } | null)?.packingGroupKey;
  return key === "die" || key === "weightRange" ? key : "manual";
}

export function cap80(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 79)}…`;
}

export function defaultGroupLabel(
  dieRow: { sectionCode: string; name?: string | null },
  bundleRow: { weightG: number; quantity: number; lengthMm: number },
  key: PackingGroupKey,
): string | null {
  if (key === "manual") return null;
  if (key === "weightRange") {
    const value = kgPer12ft(bundleRow.weightG, bundleRow.quantity, bundleRow.lengthMm);
    return cap80(formatWeightRange12ft(value ?? Number.NaN));
  }
  const name = (dieRow.name ?? "").replace(/\s+/g, " ").trim();
  return cap80(`${dieRow.sectionCode} ${name}`.trim());
}
