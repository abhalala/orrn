/**
 * Sample data for the orders preview. Numbers come from the spec formula at
 * exact feet (`mm = feet × 304.8`), which is what makes the worked examples
 * land: 30 × 18 ft × 12.000 = 540.000 kg, × 12.300 = 553.500 kg.
 *
 * Whole-mm rounding (`lengthFromInput`) is what the plant stores for display.
 * A quote that used the rounded millimetre would miss those kilograms, so the
 * preview quotes with the unrounded length the spec's examples require.
 *
 * The demo brief's "535.950 kg" for 29 pcs does not satisfy the formula.
 * 29 × 18 ft × 12.300 kg/12 ft = 535.050 kg. The screen shows 535.050.
 */

import { formatLength, lengthFromInput, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { StatusTone } from "@orrn/domain";

export const ORDERS_SPEC = "docs/superpowers/specs/2026-10-24-orrn-fp-orders-planning-design.md";

export const COMPANY = {
  lengthUnit: "inch" as LengthUnit,
  timezone: "Asia/Kolkata",
  priceOnSalesOrder: false,
  dieBands: true,
  dieRequiredOnSalesOrder: true,
  todayLabel: "24 Oct 2026",
} as const;

export const PLAN_WINDOW = {
  label: "Tonight 20:00 – tomorrow 20:00 · 24 h",
  detail: "24 Oct 2026 20:00 – 25 Oct 2026 20:00 · IST · two shifts",
  hours: 24,
} as const;

export type WeightBasis = "copy_current" | "band_start";
export type QtyBasis = "pcs" | "kg";
export type OrderStatus = "booking" | "confirmed" | "dispatching" | "closed" | "cancelled";
export type Finish = "none" | "anodise" | "pvd";

export type Customer = {
  id: string;
  name: string;
  city: string;
  kgToleranceBp: number;
};

export type DieCopy = {
  code: string;
  tier: number | null;
  currentMilli: number;
  ownerCustomerId: string | null;
};

export type Die = {
  code: string;
  name: string;
  series: string | null;
  bandStartMilli: number;
  bandEndMilli: number;
  alloy: string;
  temper: string;
  copies: readonly DieCopy[];
};

export const CUSTOMERS: readonly Customer[] = [
  { id: "bhavesh", name: "Bhavesh Traders", city: "Ahmedabad", kgToleranceBp: 0 },
  { id: "anshu", name: "Anshu Aluminium", city: "Rajkot", kgToleranceBp: 0 },
];

export const DIES: readonly Die[] = [
  {
    code: "12170",
    name: "Domal",
    series: "DOMAL",
    bandStartMilli: 5900,
    bandEndMilli: 6200,
    alloy: "6063",
    temper: "T6",
    copies: [
      { code: "12170-1", tier: 1, currentMilli: 5967, ownerCustomerId: null },
      { code: "12170-2", tier: 2, currentMilli: 6480, ownerCustomerId: "bhavesh" },
    ],
  },
  {
    code: "4521",
    name: "4521",
    series: null,
    bandStartMilli: 12000,
    bandEndMilli: 14000,
    alloy: "6063",
    temper: "T6",
    copies: [{ code: "4521-1", tier: null, currentMilli: 12300, ownerCustomerId: null }],
  },
];

export function customerById(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}

export function customerName(id: string | null | undefined): string {
  if (!id) return "Plant stock";
  return customerById(id)?.name ?? id;
}

export function dieByCode(code: string): Die | undefined {
  return DIES.find((d) => d.code === code);
}

export function copyByCode(die: Die, code: string | null): DieCopy | undefined {
  if (!code) return undefined;
  return die.copies.find((c) => c.code === code);
}

/** Lightest in-band copy. Die room would issue this one; the plan does not lock it. */
export function lightestCopy(die: Die): DieCopy {
  return [...die.copies].sort((a, b) => a.currentMilli - b.currentMilli)[0]!;
}

export function dieTitle(die: Die): string {
  return die.name === die.code ? die.code : `${die.code} ${die.name}`;
}

export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "booking":
      return "Booking";
    case "confirmed":
      return "Confirmed";
    case "dispatching":
      return "Dispatching";
    case "closed":
      return "Closed";
    case "cancelled":
      return "Cancelled";
  }
}

