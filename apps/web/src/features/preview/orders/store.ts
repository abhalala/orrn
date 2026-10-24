import { useSyncExternalStore } from "react";

import {
  customerName,
  dieByCode,
  dieTitle,
  formatKgShort,
  lightestCopy,
  seedOrders,
  seedYard,
  so14BookingStandIn,
  stripFor,
  yardOnOrder,
  type HoldPending,
  type OrderLine,
  type PlanableLine,
  type SalesOrder,
  type YardLot,
} from "./fixtures";

export type PlanParty = {
  key: string;
  orderNumber: string;
  customerName: string;
  poNumber: string;
  lengthFt: number;
  pcs: number;
  kgG: number;
  copyCode: string | null;
};

export type PlanDie = {
  sectionCode: string;
  name: string;
  urgent: boolean;
  sortOrder: number;
  lines: PlanParty[];
};

export type QueuedRun = {
  number: string;
  sectionCode: string;
  name: string;
  started: boolean;
};

export type ReallocateState = {
  status: "none" | "pending" | "applied";
  destination: "plant" | "bhavesh" | null;
  reason: string;
};

export type DemoState = {
  orders: SalesOrder[];
  yard: YardLot[];
  holdPending: HoldPending | null;
  reallocate: ReallocateState;
  plantNote: string | null;
  planStatus: "draft" | "released";
  planDies: PlanDie[];
  planRuns: QueuedRun[];
  /** Set when the planner has used the reorder buttons. That order then wins over urgent. */
  planManualOrder: boolean;
  planError: string | null;
  nextSo: number;
  nextPr: number;
  nextLine: number;
};

function seedState(): DemoState {
  return {
    orders: seedOrders(),
    yard: seedYard(),
    holdPending: null,
    reallocate: { status: "none", destination: null, reason: "" },
    plantNote: null,
    planStatus: "draft",
    planDies: [],
    planRuns: [],
    planManualOrder: false,
    planError: null,
    nextSo: 20,
    nextPr: 43,
    nextLine: 30,
  };
}

let state = seedState();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: DemoState) {
  state = next;
  emit();
}

export function getOrdersDemo(): DemoState {
  return state;
}

export function subscribeOrdersDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOrdersDemo(): DemoState {
  return useSyncExternalStore(subscribeOrdersDemo, getOrdersDemo, getOrdersDemo);
}

export function resetOrdersDemo() {
  commit(seedState());
}

function patchOrder(orders: SalesOrder[], number: string, patch: (order: SalesOrder) => SalesOrder): SalesOrder[] {
  return orders.map((order) => (order.number === number ? patch(order) : order));
}

export function saveBooking(input: {
  customerId: string;
  poNumber: string;
  finish: OrderLine["finish"];
  line: Omit<OrderLine, "id" | "finish">;
  holdNote: string | null;
}): string {
  const number = `SO-${state.nextSo}`;
  const line: OrderLine = { ...input.line, id: `sol-${state.nextLine}`, finish: input.finish };
  const order: SalesOrder = {
    number,
    customerId: input.customerId,
    poNumber: input.poNumber.trim(),
    status: "booking",
    orderDateLabel: "24 Oct 2026",
    lines: [line],
    timeline: [
      {
        id: `t-${number}-saved`,
        label: "Saved as booking 24 Oct",
        detail: input.holdNote ?? "Office booking · not confirmed",
      },
    ],
    dispatchedG: 0,
    dispatchedPcs: 0,
    movedOffG: 0,
    movedOffPcs: 0,
    openDetail: true,
    savedNotice: "Saved as booking. Confirm when the PO number is filled.",
  };
  commit({
    ...state,
    orders: [...state.orders, order],
    nextSo: state.nextSo + 1,
    nextLine: state.nextLine + 1,
  });
  return number;
}

export function dismissNotice(number: string) {
  commit({
    ...state,
    orders: patchOrder(state.orders, number, (order) => ({ ...order, savedNotice: null })),
  });
}

