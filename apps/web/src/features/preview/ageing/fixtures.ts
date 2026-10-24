import { formatKg, formatLength, gToKg, kgPer12ft, MM_PER_FOOT } from "@orrn/domain";

/** Fixed demo clock: 09:10 IST, 24 Oct 2026. Soak on AG-40 is measured against this, not a live timer. */
export const DEMO_CLOCK = "2026-10-24T09:10:00+05:30";

export const BOARD_FEATURES = ["FP-AG-01", "FP-AG-02", "FP-AG-05", "FP-AG-11"] as const;
export const BATCH_FEATURES = [
  "FP-AG-04",
  "FP-AG-05",
  "FP-AG-06",
  "FP-AG-07",
  "FP-AG-08",
  "FP-AG-09",
  "FP-AG-11",
  "FP-AG-12",
] as const;
export const REPORT_FEATURES = ["FP-AG-10", "FP-AG-13", "FP-AG-15"] as const;

export type ShiftId = "day" | "night";
export type BoardChip = "in_oven" | "out" | "released" | "held";
export type BatchStatus = "loading" | "in_oven" | "out" | "released" | "held" | "closed" | "void";
export type RowStatus = "pending" | "held" | "released" | "closed" | "void";
export type SectionId = "domal-12170" | "tee-13090";

export type Shift = {
  id: ShiftId;
  name: string;
  seq: number;
  startMin: number;
  endMin: number;
};

export const SHIFTS: readonly Shift[] = [
  { id: "day", name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 },
  { id: "night", name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 },
];

export type Oven = {
  id: string;
  code: string;
  name: string;
  capacityG: number;
  status: "active" | "out_of_service";
};

export const OVENS: readonly Oven[] = [
  { id: "ov-1", code: "OV-1", name: "Ageing oven 1", capacityG: 2_000_000, status: "active" },
  { id: "ov-2", code: "OV-2", name: "Ageing oven 2", capacityG: 1_500_000, status: "active" },
];

export type Trolley = {
  id: string;
  code: string;
  status: "active" | "out_of_service";
};

export const TROLLEYS: readonly Trolley[] = [
  { id: "t-1", code: "T-1", status: "active" },
  { id: "t-2", code: "T-2", status: "active" },
  { id: "t-3", code: "T-3", status: "active" },
];

export type RecipeSnapshot = {
  id: string;
  alloy: string;
  temper: string;
  kind: "full" | "top_up";
  targetTempX10: number;
  toleranceX10: number;
  soakMin: number;
  hardnessMethod: "webster" | "hb";
  hardnessMinX10: number;
  hardnessMaxX10: number;
  sampleCount: number;
};

export const RECIPE_6063_T5: RecipeSnapshot = {
  id: "recipe-6063-t5",
  alloy: "6063",
  temper: "T5",
  kind: "full",
  targetTempX10: 1850,
  toleranceX10: 100,
  soakMin: 240,
  hardnessMethod: "webster",
  hardnessMinX10: 80,
  hardnessMaxX10: 150,
  sampleCount: 3,
};

export const TOP_UP_6063_T5: RecipeSnapshot = {
  ...RECIPE_6063_T5,
  id: "recipe-6063-t5-topup",
  kind: "top_up",
  soakMin: 60,
};

export type SectionBand = {
  id: SectionId;
  label: string;
  minKg: number;
  maxKg: number;
};

export const SECTIONS: Record<SectionId, SectionBand> = {
  "domal-12170": { id: "domal-12170", label: "Domal 12170", minKg: 5.9, maxKg: 6.2 },
  "tee-13090": { id: "tee-13090", label: "Tee 13090", minKg: 2.7, maxKg: 2.9 },
};

export const FT12_MM = 12 * MM_PER_FOOT;
export const FT24_MM = 24 * MM_PER_FOOT;

export type TempReading = {
  id: string;
  at: string;
  tempX10: number;
  source: "typed" | "telemetry";
};

export type AgeingLine = {
  id: string;
  batchNumber: string;
  batchStatus: BatchStatus;
  trolleyCode: string;
  ovenCode: string;
  shiftId: ShiftId;
  pressRun: string;
  salesOrder: string;
  customer: string;
  city: string;
  po: string;
  cast: string;
  alloy: string;
  dieCopy: string;
  sectionId: SectionId;
  cutLengthMm: number;
  pcs: number;
  kgG: number;
  packedPcs: number;
  scrapPcs: number;
  reworkPcs: number;
  status: RowStatus;
  holdReason: string | null;
  hardnessX10: number[];
};

