/**
 * Dispatch from a sales order (FP-PK-17): what the order panel, the scan screen and the suggest
 * sheet show. Every figure is the server's (`dispatch.getDispatch` `salesOrder.progress`,
 * `dispatch.suggestBundles`); this file only picks serials and counts rows.
 */

export type Progress = {
  bakiG: number;
  bakiPcs: number | null;
  onDispatchG: number;
  onDispatchPcs: number;
  leftG: number;
  leftPcs: number | null;
  overG: number;
};

/** Kg still to send after this load, or "over" when the load passes the order's baki. */
export function orderState(p: Pick<Progress, "bakiG" | "onDispatchG" | "overG">): "empty" | "open" | "done" | "over" {
  if (p.overG > 0) return "over";
  if (p.onDispatchG === 0) return "empty";
  return p.bakiG > p.onDispatchG ? "open" : "done";
}

export type LinkedItem = { orderId?: string | null; orderNumber?: string | null };

/** Bundles on this load that went to a line of ANOTHER order of this party (named so the office can see it). */
export function otherOrderItems<T extends LinkedItem>(items: readonly T[], orderId: string): { count: number; orders: string[] } {
  const orders = new Set<string>();
  let count = 0;
  for (const it of items) {
    if (it.orderId && it.orderId !== orderId) {
      count += 1;
      if (it.orderNumber) orders.add(it.orderNumber);
    }
  }
  return { count, orders: [...orders] };
}

export type Suggested = {
  id: string;
  serial: string;
  group: "order" | "plant";
  weightG: number;
  pcs: number;
  fits: boolean;
  unassigned: boolean;
};

/** The two groups in the order the sheet lists them: the order's own stock, then plant stock. */
export function suggestGroups<T extends Pick<Suggested, "group">>(items: readonly T[]): { order: T[]; plant: T[] } {
  return { order: items.filter((i) => i.group === "order"), plant: items.filter((i) => i.group === "plant") };
}

/** The serials "Add all" sends: everything that fits the baki, in the listed order. */
export function addAllSerials(items: readonly Pick<Suggested, "serial" | "fits">[]): string[] {
  return items.filter((i) => i.fits).map((i) => i.serial);
}

/** Whether adding these needs the office's `allowUnassigned` (a bundle on no order line). */
export function needsAllowUnassigned(items: readonly Pick<Suggested, "serial" | "fits" | "unassigned">[], serials: readonly string[]): boolean {
  const set = new Set(serials);
  return items.some((i) => set.has(i.serial) && i.unassigned);
}
