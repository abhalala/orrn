/**
 * Sample data for the pack, stock and dispatch previews.
 * Weights are kilograms in the fixtures; kg/12 ft goes through the shared
 * plant formula (`kgPer12ft`) on the stated cut length, so 124.95 kg over
 * 21 pieces of 12 ft displays as 5.95.
 */
import { formatKg, kgPer12ft, kgToG, MM_PER_FOOT } from "@orrn/domain";

export const PLANT = {
  name: "FourCubes",
  city: "Surat",
  /** Production day starts at the first shift, not midnight. */
  dayStart: "08:00",
  dateLabel: "24 Oct 2026",
} as const;

export type ProfileKind = "hollow" | "solid" | "semi";
export type Allocation = "order" | "plant-stock" | "unassigned";
export type BandPosition = "in" | "above" | "below";

export type DieFixture = {
  code: string;
  series: string;
  profileKind: ProfileKind;
  bandMinKg: number;
  bandMaxKg: number;
  copyCode: string | null;
  /** Latest drift reading, kg per 12 ft. Null when no copy has been read. */
  driftKg: number | null;
  owner: string | null;
  standard: string;
  cml: string;
};

export const DIES = {
  d12170: {
    code: "12170",
    series: "Domal",
    profileKind: "hollow",
    bandMinKg: 5.9,
    bandMaxKg: 6.2,
    copyCode: "12170-1",
    driftKg: 5.967,
    owner: null,
    standard: "IS 1285",
    cml: "CM/L-5201486",
  },
  d18440: {
    code: "18440",
    series: "Domal",
    profileKind: "solid",
    bandMinKg: 1.1,
    bandMaxKg: 1.4,
    copyCode: "18440-1",
    driftKg: 1.22,
    owner: "Bhavesh Traders",
    standard: "IS 733",
    cml: "CM/L-5201491",
  },
} as const satisfies Record<string, DieFixture>;

export type CustomerFixture = {
  name: string;
  city: string | null;
  /** Null inherits the plant series, so the party number equals the scan serial. */
  policy: "monthly" | "fy" | "lifelong" | null;
  nextPartyNo: string;
};

export const CUSTOMERS = {
  bhavesh: {
    name: "Bhavesh Traders",
    city: "Ahmedabad",
    policy: "monthly",
    nextPartyNo: "26J16",
  },
  kd: {
    name: "KD Extrusion",
    city: "Ahmedabad",
    policy: "fy",
    nextPartyNo: "2026-27/8",
  },
} as const satisfies Record<string, CustomerFixture>;

export const SALES_ORDER = {
  code: "SO-18",
  customer: CUSTOMERS.bhavesh.name,
  /** Line is 12 ft of 12170, 200 pcs at the 5.967 drift reading. */
  orderedKg: 1_193.4,
  dispatchedKg: 0,
} as const;

export const KD_ORDER = {
  code: "SO-2026-27/22",
  customer: CUSTOMERS.kd.name,
} as const;

/** Baki is ordered minus dispatched, never negative. Pack does not change it. */
export function bakiKg(orderedKg: number, dispatchedKg: number): number {
  return Math.max(0, orderedKg - dispatchedKg);
}

export const TROLLEY = {
  batch: "K31",
  trolley: 2,
  /** Server remaining: pcs − packed − scrap − rework. The open card has not posted yet. */
  remainingPcs: 86,
  lengthFt: 12,
  cast: "K31",
  dieCode: "12170",
  customer: CUSTOMERS.bhavesh.name,
  salesOrderCode: SALES_ORDER.code,
} as const;

export const SCALE = {
  nodeId: "pack-bay-1",
  /** Stable reading the bay is showing on the open card. */
  kg: 124.95,
} as const;

export const OPEN_CARD = {
  pieces: 21,
} as const;

export type BundleFixture = {
  serial: string;
  partyNo: string;
  dieCode: "12170" | "18440";
  lengthFt: number;
  pieces: number;
  weightKg: number;
  allocation: Allocation;
  salesOrderCode: string | null;
  packedSalesOrderCode: string | null;
  customer: string | null;
  yard: string;
  heldBy: string | null;
};

