/**
 * The filters shared by the stock tabs (FP-PK-08, BACKLOG 36): yard, customer, sales order, plant stock,
 * hollow / solid / semi, packed date and one section. They live in the URL (Back and shared links keep
 * the view) and map onto the server's inputs of `stock.byDieLength`, `stock.byYard` and
 * `bundle.listBundles`, which count and total them, so the tabs always agree. Pure: no router, no zod.
 */
export const PROFILE_KINDS = ["hollow", "solid", "semi"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export type StockFilter = {
  yard?: string;
  customer?: string;
  order?: string;
  /** Plant stock only. */
  plant?: true;
  kind?: ProfileKind;
  /** Packed on or after (company calendar day, yyyy-mm-dd). */
  from?: string;
  /** Packed on or before. */
  to?: string;
  dieId?: string;
};

const MAX_ID = 64;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const id = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= MAX_ID ? v : undefined);
const day = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !DAY.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
};

/** The filter fields of a raw URL search object; anything unknown or malformed is dropped. */
export function validateStockFilter(raw: Record<string, unknown>): StockFilter {
  const out: StockFilter = {};
  const yard = id(raw.yard);
  const customer = id(raw.customer);
  const order = id(raw.order);
  const dieId = id(raw.dieId);
  const from = day(raw.from);
  const to = day(raw.to);
  if (yard) out.yard = yard;
  if (customer) out.customer = customer;
  // An order is a line of one customer's: it needs the customer the screen narrowed to first.
  if (order && customer) out.order = order;
  if (raw.plant === true || raw.plant === 1 || raw.plant === "1" || raw.plant === "true") out.plant = true;
  if (typeof raw.kind === "string" && (PROFILE_KINDS as readonly string[]).includes(raw.kind)) out.kind = raw.kind as ProfileKind;
  if (from) out.from = from;
  if (to) out.to = to;
  if (dieId) out.dieId = dieId;
  return out;
}

/** What the server calls them. A date range given backwards is swapped, never sent empty. */
export function stockFilterInput(f: StockFilter): {
  locationId?: string;
  customerId?: string;
  salesOrderId?: string;
  plantStock?: true;
  profileKind?: ProfileKind;
  packedFrom?: string;
  packedTo?: string;
  dieId?: string;
} {
  const [packedFrom, packedTo] = f.from && f.to && f.from > f.to ? [f.to, f.from] : [f.from, f.to];
  return {
    ...(f.yard ? { locationId: f.yard } : {}),
    ...(f.customer ? { customerId: f.customer } : {}),
    ...(f.order ? { salesOrderId: f.order } : {}),
    ...(f.plant ? { plantStock: true as const } : {}),
    ...(f.kind ? { profileKind: f.kind } : {}),
    ...(packedFrom ? { packedFrom } : {}),
    ...(packedTo ? { packedTo } : {}),
    ...(f.dieId ? { dieId: f.dieId } : {}),
  };
}

/** How many filters are on (the "Clear" button's count). */
export function activeFilterCount(f: StockFilter): number {
  return Object.values(f).filter((v) => v !== undefined).length;
}

/** The search object with every filter field removed (other keys, such as `status`, stay). */
export function withoutFilters<T extends StockFilter>(search: T): T {
  const { yard: _y, customer: _c, order: _o, plant: _p, kind: _k, from: _f, to: _t, dieId: _d, ...rest } = search;
  return rest as unknown as T;
}

/**
 * Setting the customer clears an order of another customer; plant stock and a customer exclude each
 * other (plant stock has no customer). Returns the patch to merge into the search.
 */
export function filterPatch(current: StockFilter, change: Partial<StockFilter>): Partial<StockFilter> {
  const patch: Partial<StockFilter> = { ...change };
  if ("customer" in change && change.customer !== current.customer) patch.order = undefined;
  if (change.customer) patch.plant = undefined;
  if (change.plant) {
    patch.customer = undefined;
    patch.order = undefined;
  }
  return patch;
}