export function orderStatusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "booking":
      return "amber";
    case "confirmed":
      return "blue";
    case "dispatching":
      return "green";
    case "closed":
      return "neutral";
    case "cancelled":
      return "red";
  }
}

export function finishLabel(finish: Finish): string {
  switch (finish) {
    case "none":
      return "None";
    case "anodise":
      return "Anodise";
    case "pvd":
      return "PVD";
  }
}

/** `round(pcs × feet × grams-per-12-ft / 12)`. */
export function orderGrams(pcs: number, lengthFt: number, basisMilli: number): number {
  if (pcs <= 0 || lengthFt <= 0 || basisMilli <= 0) return 0;
  return Math.round((pcs * lengthFt * basisMilli) / 12);
}

/** `round(kgG × 12 / (feet × grams-per-12-ft))`. */
export function orderPieces(kgG: number, lengthFt: number, basisMilli: number): number {
  if (kgG <= 0 || lengthFt <= 0 || basisMilli <= 0) return 0;
  return Math.round((kgG * 12) / (lengthFt * basisMilli));
}

export function formatOrderKg(grams: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(grams / 1000);
}

/** "1,300 kg" when the kilograms are whole, otherwise three decimals. */
export function formatKgShort(grams: number): string {
  const kg = grams / 1000;
  if (Number.isInteger(kg)) return `${new Intl.NumberFormat("en-IN").format(kg)} kg`;
  return `${formatOrderKg(grams)} kg`;
}

export function formatPcs(pcs: number): string {
  return new Intl.NumberFormat("en-IN").format(pcs);
}

export function formatMilli(milli: number): string {
  return (milli / 1000).toFixed(3);
}

export function kgFieldText(grams: number): string {
  return (grams / 1000).toFixed(3);
}

export function lengthMm(lengthFt: number): number {
  return lengthFromInput({ unit: "inch", feet: String(lengthFt), inches: "0" }) ?? Math.round(lengthFt * 12 * 25.4);
}

export function lengthLabel(lengthFt: number): string {
  return formatLength(lengthMm(lengthFt), COMPANY.lengthUnit);
}

export function parseLengthFt(feet: string, inches: string): number | null {
  const mm = lengthFromInput({ unit: "inch", feet, inches });
  if (mm === null) return null;
  const totalInches = mm / 25.4;
  return totalInches / 12;
}

export type Quote = {
  pcs: number;
  kgG: number;
  impliedG: number;
  gapG: number;
  bandG: number;
  currentG: number | null;
  basisMilli: number;
};

export function quoteLine(input: {
  qtyBasis: QtyBasis;
  pcs: number;
  kgG: number;
  lengthFt: number;
  weightBasis: WeightBasis;
  bandStartMilli: number;
  copyMilli: number | null;
}): Quote | null {
  const basisMilli = input.weightBasis === "copy_current" && input.copyMilli != null ? input.copyMilli : input.bandStartMilli;
  if (input.lengthFt <= 0 || basisMilli <= 0) return null;

  if (input.qtyBasis === "pcs") {
    if (input.pcs < 1) return null;
    const impliedG = orderGrams(input.pcs, input.lengthFt, basisMilli);
    return {
      pcs: input.pcs,
      kgG: impliedG,
      impliedG,
      gapG: 0,
      bandG: orderGrams(input.pcs, input.lengthFt, input.bandStartMilli),
      currentG: input.copyMilli == null ? null : orderGrams(input.pcs, input.lengthFt, input.copyMilli),
      basisMilli,
    };
  }

  if (input.kgG < 1) return null;
  const pcs = orderPieces(input.kgG, input.lengthFt, basisMilli);
  if (pcs < 1) return null;
  const impliedG = orderGrams(pcs, input.lengthFt, basisMilli);
  return {
    pcs,
    kgG: input.kgG,
    impliedG,
    gapG: input.kgG - impliedG,
    bandG: orderGrams(pcs, input.lengthFt, input.bandStartMilli),
    currentG: input.copyMilli == null ? null : orderGrams(pcs, input.lengthFt, input.copyMilli),
    basisMilli,
  };
}