/**
 * AG-38 is out and released, one line held. AG-40 is in the oven.
 * Tee 13090 appears twice (AG-38 13090-1 and AG-40 13090-2). The section
 * filter therefore leaves two rows; the kilograms only sit in the Tee band.
 */
export const LINES: readonly AgeingLine[] = [
  {
    id: "ag38-12",
    batchNumber: "AG-38",
    batchStatus: "released",
    trolleyCode: "T-1",
    ovenCode: "OV-1",
    shiftId: "day",
    pressRun: "PR-18",
    salesOrder: "SO-104",
    customer: "Royal Aluminium",
    city: "Rajkot",
    po: "31",
    cast: "K31",
    alloy: "6063",
    dieCopy: "12170-1",
    sectionId: "domal-12170",
    cutLengthMm: FT12_MM,
    pcs: 48,
    kgG: 286_400,
    packedPcs: 5,
    scrapPcs: 0,
    reworkPcs: 0,
    status: "released",
    holdReason: null,
    hardnessX10: [90, 100, 90],
  },
  {
    id: "ag38-24",
    batchNumber: "AG-38",
    batchStatus: "released",
    trolleyCode: "T-1",
    ovenCode: "OV-1",
    shiftId: "day",
    pressRun: "PR-18",
    salesOrder: "SO-104",
    customer: "Royal Aluminium",
    city: "Rajkot",
    po: "31",
    cast: "K31",
    alloy: "6063",
    dieCopy: "12170-1",
    sectionId: "domal-12170",
    cutLengthMm: FT24_MM,
    pcs: 20,
    kgG: 238_640,
    packedPcs: 0,
    scrapPcs: 0,
    reworkPcs: 0,
    status: "released",
    holdReason: null,
    hardnessX10: [100, 90, 90],
  },
  {
    id: "ag38-tee",
    batchNumber: "AG-38",
    batchStatus: "released",
    trolleyCode: "T-1",
    ovenCode: "OV-1",
    shiftId: "day",
    pressRun: "PR-19",
    salesOrder: "SO-88",
    customer: "Tejura & Sons",
    city: "Morbi",
    po: "18",
    cast: "K28",
    alloy: "6063",
    dieCopy: "13090-1",
    sectionId: "tee-13090",
    cutLengthMm: FT12_MM,
    pcs: 36,
    kgG: 99_200,
    packedPcs: 0,
    scrapPcs: 0,
    reworkPcs: 0,
    status: "held",
    holdReason: "hardness low",
    hardnessX10: [70, 70, 60],
  },
  {
    id: "ag40-domal",
    batchNumber: "AG-40",
    batchStatus: "in_oven",
    trolleyCode: "T-3",
    ovenCode: "OV-1",
    shiftId: "day",
    pressRun: "PR-22",
    salesOrder: "SO-110",
    customer: "KD Extrusion",
    city: "Ahmedabad",
    po: "44",
    cast: "K31",
    alloy: "6063",
    dieCopy: "12170-2",
    sectionId: "domal-12170",
    cutLengthMm: FT12_MM,
    pcs: 60,
    kgG: 358_000,
    packedPcs: 0,
    scrapPcs: 0,
    reworkPcs: 0,
    status: "pending",
    holdReason: null,
    hardnessX10: [],
  },
  {
    id: "ag40-tee",
    batchNumber: "AG-40",
    batchStatus: "in_oven",
    trolleyCode: "T-3",
    ovenCode: "OV-1",
    shiftId: "day",
    pressRun: "PR-23",
    salesOrder: "SO-91",
    customer: "Mehta Windows",
    city: "Ahmedabad",
    po: "12",
    cast: "K28",
    alloy: "6063",
    dieCopy: "13090-2",
    sectionId: "tee-13090",
    cutLengthMm: FT12_MM,
    pcs: 40,
    kgG: 110_400,
    packedPcs: 0,
    scrapPcs: 0,
    reworkPcs: 0,
    status: "pending",
    holdReason: null,
    hardnessX10: [],
  },
];

export const AG38_IN_AT = "2026-10-24T01:50:00+05:30";
export const AG38_OUT_AT = "2026-10-24T06:10:00+05:30";
export const AG38_GAS_START_MILLI = 18_420_500;
export const AG38_GAS_END_MILLI = 18_431_200;

export const AG38_TEMPS: readonly TempReading[] = [
  { id: "t1", at: "2026-10-24T02:05:00+05:30", tempX10: 1760, source: "typed" },
  { id: "t2", at: "2026-10-24T02:20:00+05:30", tempX10: 1850, source: "typed" },
  { id: "t3", at: "2026-10-24T04:00:00+05:30", tempX10: 1860, source: "typed" },
  { id: "t4", at: "2026-10-24T06:00:00+05:30", tempX10: 1840, source: "typed" },
];