export function confirmOrder(number: string): string | null {
  const order = state.orders.find((o) => o.number === number);
  if (!order) return "That sales order is not in this sample.";
  if (order.status !== "booking") return "Only a booking can be confirmed.";
  if (!order.poNumber.trim()) return "Confirm when the PO number is filled.";
  const clash = state.orders.find(
    (o) =>
      o.number !== number &&
      o.customerId === order.customerId &&
      o.status !== "cancelled" &&
      o.poNumber === order.poNumber,
  );
  if (clash) return `${order.poNumber} is already open on ${clash.number}. Confirm stays blocked.`;
  const line = order.lines[0];
  if (!line || line.pcs < 1 || line.kgG < 1 || !line.alloy.trim() || !line.temper.trim()) {
    return "Each line needs pieces, kg, alloy and temper before confirm.";
  }
  if (!line.copyCode) return "A copy is required before confirm.";
  commit({
    ...state,
    orders: patchOrder(state.orders, number, (current) => ({
      ...current,
      status: "confirmed",
      savedNotice: null,
      timeline: [
        ...current.timeline,
        { id: `t-${number}-confirmed`, label: "Confirmed 24 Oct", detail: `PO ${current.poNumber}` },
      ],
    })),
  });
  return null;
}

export function requestHold(hold: HoldPending) {
  commit({ ...state, holdPending: hold });
}

export function requestReallocate(destination: "plant" | "bhavesh", reason: string): string | null {
  const stock = yardOnOrder(state.yard, "SO-12");
  if (stock.g <= 0) return "Nothing in stock on SO-12 to move.";
  if (!reason.trim()) return "Enter a reason for the move.";
  if (destination === "plant") {
    return applyMove("plant", reason.trim());
  }
  commit({
    ...state,
    reallocate: { status: "pending", destination: "bhavesh", reason: reason.trim() },
    holdPending: null,
  });
  return null;
}

function applyMove(destination: "plant" | "bhavesh", reason: string): string | null {
  const lot = state.yard.find((l) => l.kind === "line" && l.orderNumber === "SO-12");
  if (!lot) return "Nothing in stock on SO-12 to move.";

  let orders = state.orders;
  let yard = state.yard.filter((l) => l.id !== lot.id);
  let plantNote = state.plantNote;
  const timelineDetail =
    destination === "plant"
      ? `${formatKgShort(lot.kgG)} is plant stock, not a customer. ${reason}`
      : `Moved to Bhavesh · ${reason}`;

  if (destination === "plant") {
    yard = [
      ...yard,
      {
        ...lot,
        id: `${lot.id}-plant`,
        kind: "plant",
        orderNumber: undefined,
        customerId: undefined,
        poText: undefined,
      },
    ];
    plantNote = "1,300 kg is plant stock, not a customer";
  } else {
    orders = patchOrder(orders, "SO-14", (order) => ({
      ...order,
      lines: [
        ...order.lines,
        {
          id: `sol-moved-${state.nextLine}`,
          sectionCode: lot.sectionCode,
          copyCode: "4521-1",
          cutLengthFt: lot.lengthFt,
          qtyBasis: "kg",
          pcs: lot.pcs,
          kgG: lot.kgG,
          impliedG: lot.kgG,
          weightBasis: "band_start",
          basisMilli: 12_000,
          bandStartMilli: 12_000,
          copyMilli: 12_300,
          alloy: "6063",
          temper: "T6",
          finish: "none",
          received: true,
        },
      ],
      timeline: [
        ...order.timeline,
        { id: `t-14-received-${lot.id}`, label: "Received from SO-12", detail: formatKgShort(lot.kgG) },
      ],
    }));
  }

  orders = patchOrder(orders, "SO-12", (order) => ({
    ...order,
    movedOffG: order.movedOffG + lot.kgG,
    movedOffPcs: order.movedOffPcs + lot.pcs,
    timeline: [
      ...order.timeline,
      {
        id: `t-12-moved-${lot.id}`,
        label: destination === "plant" ? "Moved to plant stock" : "Moved to Bhavesh",
        detail: timelineDetail,
      },
    ],
  }));

  commit({
    ...state,
    orders,
    yard,
    plantNote,
    holdPending: null,
    reallocate:
      destination === "bhavesh"
        ? { status: "applied", destination, reason }
        : { status: "none", destination: null, reason: "" },
    nextLine: state.nextLine + 1,
  });
  return null;
}