export type OrderLine = {
  id: string;
  sectionCode: string;
  copyCode: string | null;
  cutLengthFt: number;
  qtyBasis: QtyBasis;
  pcs: number;
  kgG: number;
  impliedG: number;
  weightBasis: WeightBasis;
  basisMilli: number;
  bandStartMilli: number;
  copyMilli: number | null;
  alloy: string;
  temper: string;
  finish: Finish;
  received?: boolean;
};

export type TimelineRow = {
  id: string;
  label: string;
  detail: string;
};

export type SalesOrder = {
  number: string;
  customerId: string;
  poNumber: string;
  status: OrderStatus;
  orderDateLabel: string;
  lines: OrderLine[];
  timeline: TimelineRow[];
  /** Weighed kg on completed dispatches. Does not move when stock is reallocated. */
  dispatchedG: number;
  dispatchedPcs: number;
  /**
   * Kg that left this PO in the sample (reallocate). The strip's balance is
   * ordered − dispatched − this, so a completed move shows 0 as the brief asks
   * and the subtraction still adds up.
   */
  movedOffG: number;
  movedOffPcs: number;
  /** Seeded orders the list may open. Saved bookings are open too. */
  openDetail: boolean;
  savedNotice: string | null;
};

export type YardLot = {
  id: string;
  sectionCode: string;
  lengthFt: number;
  pcs: number;
  kgG: number;
  kind: "line" | "plant" | "unassigned";
  orderNumber?: string;
  customerId?: string;
  poText?: string;
};

export type HoldPending = {
  kgG: number;
  pcs: number;
  po: string;
  fromOrder: string;
};


export function orderedOf(order: SalesOrder): { g: number; pcs: number } {
  let g = 0;
  let pcs = 0;
  for (const line of order.lines) {
    if (line.received) continue;
    g += line.kgG;
    pcs += line.pcs;
  }
  return { g, pcs };
}

export function yardOnOrder(yard: readonly YardLot[], orderNumber: string): { g: number; pcs: number } {
  let g = 0;
  let pcs = 0;
  for (const lot of yard) {
    if (lot.kind === "line" && lot.orderNumber === orderNumber) {
      g += lot.kgG;
      pcs += lot.pcs;
    }
  }
  return { g, pcs };
}

export type Strip = {
  orderedG: number;
  orderedPcs: number;
  plannedG: number;
  plannedPcs: number;
  pressedG: number;
  pressedPcs: number;
  agedG: number;
  agedPcs: number;
  packedG: number;
  packedPcs: number;
  inStockG: number;
  inStockPcs: number;
  dispatchedG: number;
  dispatchedPcs: number;
  bakiG: number;
  bakiPcs: number;
  planableG: number;
  planablePcs: number;
  movedOffG: number;
  movedOffPcs: number;
};

/** No press cuts or ageing rows in this sample, so those columns stay 0. */
export function stripFor(
  order: SalesOrder,
  yard: readonly YardLot[],
  planned: { g: number; pcs: number } = { g: 0, pcs: 0 },
): Strip {
  const ordered = orderedOf(order);
  const stock = yardOnOrder(yard, order.number);
  const bakiG = Math.max(0, ordered.g - order.dispatchedG - order.movedOffG);
  const bakiPcs = Math.max(0, ordered.pcs - order.dispatchedPcs - order.movedOffPcs);
  const planableG = Math.max(0, ordered.g - order.dispatchedG - stock.g - planned.g - order.movedOffG);
  const planablePcs = Math.max(0, ordered.pcs - order.dispatchedPcs - stock.pcs - planned.pcs - order.movedOffPcs);
  return {
    orderedG: ordered.g,
    orderedPcs: ordered.pcs,
    plannedG: planned.g,
    plannedPcs: planned.pcs,
    pressedG: 0,
    pressedPcs: 0,
    agedG: 0,
    agedPcs: 0,
    packedG: stock.g,
    packedPcs: stock.pcs,
    inStockG: stock.g,
    inStockPcs: stock.pcs,
    dispatchedG: order.dispatchedG,
    dispatchedPcs: order.dispatchedPcs,
    bakiG,
    bakiPcs,
    planableG,
    planablePcs,
    movedOffG: order.movedOffG,
    movedOffPcs: order.movedOffPcs,
  };
}