export const AG40_IN_AT = "2026-10-24T06:40:00+05:30";

/** First in-band reading. 09:10 − 06:55 = 2 h 15 m. */
export const AG40_TEMPS: readonly TempReading[] = [
  { id: "a1", at: "2026-10-24T06:55:00+05:30", tempX10: 1850, source: "typed" },
  { id: "a2", at: "2026-10-24T09:00:00+05:30", tempX10: 1860, source: "typed" },
];

export const BUNDLE_26J12 = {
  serial: "26J12",
  pcs: 5,
  weightG: 31_200,
  ageingRowId: "ag38-12",
  pressRun: "PR-18",
  cast: "K31",
  batchNumber: "AG-38",
  salesOrder: "SO-104",
  lengthMm: FT12_MM,
  recut: false,
} as const;

export type AvailableLine = {
  id: string;
  pressRun: string;
  dieCopy: string;
  sectionId: SectionId;
  cutLengthMm: number;
  pcsLeft: number;
  kgG: number;
  cast: string;
  salesOrder: string;
  customer: string;
  city: string;
  po: string;
};

/** Logged lines still offered on the load sheet. Same press runs as AG-40, shown as pieces left to load. */
export const AVAILABLE_LINES: readonly AvailableLine[] = [
  {
    id: "avail-pr22",
    pressRun: "PR-22",
    dieCopy: "12170-2",
    sectionId: "domal-12170",
    cutLengthMm: FT12_MM,
    pcsLeft: 60,
    kgG: 358_000,
    cast: "K31",
    salesOrder: "SO-110",
    customer: "KD Extrusion",
    city: "Ahmedabad",
    po: "44",
  },
  {
    id: "avail-pr23",
    pressRun: "PR-23",
    dieCopy: "13090-2",
    sectionId: "tee-13090",
    cutLengthMm: FT12_MM,
    pcsLeft: 40,
    kgG: 110_400,
    cast: "K28",
    salesOrder: "SO-91",
    customer: "Mehta Windows",
    city: "Ahmedabad",
    po: "12",
  },
];

export const NEXT_BATCH_NUMBER = "AG-41";

