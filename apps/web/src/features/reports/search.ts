/**
 * Search params of the `/reports/*` pages. Plain functions (no zod): `validateSearch` stays in the
 * route entry chunk (AGENTS.md "Web bundle"), so this module imports nothing heavy.
 */
import { parseReportSearch, type ReportSearch } from "../press/search";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pickId = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : undefined);
const isTrue = (v: unknown) => v === true || v === "true" || v === "1" || v === 1;

export type RecoveryGroupSearch = "die" | "copy" | "press" | "shift";
export type ProductionSearch = ReportSearch & { group?: RecoveryGroupSearch };

export function parseProductionSearch(raw: Record<string, unknown>): ProductionSearch {
  const out: ProductionSearch = parseReportSearch(raw);
  if (raw.group === "die" || raw.group === "copy" || raw.group === "press" || raw.group === "shift") out.group = raw.group;
  return out;
}

export type DieLifeSearch = { all?: boolean; retired?: boolean };

/** Default: copies with a life set only; `all` shows every copy, `retired` adds retired ones. */
export function parseDieLifeSearch(raw: Record<string, unknown>): DieLifeSearch {
  const out: DieLifeSearch = {};
  if (isTrue(raw.all)) out.all = true;
  if (isTrue(raw.retired)) out.retired = true;
  return out;
}

export type StockAgeSearch = { plant?: boolean; party?: string };

export function parseStockAgeSearch(raw: Record<string, unknown>): StockAgeSearch {
  const out: StockAgeSearch = {};
  if (isTrue(raw.plant)) out.plant = true;
  else {
    const party = pickId(raw.party);
    if (party) out.party = party;
  }
  return out;
}

export type OrdersReportSearch = {
  group?: "customer" | "month";
  party?: string;
  open?: boolean;
  late?: boolean;
  from?: string;
  to?: string;
  rates?: boolean;
};

export function parseOrdersReportSearch(raw: Record<string, unknown>): OrdersReportSearch {
  const out: OrdersReportSearch = {};
  if (raw.group === "customer" || raw.group === "month") out.group = raw.group;
  const party = pickId(raw.party);
  if (party) out.party = party;
  if (isTrue(raw.open)) out.open = true;
  if (isTrue(raw.late)) out.late = true;
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  if (isTrue(raw.rates)) out.rates = true;
  return out;
}