export const BUNDLES = {
  /** On SO-18, yard Y2. The packing list prints party 26J12. */
  j4086: {
    serial: "26J4086",
    partyNo: "26J12",
    dieCode: "12170",
    lengthFt: 12,
    pieces: 21,
    weightKg: 124.95,
    allocation: "order",
    salesOrderCode: SALES_ORDER.code,
    packedSalesOrderCode: SALES_ORDER.code,
    customer: CUSTOMERS.bhavesh.name,
    yard: "Y2",
    heldBy: null,
  },
  j4087: {
    serial: "26J4087",
    partyNo: "26J13",
    dieCode: "12170",
    lengthFt: 12,
    pieces: 18,
    weightKg: 107.64,
    allocation: "order",
    salesOrderCode: SALES_ORDER.code,
    packedSalesOrderCode: SALES_ORDER.code,
    customer: CUSTOMERS.bhavesh.name,
    yard: "Y2",
    heldBy: null,
  },
  /** At the bay, not yet on a dispatch. The first scripted scan adds it. */
  j4089: {
    serial: "26J4089",
    partyNo: "26J14",
    dieCode: "12170",
    lengthFt: 12,
    pieces: 20,
    weightKg: 119.2,
    allocation: "order",
    salesOrderCode: SALES_ORDER.code,
    packedSalesOrderCode: SALES_ORDER.code,
    customer: CUSTOMERS.bhavesh.name,
    yard: "Y2",
    heldBy: null,
  },
  /** Transfer to a null line already exists, so this is plant stock, not unassigned. */
  j3901: {
    serial: "26J3901",
    partyNo: "2026-27/7",
    dieCode: "18440",
    lengthFt: 16,
    pieces: 30,
    weightKg: 48,
    allocation: "plant-stock",
    salesOrderCode: null,
    packedSalesOrderCode: null,
    customer: null,
    yard: "Y2",
    heldBy: null,
  },
  /**
   * Packed for KD Extrusion on a die Bhavesh Traders owns. Not in the yard list
   * the stock screen shows — the gate scan is the demo for this serial.
   */
  j2200: {
    serial: "26J2200",
    partyNo: "2026-27/6",
    dieCode: "18440",
    lengthFt: 16,
    pieces: 20,
    weightKg: 32,
    allocation: "order",
    salesOrderCode: KD_ORDER.code,
    packedSalesOrderCode: KD_ORDER.code,
    customer: CUSTOMERS.kd.name,
    yard: "Y1",
    heldBy: null,
  },
  /** No sales order line and no transfer row. The gate refuses it. */
  j1001: {
    serial: "26J1001",
    partyNo: "26J1001",
    dieCode: "12170",
    lengthFt: 12,
    pieces: 10,
    weightKg: 25,
    allocation: "unassigned",
    salesOrderCode: null,
    packedSalesOrderCode: null,
    customer: null,
    yard: "Y2",
    heldBy: null,
  },
  /** Held on another dispatch. The refusal names that code. */
  j3190: {
    serial: "26J3190",
    partyNo: "26J9",
    dieCode: "12170",
    lengthFt: 12,
    pieces: 16,
    weightKg: 40,
    allocation: "order",
    salesOrderCode: SALES_ORDER.code,
    packedSalesOrderCode: SALES_ORDER.code,
    customer: CUSTOMERS.bhavesh.name,
    yard: "Y2",
    heldBy: "DN-0991",
  },
} as const satisfies Record<string, BundleFixture>;

/** Yard stock the stock screen lists. 26J2200 is not in this yard view. */
export const STOCK_BUNDLES: readonly BundleFixture[] = [BUNDLES.j4086, BUNDLES.j4087, BUNDLES.j3901];

export const DISPATCH = {
  code: "DN-1044",
  customer: CUSTOMERS.bhavesh.name,
  transporter: "Patel Roadlines",
  vehicleNo: "GJ-03-AB-1842",
  capacityKg: 2_000,
  status: "draft",
} as const;

/**
 * Already on DN-1044 so the gate opens at 232.59 kg with two rows — the same
 * two bundles the packing list and the yard show, so one serial means one
 * story everywhere. 26J4089 is still at the bay; the first scripted scan adds it.
 */
export const DISPATCH_OPENING: readonly BundleFixture[] = [BUNDLES.j4086, BUNDLES.j4087];

export const PACKING_LIST = {
  code: "PL/2026-27/4501",
  revision: 1,
  dispatchCode: DISPATCH.code,
} as const;