export function applyReallocateAsManager(): string | null {
  if (state.reallocate.status !== "pending" || state.reallocate.destination !== "bhavesh") {
    return "Nothing is waiting for a manager.";
  }
  return applyMove("bhavesh", state.reallocate.reason);
}

export function plannedQty(demo: DemoState, key: string): { g: number; pcs: number } {
  let g = 0;
  let pcs = 0;
  for (const die of demo.planDies) {
    for (const line of die.lines) {
      if (line.key === key) {
        g += line.kgG;
        pcs += line.pcs;
      }
    }
  }
  return { g, pcs };
}

export function planableLines(demo: DemoState): PlanableLine[] {
  const lines: PlanableLine[] = [];
  let so14Confirmed4521 = false;

  for (const order of demo.orders) {
    if (order.status !== "confirmed" && order.status !== "dispatching") continue;
    if (order.number === "SO-12") continue;
    for (const line of order.lines) {
      if (line.received) continue;
      const planned = plannedQty(demo, `${order.number}:${line.id}`);
      const strip = stripFor(order, demo.yard, planned);
      if (order.number === "SO-14" && line.sectionCode === "4521" && line.cutLengthFt === 18) {
        so14Confirmed4521 = true;
      }
      if (strip.planableG <= 0) continue;
      const die = dieByCode(line.sectionCode);
      lines.push({
        key: `${order.number}:${line.id}`,
        orderNumber: order.number,
        customerId: order.customerId,
        customerName: customerName(order.customerId),
        poNumber: order.poNumber,
        sectionCode: line.sectionCode,
        sectionName: die ? dieTitle(die) : line.sectionCode,
        lengthFt: line.cutLengthFt,
        pcs: strip.planablePcs,
        kgG: strip.planableG,
        standIn: false,
        copyCode: line.copyCode,
      });
    }
  }

  if (!so14Confirmed4521) {
    const standIn = so14BookingStandIn();
    const planned = plannedQty(demo, standIn.key);
    if (standIn.kgG - planned.g > 0) {
      lines.push({ ...standIn, pcs: standIn.pcs - planned.pcs, kgG: standIn.kgG - planned.g });
    }
  }

  return lines;
}

export function so12PlanNote(demo: DemoState): { kgG: number; pcs: number; planableG: number } {
  const order = demo.orders.find((o) => o.number === "SO-12");
  if (!order) return { kgG: 0, pcs: 0, planableG: 0 };
  const stock = yardOnOrder(demo.yard, "SO-12");
  const strip = stripFor(order, demo.yard);
  return { kgG: stock.g, pcs: stock.pcs, planableG: strip.planableG };
}

export function addPlanLine(key: string): string | null {
  if (state.planStatus !== "draft") return "Release is already out. Cancel it before adding lines.";
  const line = planableLines(state).find((l) => l.key === key);
  if (!line) return "That line is not planable.";
  const die = dieByCode(line.sectionCode);
  const name = die ? dieTitle(die) : line.sectionCode;
  const party: PlanParty = {
    key: line.key,
    orderNumber: line.orderNumber,
    customerName: line.customerName,
    poNumber: line.poNumber,
    lengthFt: line.lengthFt,
    pcs: line.pcs,
    kgG: line.kgG,
    copyCode: line.copyCode ?? (die ? lightestCopy(die).code : null),
  };
  const existing = state.planDies.find((d) => d.sectionCode === line.sectionCode);
  const planDies = existing
    ? state.planDies.map((d) =>
        d.sectionCode === line.sectionCode ? { ...d, lines: [...d.lines, party] } : d,
      )
    : [
        ...state.planDies,
        {
          sectionCode: line.sectionCode,
          name,
          urgent: false,
          sortOrder: state.planDies.length,
          lines: [party],
        },
      ];
  commit({ ...state, planDies, planError: null });
  return null;
}