function makeLine(input: {
  id: string;
  sectionCode: string;
  copyCode: string | null;
  cutLengthFt: number;
  qtyBasis: QtyBasis;
  pcs: number;
  kgG: number;
  weightBasis: WeightBasis;
  received?: boolean;
}): OrderLine {
  const die = dieByCode(input.sectionCode)!;
  const copy = copyByCode(die, input.copyCode) ?? null;
  const reading = copy?.currentMilli ?? lightestCopy(die).currentMilli;
  const basisMilli = input.weightBasis === "copy_current" ? reading : die.bandStartMilli;
  const impliedG = orderGrams(input.pcs, input.cutLengthFt, basisMilli);
  return {
    id: input.id,
    sectionCode: input.sectionCode,
    copyCode: input.copyCode,
    cutLengthFt: input.cutLengthFt,
    qtyBasis: input.qtyBasis,
    pcs: input.pcs,
    kgG: input.kgG,
    impliedG,
    weightBasis: input.weightBasis,
    basisMilli,
    bandStartMilli: die.bandStartMilli,
    copyMilli: copy?.currentMilli ?? lightestCopy(die).currentMilli,
    alloy: die.alloy,
    temper: die.temper,
    finish: "none",
    received: input.received,
  };
}

export function seedOrders(): SalesOrder[] {
  const so12Pcs = orderPieces(8_000_000, 12, 12_000);
  const so14Kg = orderGrams(30, 18, 12_300);
  const so18Kg = orderGrams(200, 12, 5_967);
  const so19Pcs = 80;
  const so19Kg = orderGrams(so19Pcs, 14, 5_967);
  const stockPcs = 108;
  const dispatchedPcs = so12Pcs - stockPcs;

  return [
    {
      number: "SO-12",
      customerId: "anshu",
      poNumber: "AN-1842",
      status: "dispatching",
      orderDateLabel: "12 Oct 2026",
      openDetail: true,
      savedNotice: null,
      dispatchedG: 6_700_000,
      dispatchedPcs,
      movedOffG: 0,
      movedOffPcs: 0,
      lines: [
        makeLine({
          id: "sol-12",
          sectionCode: "4521",
          copyCode: "4521-1",
          cutLengthFt: 12,
          qtyBasis: "kg",
          pcs: so12Pcs,
          kgG: 8_000_000,
          weightBasis: "band_start",
        }),
      ],
      timeline: [
        { id: "t12-booked", label: "Booked 12 Oct", detail: "PO AN-1842 · Anshu Aluminium" },
        { id: "t12-packed", label: "Packed 14 Oct", detail: "8,000 kg" },
        { id: "t12-dispatched", label: "Dispatched 18 Oct", detail: "6,700 kg, vehicle GJ-03-T-4412" },
        { id: "t12-stock", label: "In stock since 18 Oct", detail: "1,300 kg" },
      ],
    },
    {
      number: "SO-14",
      customerId: "bhavesh",
      poNumber: "BH-2026-118",
      status: "booking",
      orderDateLabel: "22 Oct 2026",
      openDetail: true,
      savedNotice: null,
      dispatchedG: 0,
      dispatchedPcs: 0,
      movedOffG: 0,
      movedOffPcs: 0,
      lines: [
        {
          ...makeLine({
            id: "sol-14",
            sectionCode: "4521",
            copyCode: "4521-1",
            cutLengthFt: 18,
            qtyBasis: "pcs",
            pcs: 30,
            kgG: so14Kg,
            weightBasis: "copy_current",
          }),
          impliedG: so14Kg,
        },
      ],
      timeline: [{ id: "t14-booked", label: "Booked 22 Oct", detail: "PO BH-2026-118 · not confirmed" }],
    },
    {
      number: "SO-18",
      customerId: "bhavesh",
      poNumber: "BH-2026-121",
      status: "confirmed",
      orderDateLabel: "20 Oct 2026",
      openDetail: false,
      savedNotice: null,
      dispatchedG: 0,
      dispatchedPcs: 0,
      movedOffG: 0,
      movedOffPcs: 0,
      lines: [
        makeLine({
          id: "sol-18",
          sectionCode: "12170",
          copyCode: null,
          cutLengthFt: 12,
          qtyBasis: "pcs",
          pcs: 200,
          kgG: so18Kg,
          weightBasis: "copy_current",
        }),
      ],
      timeline: [{ id: "t18", label: "Confirmed 20 Oct", detail: "PO BH-2026-121" }],
    },
    {
      number: "SO-19",
      customerId: "anshu",
      poNumber: "AN-1901",
      status: "confirmed",
      orderDateLabel: "21 Oct 2026",
      openDetail: false,
      savedNotice: null,
      dispatchedG: 0,
      dispatchedPcs: 0,
      movedOffG: 0,
      movedOffPcs: 0,
      lines: [
        makeLine({
          id: "sol-19",
          sectionCode: "12170",
          copyCode: null,
          cutLengthFt: 14,
          qtyBasis: "pcs",
          pcs: so19Pcs,
          kgG: so19Kg,
          weightBasis: "copy_current",
        }),
      ],
      timeline: [{ id: "t19", label: "Confirmed 21 Oct", detail: "PO AN-1901" }],
    },
  ];
}

