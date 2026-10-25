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
};

/** The two groups in the order the sheet lists them: the order's own stock, then plant stock. */
export function suggestGroups<T extends Pick<Suggested, "group">>(items: readonly T[]): { order: T[]; plant: T[] } {
  return { order: items.filter((i) => i.group === "order"), plant: items.filter((i) => i.group === "plant") };
}

/** The serials "Add all" sends: everything that fits the baki, in the listed order. */
export function addAllSerials(items: readonly Pick<Suggested, "serial" | "fits">[]): string[] {
  return items.filter((i) => i.fits).map((i) => i.serial);
}

/** Most bundles one `addBundlesBySerial` call takes (the server refuses more). */
export const ADD_CHUNK = 100;

export type ChunkedAdd<R> = {
  /** Every report that came back, in order. */
  reports: R[];
  /** Serials sent in calls that came back. */
  sent: number;
  /** The error that stopped the run (the calls after it were never sent), else null. */
  error: unknown;
};

/**
 * "Add all that fit" past 100 bundles (review r1 I-4): one call per ≤ 100 serials, one after the
 * other, each naming the lines the sheet showed for its bundles (`preferLineIds`). Progress is
 * reported after every call; an error stops the run and says how far it got.
 */
export async function addInChunks<R>(
  items: readonly Pick<Suggested & { lineId: string }, "serial" | "lineId">[],
  send: (serials: string[], preferLineIds: string[]) => Promise<R>,
  onProgress?: (done: number, total: number, report: R) => void,
): Promise<ChunkedAdd<R>> {
  const out: ChunkedAdd<R> = { reports: [], sent: 0, error: null };
  for (let i = 0; i < items.length; i += ADD_CHUNK) {
    const part = items.slice(i, i + ADD_CHUNK);
    try {
      const report = await send(
        part.map((p) => p.serial),
        [...new Set(part.map((p) => p.lineId))],
      );
      out.reports.push(report);
      out.sent += part.length;
      onProgress?.(out.sent, items.length, report);
    } catch (error) {
      out.error = error;
      break;
    }
  }
  return out;
}