export function removePlanLine(key: string) {
  if (state.planStatus !== "draft") return;
  const planDies = state.planDies
    .map((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }))
    .filter((d) => d.lines.length > 0)
    .map((d, i) => ({ ...d, sortOrder: i }));
  commit({ ...state, planDies, planError: null });
}

export function toggleUrgent(sectionCode: string) {
  if (state.planStatus !== "draft") return;
  commit({
    ...state,
    planDies: state.planDies.map((d) => (d.sectionCode === sectionCode ? { ...d, urgent: !d.urgent } : d)),
  });
}

export function moveDie(sectionCode: string, dir: -1 | 1) {
  if (state.planStatus !== "draft") return;
  const ordered = sortedDies(state);
  const index = ordered.findIndex((d) => d.sectionCode === sectionCode);
  const swap = index + dir;
  if (index < 0 || swap < 0 || swap >= ordered.length) return;
  const next = [...ordered];
  const a = next[index]!;
  const b = next[swap]!;
  next[index] = b;
  next[swap] = a;
  commit({
    ...state,
    planManualOrder: true,
    planDies: next.map((d, i) => ({ ...d, sortOrder: i })),
  });
}

export function sortedDies(demo: DemoState): PlanDie[] {
  return [...demo.planDies].sort((a, b) => {
    if (!demo.planManualOrder && a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

export function releasePlan(): string | null {
  if (state.planDies.length === 0) return "Add at least one die before release.";
  if (state.planStatus === "released") return "PP-3 is already released.";
  const dies = sortedDies(state);
  const runs: QueuedRun[] = dies.map((d, i) => ({
    number: `PR-${state.nextPr + i}`,
    sectionCode: d.sectionCode,
    name: d.name,
    started: false,
  }));
  commit({
    ...state,
    planStatus: "released",
    planRuns: runs,
    planError: null,
    nextPr: state.nextPr + runs.length,
  });
  return null;
}

export function cancelPlan(): string | null {
  if (state.planStatus !== "released") return "PP-3 is still a draft.";
  if (state.planRuns.some((r) => r.started)) {
    const message = "A started run cannot be cancelled from the plan.";
    commit({ ...state, planError: message });
    return message;
  }
  commit({ ...state, planStatus: "draft", planRuns: [], planError: null });
  return null;
}

export function markRunStarted(number: string) {
  commit({
    ...state,
    planRuns: state.planRuns.map((r) => (r.number === number ? { ...r, started: true } : r)),
    planError: null,
  });
}


export function orderByNumber(demo: DemoState, number: string): SalesOrder | undefined {
  return demo.orders.find((o) => o.number === number);
}

export function bhavesh12ftLine(demo: DemoState): { orderNumber: string; lineId: string } | null {
  for (const order of demo.orders) {
    if (order.customerId !== "bhavesh") continue;
    for (const line of order.lines) {
      if (line.sectionCode === "4521" && line.cutLengthFt === 12) {
        return { orderNumber: order.number, lineId: line.id };
      }
    }
  }
  return null;
}

export function so12Stock(demo: DemoState): { g: number; pcs: number } {
  return yardOnOrder(demo.yard, "SO-12");
}

export function balanceOf(demo: DemoState, order: SalesOrder): { g: number; pcs: number } {
  return { g: stripFor(order, demo.yard).bakiG, pcs: stripFor(order, demo.yard).bakiPcs };
}