export const HOLD_REASONS = ["surface", "bend", "customer"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export function remainingPcs(row: {
  pcs: number;
  packedPcs: number;
  scrapPcs: number;
  reworkPcs: number;
}): number {
  return row.pcs - row.packedPcs - row.scrapPcs - row.reworkPcs;
}

/** Largest-remainder proration. A full take returns the original grams. */
export function prorateG(kgG: number, pcs: number, take: number): number {
  if (take <= 0 || pcs <= 0) return 0;
  if (take >= pcs) return kgG;
  return Math.round((kgG * take) / pcs);
}

export function inTempBand(tempX10: number, recipe: RecipeSnapshot): boolean {
  return Math.abs(tempX10 - recipe.targetTempX10) <= recipe.toleranceX10;
}

export function sortedTemps(readings: readonly TempReading[]): TempReading[] {
  return [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function soakStartedAt(readings: readonly TempReading[], recipe: RecipeSnapshot): string | null {
  const hit = sortedTemps(readings).find((r) => inTempBand(r.tempX10, recipe));
  return hit?.at ?? null;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}

export function soakMinutes(
  readings: readonly TempReading[],
  recipe: RecipeSnapshot,
  endIso: string,
): number | null {
  const started = soakStartedAt(readings, recipe);
  if (!started) return null;
  return minutesBetween(started, endIso);
}

export function lastTemp(readings: readonly TempReading[]): TempReading | null {
  const sorted = sortedTemps(readings);
  return sorted[sorted.length - 1] ?? null;
}

export function gasUsedMilli(start: number, end: number): number {
  return end - start;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return null;
  return Math.round((left + right) / 2);
}

export function hardnessPassed(readings: readonly number[], recipe: RecipeSnapshot): boolean {
  if (readings.length < recipe.sampleCount) return false;
  return readings.every((r) => r >= recipe.hardnessMinX10);
}

export function hardnessWarns(readings: readonly number[], recipe: RecipeSnapshot): boolean {
  return readings.some((r) => r > recipe.hardnessMaxX10);
}

export function kgPer12(line: { kgG: number; pcs: number; cutLengthMm: number }): number | null {
  return kgPer12ft({ weightG: line.kgG, pieces: line.pcs, lengthMm: line.cutLengthMm });
}

export function inWeightBand(line: { kgG: number; pcs: number; cutLengthMm: number; sectionId: SectionId }): boolean | null {
  const per = kgPer12(line);
  if (per === null) return null;
  const band = SECTIONS[line.sectionId];
  return per >= band.minKg && per <= band.maxKg;
}

export function formatKgFromG(g: number, digits = 2): string {
  return formatKg(gToKg(g), digits);
}

export function formatCapacityKg(g: number): string {
  return formatKg(gToKg(g), 0);
}

export function formatTemp(x10: number): string {
  return (x10 / 10).toFixed(1);
}

export function formatGas(milli: number): string {
  return (milli / 1000).toFixed(3);
}

export function formatDuration(mins: number): string {
  const sign = mins < 0 ? "−" : "";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h} h ${String(m).padStart(2, "0")} m`;
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatWhen(iso: string): string {
  return `${formatDay(iso)} ${formatClock(iso)}`;
}

export function formatShiftSpan(shift: Shift): string {
  const pad = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  return `${pad(shift.startMin)}–${pad(shift.endMin)}`;
}

export function formatCut(mm: number): string {
  return formatLength(mm, "inch");
}

export function linesFor(batchNumber: string): AgeingLine[] {
  return LINES.filter((line) => line.batchNumber === batchNumber);
}

export function sumPcs(lines: readonly { pcs: number }[]): number {
  return lines.reduce((sum, line) => sum + line.pcs, 0);
}

export function sumG(lines: readonly { kgG: number }[]): number {
  return lines.reduce((sum, line) => sum + line.kgG, 0);
}

export function theoreticalRemainingG(
  lines: readonly { kgG: number; pcs: number; packedPcs: number; scrapPcs: number; reworkPcs: number }[],
): number {
  return lines.reduce((sum, line) => sum + prorateG(line.kgG, line.pcs, remainingPcs(line)), 0);
}

export type OrderStripLine = {
  id: string;
  dieCopy: string;
  sectionLabel: string;
  lengthLabel: string;
  loaded: number;
  inOven: number;
  held: number;
  released: number;
  packed: number;
  onTrolley: number;
  theoreticalG: number;
};

export type OrderStrip = {
  salesOrder: string;
  customer: string;
  city: string;
  po: string;
  loaded: number;
  inOven: number;
  held: number;
  released: number;
  packed: number;
  onTrolley: number;
  theoreticalG: number;
  lines: OrderStripLine[];
};

function lineBuckets(line: AgeingLine): Omit<OrderStripLine, "id" | "dieCopy" | "sectionLabel" | "lengthLabel" | "theoreticalG"> {
  const left = remainingPcs(line);
  const inOven = line.batchStatus === "in_oven" ? line.pcs : 0;
  const held = line.status === "held" ? left : 0;
  const released = line.status === "released" ? left : 0;
  return {
    loaded: line.pcs,
    inOven,
    held,
    released,
    packed: line.packedPcs,
    onTrolley: left,
  };
}

/** `ageing.forOrder` piece counts. Initial fixture only — not live with the batch screen. */
export function orderStrip(salesOrder: string): OrderStrip | null {
  const rows = LINES.filter((line) => line.salesOrder === salesOrder);
  const first = rows[0];
  if (!first) return null;
  const lines: OrderStripLine[] = rows.map((line) => ({
    id: line.id,
    dieCopy: line.dieCopy,
    sectionLabel: SECTIONS[line.sectionId].label,
    lengthLabel: formatCut(line.cutLengthMm),
    theoreticalG: line.kgG,
    ...lineBuckets(line),
  }));
  return {
    salesOrder,
    customer: first.customer,
    city: first.city,
    po: first.po,
    loaded: lines.reduce((sum, line) => sum + line.loaded, 0),
    inOven: lines.reduce((sum, line) => sum + line.inOven, 0),
    held: lines.reduce((sum, line) => sum + line.held, 0),
    released: lines.reduce((sum, line) => sum + line.released, 0),
    packed: lines.reduce((sum, line) => sum + line.packed, 0),
    onTrolley: lines.reduce((sum, line) => sum + line.onTrolley, 0),
    theoreticalG: lines.reduce((sum, line) => sum + line.theoreticalG, 0),
    lines,
  };
}

export function capacityWarning(loadG: number, capacityG: number): string | null {
  if (loadG <= capacityG) return null;
  return `Over capacity (${formatCapacityKg(capacityG)} kg). Starting is still allowed.`;
}

export const AG38_LINES = linesFor("AG-38");
export const AG40_LINES = linesFor("AG-40");

export const CUSTOMER_FILTERS = [
  "All",
  "Royal Aluminium",
  "Tejura & Sons",
  "KD Extrusion",
  "Apex Fabricators",
] as const;

export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];