export const COMBINE_DISPATCH = {
  code: "DN-1040",
  customer: CUSTOMERS.bhavesh.name,
  status: "completed" as const,
  line: {
    serial: "26J4010",
    partyNo: "26J8",
    dieCode: "18440" as const,
    lengthFt: 16,
    pieces: 24,
    /** 1.25 kg/12 ft, inside the 18440 band (1.10–1.40). */
    weightKg: 40,
    originalSo: "SO-2026-27/16",
  },
};

export const TRANSFER_CODE = "XFER-2026-27/3";

export type ScanStep =
  | {
      kind: "add";
      serial: string;
      partyNo: string;
      weightKg: number;
      pieces: number;
      dieCode: "12170" | "18440";
      lengthFt: number;
    }
  | {
      kind: "refuse";
      serial: string;
      reason: string;
    };

/** Fixed gate script. Each Enter plays the next step, then it wraps. */
export const SCAN_SCRIPT: readonly ScanStep[] = [
  {
    kind: "add",
    serial: BUNDLES.j4089.serial,
    partyNo: BUNDLES.j4089.partyNo,
    weightKg: BUNDLES.j4089.weightKg,
    pieces: BUNDLES.j4089.pieces,
    dieCode: "12170",
    lengthFt: 12,
  },
  {
    kind: "refuse",
    serial: BUNDLES.j4089.serial,
    reason: "Already in this dispatch",
  },
  {
    kind: "refuse",
    serial: BUNDLES.j2200.serial,
    reason: `This die belongs to ${DIES.d18440.owner}`,
  },
  {
    kind: "refuse",
    serial: BUNDLES.j1001.serial,
    reason: "Not assigned to a sales order",
  },
  {
    kind: "add",
    serial: "26J4088",
    partyNo: "26J15",
    weightKg: 1_950,
    pieces: 780,
    dieCode: "12170",
    lengthFt: 12,
  },
  {
    kind: "refuse",
    serial: BUNDLES.j3190.serial,
    reason: "Held by DN-0991",
  },
];

export function lengthMm(lengthFt: number): number {
  return lengthFt * MM_PER_FOOT;
}

/** kg per 12 ft for a cut stated in feet. Null when pieces or length are not positive. */
export function kgPer12ftAt(weightKg: number, pieces: number, lengthFt: number): number | null {
  return kgPer12ft({
    weightG: kgToG(weightKg),
    pieces,
    lengthMm: lengthMm(lengthFt),
  });
}

export function bandPosition(kg12: number, bandMinKg: number, bandMaxKg: number): BandPosition {
  if (kg12 > bandMaxKg) return "above";
  if (kg12 < bandMinKg) return "below";
  return "in";
}

export function bandLabel(position: BandPosition): string {
  if (position === "in") return "In band";
  if (position === "above") return "Above";
  return "Below";
}

/**
 * Bundle kg/12 ft against the latest drift reading, as a percent. Both sides
 * round to the 2 decimals the screen prints, so the percent always matches
 * the figures shown beside it. Null if the rounded drift reading is 0.
 */
export function driftPercent(bundleKg12: number, driftKg12: number): number | null {
  const bundle = Math.round(bundleKg12 * 100) / 100;
  const drift = Math.round(driftKg12 * 100) / 100;
  if (drift === 0) return null;
  return ((bundle - drift) / drift) * 100;
}

/** Pieces still on the trolley after this card's good pieces and rejects. */
export function trolleyLeft(serverRemaining: number, goodPcs: number, rejectPcs: number): number {
  return serverRemaining - goodPcs - rejectPcs;
}

export function sumKg(weights: readonly number[]): number {
  return weights.reduce((sum, kg) => sum + kg, 0);
}

export function overCapacity(scannedKg: number, capacityKg: number | null): boolean {
  if (capacityKg === null) return false;
  return scannedKg > capacityKg;
}

export function capacityPercent(scannedKg: number, capacityKg: number): number {
  if (capacityKg <= 0) return 0;
  return (scannedKg / capacityKg) * 100;
}

export function formatKg2(kg: number): string {
  return formatKg(kg);
}

