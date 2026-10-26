/**
 * Purchase charts (analytics addendum: "Purchase (PL-W2): vendor rate trend +
 * kg by vendor"), computed from `purchase.register` rows. Cancelled lots never
 * count. Rates are weighted by party kg (what the bill is made on).
 */

export type RegisterLot = {
  lotDate: string;
  status: string;
  vendorId: string;
  vendorName: string;
  scrapItemId: string;
  itemName: string;
  partyKgG: number;
  ratePaise: number;
};

export type RatePoint = { month: string; v: number; partial?: boolean };
export type RateSeries = { key: string; label: string; points: RatePoint[] };
export type VendorRow = { key: string; label: string; value: number; share: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Six calendar months ending on `today` (the company's book date), as register bounds. */
export function chartWindow(today: string): { from: string; to: string; months: string[] } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    months.push(`${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`);
  }
  return { from: `${months[0]}-01`, to: today, months };
}

const live = (lots: readonly RegisterLot[]) => lots.filter((l) => l.status !== "cancelled");

/**
 * Average rupees per kg by month for the items bought most (by party kg), one
 * series each. The last month of the window is the open month: `partial`.
 * Months with no lots of an item have no point (a gap, never a zero rate).
 */
export function monthlyRates(lots: readonly RegisterLot[], months: readonly string[], opts: { maxSeries: number }): RateSeries[] {
  const inWindow = new Set(months);
  const open = months[months.length - 1];
  const byItem = new Map<string, { label: string; kgG: number; months: Map<string, { kgG: number; amount: number }> }>();
  for (const l of live(lots)) {
    const month = l.lotDate.slice(0, 7);
    if (!inWindow.has(month)) continue;
    const item = byItem.get(l.scrapItemId) ?? { label: l.itemName, kgG: 0, months: new Map() };
    item.kgG += l.partyKgG;
    const cell = item.months.get(month) ?? { kgG: 0, amount: 0 };
    cell.kgG += l.partyKgG;
    cell.amount += l.partyKgG * l.ratePaise;
    item.months.set(month, cell);
    byItem.set(l.scrapItemId, item);
  }
  return [...byItem.entries()]
    .sort((a, b) => b[1].kgG - a[1].kgG || a[1].label.localeCompare(b[1].label))
    .slice(0, opts.maxSeries)
    .map(([key, item]) => ({
      key,
      label: item.label,
      points: months
        .filter((month) => item.months.has(month))
        .map((month) => {
          const cell = item.months.get(month)!;
          const rupees = Math.round(cell.amount / cell.kgG) / 100;
          return month === open ? { month, v: rupees, partial: true } : { month, v: rupees };
        }),
    }));
}

/** Party kg bought per vendor (kg, not grams), biggest first, with each vendor's share of the total in %. */
export function kgByVendor(lots: readonly RegisterLot[]): VendorRow[] {
  const byVendor = new Map<string, { label: string; kgG: number }>();
  for (const l of live(lots)) {
    const row = byVendor.get(l.vendorId) ?? { label: l.vendorName, kgG: 0 };
    row.kgG += l.partyKgG;
    byVendor.set(l.vendorId, row);
  }
  const total = [...byVendor.values()].reduce((s, r) => s + r.kgG, 0);
  if (total === 0) return [];
  return [...byVendor.entries()]
    .sort((a, b) => b[1].kgG - a[1].kgG || a[1].label.localeCompare(b[1].label))
    .map(([key, r]) => ({ key, label: r.label, value: r.kgG / 1000, share: (r.kgG / total) * 100 }));
}