export function seedYard(): YardLot[] {
  return [
    {
      id: "yard-so12",
      sectionCode: "4521",
      lengthFt: 12,
      pcs: 108,
      kgG: 1_300_000,
      kind: "line",
      orderNumber: "SO-12",
      customerId: "anshu",
      poText: "AN-1842",
    },
    {
      id: "yard-plant-12170",
      sectionCode: "12170",
      lengthFt: 12,
      pcs: 40,
      kgG: orderGrams(40, 12, 5_967),
      kind: "plant",
    },
    {
      id: "yard-old-po",
      sectionCode: "12170",
      lengthFt: 12,
      pcs: 10,
      kgG: orderGrams(10, 12, 5_967),
      kind: "unassigned",
      poText: "OLD-PO-77",
    },
  ];
}

export type StockGroupId = "other_po" | "plant" | "unassigned";

export type StockRow = {
  id: string;
  group: StockGroupId;
  sectionCode: string;
  lengthFt: number;
  pcs: number;
  kgG: number;
  title: string;
  detail: string;
  matches: boolean;
  note: string;
};

export function matchStock(
  yard: readonly YardLot[],
  sectionCode: string,
  lengthFt: number,
): { lead: string | null; rows: StockRow[] } {
  const rows: StockRow[] = [];
  let lead: string | null = null;

  for (const lot of yard) {
    const sameDie = lot.sectionCode === sectionCode;
    const sameLength = lot.lengthFt === lengthFt;
    const matches = sameDie && sameLength;
    const note = matches ? "Matches this line" : sameDie ? "Not this length" : "Not this die";

    if (lot.kind === "line" && lot.orderNumber) {
      const owner = customerName(lot.customerId);
      if (sameDie && !sameLength && lead === null) {
        lead = `${formatKgShort(lot.kgG)} of ${lot.sectionCode} at ${lengthLabel(lot.lengthFt)} is on ${owner}, PO ${lot.poText ?? "—"}. Not this length.`;
      }
      rows.push({
        id: lot.id,
        group: "other_po",
        sectionCode: lot.sectionCode,
        lengthFt: lot.lengthFt,
        pcs: lot.pcs,
        kgG: lot.kgG,
        title: matches
          ? `${formatOrderKg(lot.kgG)} kg · ${formatPcs(lot.pcs)} pcs on PO ${lot.poText ?? "—"} (${owner}). Hold needs a manager — it is another party's PO.`
          : `${formatKgShort(lot.kgG)} · ${formatPcs(lot.pcs)} pcs · PO ${lot.poText ?? "—"} · ${owner}`,
        detail: `${lot.orderNumber} · ${lot.sectionCode} · ${lengthLabel(lot.lengthFt)}`,
        matches,
        note,
      });
      continue;
    }

    if (lot.kind === "plant") {
      rows.push({
        id: lot.id,
        group: "plant",
        sectionCode: lot.sectionCode,
        lengthFt: lot.lengthFt,
        pcs: lot.pcs,
        kgG: lot.kgG,
        title: `${formatOrderKg(lot.kgG)} kg · ${formatPcs(lot.pcs)} pcs · plant stock · no customer`,
        detail: `${lot.sectionCode} · ${lengthLabel(lot.lengthFt)}`,
        matches,
        note,
      });
      continue;
    }

    rows.push({
      id: lot.id,
      group: "unassigned",
      sectionCode: lot.sectionCode,
      lengthFt: lot.lengthFt,
      pcs: lot.pcs,
      kgG: lot.kgG,
      title: `${formatOrderKg(lot.kgG)} kg · ${formatPcs(lot.pcs)} pcs · PO text ${lot.poText ?? "—"} · unassigned, not plant stock`,
      detail: `${lot.sectionCode} · ${lengthLabel(lot.lengthFt)}`,
      matches,
      note,
    });
  }

  return { lead, rows };
}

