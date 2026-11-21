/** Limits form state (Godseye company tab "Limits", limits brief section A). Pure: tested without React. */
import { withoutGrouping } from "@orrn/domain";
import {
  bandReadsFor,
  PLANT_LIMIT_KEYS,
  PLANT_LIMITS,
  type PlantLimitKey,
  type PlantLimitsSet,
} from "@orrn/server/lib/plantLimits";

export { PLANT_LIMIT_KEYS, PLANT_LIMITS, type PlantLimitKey, type PlantLimitsSet };

/** The money limit: stored in US cents, typed and shown in dollars. */
export const MONEY_KEY: PlantLimitKey = "dayModelCostCents";

/**
 * One text per limit: what the box shows. `null` means "Use default" (the key is removed on save, and the
 * box shows the default).
 */
export type LimitsDraft = Record<PlantLimitKey, string | null>;

/** A limit's value as typed in its box: dollars with cents for money, plain digits for the rest. */
export function limitText(key: PlantLimitKey, value: number): string {
  return key === MONEY_KEY ? (value / 100).toFixed(2) : String(value);
}

/** The unit a limit is typed and read in, after the number (decision 3: file size in MB, plant storage in GB). */
export const LIMIT_UNITS: Partial<Record<PlantLimitKey, string>> = { uploadFileMiB: "MB", vaultQuotaGiB: "GB" };

/** A limit's value as read on the page: "$5.00", "200,000", "2,048 MB". */
export function limitWords(key: PlantLimitKey, value: number): string {
  if (key === MONEY_KEY) return `$${(value / 100).toFixed(2)}`;
  const n = new Intl.NumberFormat("en-US").format(value);
  const unit = LIMIT_UNITS[key];
  return unit ? `${n} ${unit}` : n;
}

/** The value a box holds, or null when it is not a value from 1 to the ceiling. Money is read in dollars, to the cent. */
export function parseLimit(key: PlantLimitKey, text: string): number | null {
  const cleaned = withoutGrouping(text);
  if (cleaned === null) return null;
  let n: number;
  if (key === MONEY_KEY) {
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return null;
    n = Math.round(Number(cleaned) * 100);
  } else {
    if (!/^\d+$/.test(cleaned)) return null;
    n = Number(cleaned);
  }
  return Number.isSafeInteger(n) && n >= 1 && n <= PLANT_LIMITS[key].ceiling ? n : null;
}

/** The form as saved: set keys show their value, the rest "Use default". */
export function initialDraft(set: PlantLimitsSet): LimitsDraft {
  const out = {} as LimitsDraft;
  for (const key of PLANT_LIMIT_KEYS) {
    const v = set[key];
    out[key] = v === undefined ? null : limitText(key, v);
  }
  return out;
}

/** What a box shows: its own text, or the default when it uses the default. */
export function boxText(key: PlantLimitKey, draft: LimitsDraft): string {
  return draft[key] ?? limitText(key, PLANT_LIMITS[key].default);
}

/**
 * The change to save (`platform.companiesSetLimits` `limits`): only keys that differ from what is saved, a
 * number to set and null to go back to the default. `invalid` lists the boxes that hold no allowed value;
 * nothing may be saved while it is not empty.
 */
export function limitsChange(set: PlantLimitsSet, draft: LimitsDraft): { change: Record<string, number | null>; invalid: PlantLimitKey[] } {
  const change: Record<string, number | null> = {};
  const invalid: PlantLimitKey[] = [];
  for (const key of PLANT_LIMIT_KEYS) {
    const text = draft[key];
    const saved = set[key];
    if (text === null) {
      if (saved !== undefined) change[key] = null;
      continue;
    }
    const n = parseLimit(key, text);
    if (n === null) {
      invalid.push(key);
      continue;
    }
    if (n !== saved) change[key] = n;
  }
  return { change, invalid };
}

/** The day cost in cents the box stands for now (the default when it uses the default or holds no value). */
export function draftCostCents(draft: LimitsDraft): number {
  const text = draft[MONEY_KEY];
  return (text === null ? null : parseLimit(MONEY_KEY, text)) ?? PLANT_LIMITS[MONEY_KEY].default;
}

/** Roughly how many dense page parts the day cost pays for, at about 0.07 dollars a part read. */
export function costBuys(costCents: number): number {
  return bandReadsFor(costCents);
}

/**
 * What the day spend buys (decision 11): the smaller of the parts the money pays for and the model calls a day, as the
 * boxes hold them now, and which limit stops first. Null while either box holds no allowed value (N9): the line then
 * says nothing rather than a default in its place.
 */
export function spendBuys(draft: LimitsDraft): { count: number; stop: "cost" | "calls" } | null {
  const value = (key: PlantLimitKey): number | null => {
    const text = draft[key];
    return text === null ? PLANT_LIMITS[key].default : parseLimit(key, text);
  };
  const cents = value(MONEY_KEY);
  const calls = value("dayModelCalls");
  if (cents === null || calls === null) return null;
  const byCost = costBuys(cents);
  return calls < byCost ? { count: calls, stop: "calls" } : { count: byCost, stop: "cost" };
}
