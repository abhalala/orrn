/** Excel Scan-and-PL N2: ROUND to 1 decimal, then pull back 0.1 if rounded up by > 0.01. */
export function formatWeightRange12ft(kgPer12ft: number): string {
  if (!Number.isFinite(kgPer12ft)) return "";
  const rounded = Math.round(kgPer12ft * 10) / 10;
  const slab = rounded - kgPer12ft > 0.01 ? rounded - 0.1 : rounded;
  return slab.toFixed(3);
}

export function kgPer12ft(weightG: number, quantity: number, lengthMm: number): number | null {
  const weightKg = weightG / 1000;
  const lengthIn = lengthMm / 25.4;
  if (!(quantity > 0 && lengthIn > 0)) return null;
  return (weightKg / quantity / lengthIn) * 12;
}

export function mmToFeet(mm: number): number {
  return mm / 304.8;
}