export function formatKgWhole(kg: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(kg);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

export function dieFor(code: string): DieFixture {
  if (code === DIES.d18440.code) return DIES.d18440;
  return DIES.d12170;
}

export function sectionLabel(die: DieFixture): string {
  return `${die.code} ${die.series}`;
}

export type StockLengthRow = {
  key: string;
  dieCode: string;
  series: string;
  profileKind: ProfileKind;
  lengthFt: number;
  bundles: number;
  pieces: number;
  kg: number;
  plantStock: boolean;
};

export function lengthRows(bundles: readonly BundleFixture[]): StockLengthRow[] {
  const groups = new Map<string, BundleFixture[]>();
  for (const bundle of bundles) {
    const key = `${bundle.dieCode}:${bundle.lengthFt}`;
    const list = groups.get(key) ?? [];
    list.push(bundle);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!;
      const die = dieFor(first.dieCode);
      return {
        key,
        dieCode: first.dieCode,
        series: die.series,
        profileKind: die.profileKind,
        lengthFt: first.lengthFt,
        bundles: rows.length,
        pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
        kg: sumKg(rows.map((row) => row.weightKg)),
        plantStock: rows.every((row) => row.allocation === "plant-stock"),
      };
    })
    .sort((a, b) => a.dieCode.localeCompare(b.dieCode, "en") || a.lengthFt - b.lengthFt);
}

export type StockSectionRow = {
  dieCode: string;
  series: string;
  profileKind: ProfileKind;
  bundles: number;
  pieces: number;
  kg: number;
  owner: string | null;
};

export function sectionRows(bundles: readonly BundleFixture[]): StockSectionRow[] {
  const groups = new Map<string, BundleFixture[]>();
  for (const bundle of bundles) {
    const list = groups.get(bundle.dieCode) ?? [];
    list.push(bundle);
    groups.set(bundle.dieCode, list);
  }
  return [...groups.entries()]
    .map(([dieCode, rows]) => {
      const die = dieFor(dieCode);
      return {
        dieCode,
        series: die.series,
        profileKind: die.profileKind,
        bundles: rows.length,
        pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
        kg: sumKg(rows.map((row) => row.weightKg)),
        owner: die.owner,
      };
    })
    .sort((a, b) => a.dieCode.localeCompare(b.dieCode, "en"));
}

export type PlLine = {
  serial: string;
  partyNo: string;
  dieCode: string;
  series: string;
  profileKind: ProfileKind;
  lengthFt: number;
  pieces: number;
  weightKg: number;
  originalSo: string | null;
};

export function toPlLine(bundle: BundleFixture): PlLine {
  const die = dieFor(bundle.dieCode);
  return {
    serial: bundle.serial,
    partyNo: bundle.partyNo,
    dieCode: bundle.dieCode,
    series: die.series,
    profileKind: die.profileKind,
    lengthFt: bundle.lengthFt,
    pieces: bundle.pieces,
    weightKg: bundle.weightKg,
    originalSo: bundle.packedSalesOrderCode,
  };
}

export function combineLine(): PlLine {
  const die = dieFor(COMBINE_DISPATCH.line.dieCode);
  return {
    serial: COMBINE_DISPATCH.line.serial,
    partyNo: COMBINE_DISPATCH.line.partyNo,
    dieCode: COMBINE_DISPATCH.line.dieCode,
    series: die.series,
    profileKind: die.profileKind,
    lengthFt: COMBINE_DISPATCH.line.lengthFt,
    pieces: COMBINE_DISPATCH.line.pieces,
    weightKg: COMBINE_DISPATCH.line.weightKg,
    originalSo: COMBINE_DISPATCH.line.originalSo,
  };
}

export const INITIAL_PL_LINES: readonly PlLine[] = [toPlLine(BUNDLES.j4086), toPlLine(BUNDLES.j4087)];

export function sortPlLines(lines: readonly PlLine[]): PlLine[] {
  return [...lines].sort((a, b) => {
    const section = a.dieCode.localeCompare(b.dieCode, "en");
    if (section !== 0) return section;
    if (a.lengthFt !== b.lengthFt) return a.lengthFt - b.lengthFt;
    return a.partyNo.localeCompare(b.partyNo, "en");
  });
}

export type PlSummaryRow = {
  kind: ProfileKind;
  bundles: number;
  pieces: number;
  kg: number;
};

export function plSummary(lines: readonly PlLine[]): PlSummaryRow[] {
  const kinds: ProfileKind[] = ["hollow", "solid", "semi"];
  return kinds
    .map((kind) => {
      const rows = lines.filter((line) => line.profileKind === kind);
      return {
        kind,
        bundles: rows.length,
        pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
        kg: sumKg(rows.map((row) => row.weightKg)),
      };
    })
    .filter((row) => row.bundles > 0);
}