export function poClash(
  orders: readonly SalesOrder[],
  customerId: string,
  poNumber: string,
  except?: string,
): SalesOrder | undefined {
  const po = poNumber.trim();
  if (!po) return undefined;
  return orders.find(
    (o) => o.number !== except && o.customerId === customerId && o.status !== "cancelled" && o.poNumber === po,
  );
}

export function basisCaption(line: {
  pcs: number;
  bandStartMilli: number;
  copyMilli: number | null;
  copyCode: string | null;
  sectionCode: string;
  cutLengthFt: number;
  weightBasis: WeightBasis;
  basisMilli: number;
}): string {
  const band = orderGrams(line.pcs, line.cutLengthFt, line.bandStartMilli);
  const current = line.copyMilli == null ? null : orderGrams(line.pcs, line.cutLengthFt, line.copyMilli);
  const using = line.weightBasis === "copy_current" ? "current" : "band start";
  const copyBit = line.copyCode ? `copy ${line.copyCode}` : `lightest in band`;
  const currentBit =
    current == null || line.copyMilli == null
      ? "No reading yet — using band start"
      : `${formatOrderKg(current)} kg at ${copyBit} now ${formatMilli(line.copyMilli)}`;
  return `${formatOrderKg(band)} kg at band start ${formatMilli(line.bandStartMilli)} · ${currentBit} · using ${using}`;
}

export function parsePositive(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || n <= 0) return null;
  return n;
}

export type PlanableLine = {
  key: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  poNumber: string;
  sectionCode: string;
  sectionName: string;
  lengthFt: number;
  pcs: number;
  kgG: number;
  standIn: boolean;
  copyCode: string | null;
};

/** Planable placeholder for SO-14's 4521 line while it is still a booking, not yet confirmed. */
export function so14BookingStandIn(): PlanableLine {
  return {
    key: "SO-14-booking",
    orderNumber: "SO-14",
    customerId: "bhavesh",
    customerName: "Bhavesh Traders",
    poNumber: "BH-2026-118",
    sectionCode: "4521",
    sectionName: "4521",
    lengthFt: 18,
    pcs: 30,
    kgG: orderGrams(30, 18, 12_300),
    standIn: true,
    copyCode: "4521-1",
  };
}
