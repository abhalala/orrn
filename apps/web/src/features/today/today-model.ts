/**
 * Pure model for the Today screen (spec §3 "Today", plan Task 19): the plant
 * clock, the in-stock total, the chart series and the role-aware tiles and
 * "Start here" steps. No React here, so it is unit-tested directly.
 */
import type { MessageKey } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { can, type Me } from "@orrn/server/lib/permissions";
import type { inferRouterOutputs } from "@trpc/server";
import { BookOpen, PackagePlus, Truck, Warehouse } from "lucide-react";

import { visibleItems, type NavItem } from "@/shell/nav-items";

type Outputs = inferRouterOutputs<AppRouter>;
export type TodayData = Outputs["dashboard"]["today"];
export type TrendDay = Outputs["analytics"]["trends"][number];
export type StockAgeingData = Outputs["analytics"]["stockAgeing"];
export type AgeBucket = StockAgeingData["buckets"][number];

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** "Good morning" until noon, "Good afternoon" until 5 pm, then "Good evening". */
export function greetingKey(hour: number): MessageKey {
  if (hour < 12) return "today.greetingMorning";
  if (hour < 17) return "today.greetingAfternoon";
  return "today.greetingEvening";
}

function validZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * The plant's wall clock: the hour (for the greeting) and today's long date
 * ("Saturday, 3 October"), read in the company time zone so a phone set to
 * another zone still greets the shift correctly. Digits stay Latin in Hindi.
 */
export function companyClock(timezone: string, nowMs: number, locale: string): { hour: number; date: string } {
  const timeZone = validZone(timezone);
  const at = new Date(nowMs);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at),
  );
  const date = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
    numberingSystem: "latn",
  }).format(at);
  return { hour, date };
}

/**
 * A count with Indian grouping ("1,284", "1,00,000") for display and for
 * `t()` plural variables: `{count:one|other}` still picks "one" only for "1".
 */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** Bundles in stock right now: available plus held for a dispatch. */
export function inStock(stock: TodayData["stock"]): { bundles: number; kg: number } {
  const bundles = stock.available.bundles + stock.reserved.bundles;
  const grams = stock.available.weightG + stock.reserved.weightG;
  return { bundles, kg: grams / 1000 };
}

export type TrendPoint = { t: Date; v: number; partial?: boolean };
export type TrendSeries = { key: "packed" | "dispatched"; label: string; points: TrendPoint[] };

/**
 * Packed vs dispatched kg per day for the trend chart. Each `YYYY-MM-DD`
 * becomes UTC midnight (format it with `timeZone: "UTC"` so the label is
 * always that calendar day). The server lists today last; today is still
 * open, so its point is `partial` and reads "so far".
 */
export function trendSeries(days: readonly TrendDay[], labels: { packed: string; dispatched: string }): TrendSeries[] {
  const last = days.length - 1;
  const point = (d: TrendDay, i: number, grams: number): TrendPoint => ({
    t: new Date(`${d.date}T00:00:00Z`),
    v: grams / 1000,
    ...(i === last ? { partial: true } : {}),
  });
  return [
    { key: "packed", label: labels.packed, points: days.map((d, i) => point(d, i, d.packedKgG)) },
    { key: "dispatched", label: labels.dispatched, points: days.map((d, i) => point(d, i, d.dispatchedKgG)) },
  ];
}

export type AgeBar = { key: string; label: string; short: string; value: number };

/** One bar per age bucket (youngest first), kg from grams. */
export function ageingBars(
  buckets: readonly AgeBucket[],
  name: (key: AgeBucket["key"]) => { label: string; short: string },
): AgeBar[] {
  return buckets.map((b) => ({ key: b.key, ...name(b.key), value: b.kgG / 1000 }));
}

export type Setup = TodayData["setup"];

/** An empty plant (no die or no bundle yet) sees "Start here" instead of empty widgets. */
export function needsStartHere(setup: Setup): boolean {
  return !setup.dies || !setup.bundles;
}

export type StartHereStep = {
  key: "die" | "customer" | "pack" | "printer";
  labelKey: MessageKey;
  done: boolean;
  /** Where to do it, or null when this person's role can't. */
  to: string | null;
};

export function startHereSteps(setup: Setup, me: Me | null | undefined): StartHereStep[] {
  const step = (
    key: StartHereStep["key"],
    labelKey: MessageKey,
    done: boolean,
    to: string,
    allowed: boolean,
  ): StartHereStep => ({ key, labelKey, done, to: allowed ? to : null });
  return [
    step("die", "today.startHere.addDie", setup.dies, "/dies", can(me, "die.create")),
    step("customer", "today.startHere.addCustomer", setup.customers, "/customers", can(me, "customer.create")),
    step("pack", "today.startHere.packFirst", setup.bundles, "/pack/new", can(me, "bundle.create")),
    step("printer", "today.startHere.connectPrinter", setup.printers, "/printing", can(me, "spool.manage_printers")),
  ];
}

export type TodayTile = NavItem & { key: "pack" | "dispatch" | "stock" | "guides"; hintKey: MessageKey };

/**
 * Action tiles in spec order. Pack needs `bundle.create`, Dispatch needs
 * `dispatch.create` or `dispatch.addBundle` (operators scan into one the
 * office started); Stock and Guides ride along with them. Company modules
 * hide tiles for areas the plant has switched off, as in the nav.
 */
const TILES: readonly TodayTile[] = [
  {
    key: "pack",
    to: "/pack/new",
    labelKey: "today.tiles.pack",
    hintKey: "today.tiles.packHint",
    icon: PackagePlus,
    requires: ["bundle.create"],
    module: "bundles",
  },
  {
    key: "dispatch",
    to: "/dispatch",
    labelKey: "today.tiles.dispatch",
    hintKey: "today.tiles.dispatchHint",
    icon: Truck,
    requires: ["dispatch.create", "dispatch.addBundle"],
    module: "dispatches",
  },
  {
    key: "stock",
    to: "/stock",
    labelKey: "today.tiles.stock",
    hintKey: "today.tiles.stockHint",
    icon: Warehouse,
    module: "bundles",
  },
  { key: "guides", to: "/guides", labelKey: "today.tiles.guides", hintKey: "today.tiles.guidesHint", icon: BookOpen },
];

const ACTION_TILES: ReadonlySet<TodayTile["key"]> = new Set(["pack", "dispatch"]);

/**
 * The tiles this person sees. Spec section 3 Today: "Viewers see no action
 * tiles, only numbers", so anyone left without a Pack or Dispatch tile
 * (viewer, accountant, foundry, or an area switched off) gets none at all;
 * the nav still reaches Stock and Guides.
 */
export function todayTiles(me: Me | null | undefined): TodayTile[] {
  const tiles = visibleItems(TILES, me) as TodayTile[];
  return tiles.some((tile) => ACTION_TILES.has(tile.key)) ? tiles : [];
}
