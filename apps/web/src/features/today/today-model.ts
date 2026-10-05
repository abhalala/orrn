/**
 * Pure model for the Today screen (spec §3 "Today", plan Task 19): the plant
 * clock, the in-stock total, the chart series and the role-aware tiles and
 * "Start here" steps. No React here, so it is unit-tested directly.
 */
import { formatKgTotal } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { can, type Me } from "@orrn/server/lib/permissions";
import type { inferRouterOutputs } from "@trpc/server";
import { BookOpen, PackagePlus, Truck, Warehouse } from "lucide-react";

import { visibleItems, type NavItem, type NavModule } from "@/shell/nav-items";

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

/** 24 h time on the plant's wall clock ("14:05"), for session times and "Showing the numbers from 14:05". */
export function clockTime(timezone: string): (at: string | number) => string {
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: validZone(timezone),
  });
  return (at) => format.format(new Date(at));
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

/** Today's figures from `dashboard.today` (the live KPI query), for the trend's last day. */
export type LiveToday = { date: string; packedG: number; dispatchedG: number };

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The trend's days with today's point taken from the live KPI query, so the
 * chart's "so far" can never disagree with the blocks above it (the trend
 * itself refreshes less often). When the KPI query has already moved to the
 * next day (after midnight), the chart moves with it: the oldest day drops
 * and the new day is appended, keeping its length. Older live figures, or a
 * gap of more than a day, leave the days as they are until the trend refetches.
 */
export function withLiveToday(days: readonly TrendDay[], live: LiveToday | undefined): TrendDay[] {
  const last = days.at(-1);
  if (!live || !last) return [...days];
  const today: TrendDay = { date: live.date, packedKgG: live.packedG, dispatchedKgG: live.dispatchedG };
  if (last.date === live.date) return [...days.slice(0, -1), today];
  if (nextDay(last.date) === live.date) return [...days.slice(1), today];
  return [...days];
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
  /** This person's role can do the step. */
  allowed: boolean;
  /** Allowed, but an earlier step it needs is still open (packing needs a die). */
  waiting: boolean;
  /** Where to do it: null when done, not allowed, or waiting. */
  to: string | null;
};

/**
 * Company modules as the nav reads them (`visibleItems`): an empty or missing
 * list means every module is on (companies created before modules existed).
 */
function moduleOn(me: Me | null | undefined, module: NavModule): boolean {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.length === 0 || modules.includes(module);
}

/**
 * The first steps for an empty plant, in order. Each links only for people
 * whose role can do it; packing also waits until a die exists (the pack
 * screen starts by picking one). Steps for areas the plant switched off are
 * left out, so "n of n done" can always be reached.
 */
export function startHereSteps(setup: Setup, me: Me | null | undefined): StartHereStep[] {
  const step = (
    key: StartHereStep["key"],
    labelKey: MessageKey,
    done: boolean,
    to: string,
    allowed: boolean,
    needs = true,
  ): StartHereStep => {
    const waiting = !done && allowed && !needs;
    return { key, labelKey, done, allowed, waiting, to: !done && allowed && !waiting ? to : null };
  };
  const steps: (StartHereStep | null)[] = [
    moduleOn(me, "dies") ? step("die", "today.startHere.addDie", setup.dies, "/dies", can(me, "die.create")) : null,
    moduleOn(me, "customers")
      ? step("customer", "today.startHere.addCustomer", setup.customers, "/customers", can(me, "customer.create"))
      : null,
    moduleOn(me, "bundles")
      ? step("pack", "today.startHere.packFirst", setup.bundles, "/pack/new", can(me, "bundle.create"), setup.dies)
      : null,
    step("printer", "today.startHere.connectPrinter", setup.printers, "/printing", can(me, "spool.manage_printers")),
  ];
  return steps.filter((s): s is StartHereStep => s !== null);
}

/**
 * The line under "Start here": people who can do most of the steps set orrn
 * up; everyone else (an operator who can only pack, a viewer) is told what
 * they are waiting for.
 */
export function startHereIntroKey(steps: readonly StartHereStep[]): MessageKey {
  return steps.filter((s) => s.allowed).length >= 2 ? "today.startHere.body" : "today.startHere.bodyWaiting";
}

/** Today's lists follow the company modules, as the nav does. */
export function todaySections(me: Me | null | undefined): { dispatches: boolean; sessions: boolean } {
  return { dispatches: moduleOn(me, "dispatches"), sessions: moduleOn(me, "bundles") };
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

export type TileHint = { key: MessageKey; vars?: Record<string, string> };

/**
 * The line under a tile's title. Dispatch says how many are open ("14 open",
 * "None open"); while that count is unknown (loading, or the numbers failed)
 * it reads a plain line instead of nothing, so every tile keeps two lines and
 * the titles in a row line up.
 */
export function tileHint(tile: TodayTile, openCount: number | undefined): TileHint {
  if (tile.key !== "dispatch") return { key: tile.hintKey };
  if (openCount === undefined) return { key: "today.tiles.dispatchHintAny" };
  if (openCount > 0) return { key: "today.tiles.dispatchHint", vars: { count: formatCount(openCount) } };
  return { key: "today.tiles.dispatchHintNone" };
}

/**
 * A packing session's line: bundles and kg (void left out, RP11), or "All
 * bundles void" when nothing of it is left, instead of "0 bundles · 0.0 kg".
 */
export function sessionSummary(totals: { bundles: number; weightG: number }): TileHint {
  if (totals.bundles <= 0) return { key: "today.sessionVoided" };
  return {
    key: "units.bundlesKg",
    vars: { bundles: formatCount(totals.bundles), kg: formatKgTotal(totals.weightG / 1000) },
  };
}

/**
 * Tile grid by tile count: one row of 3 or 4 from iPad up (no empty fourth
 * column for office's three tiles), two per row on a phone, with an odd last
 * tile taking its whole row instead of sitting alone in half of it.
 */
export function tileLayout(count: number): { grid: string; spanLast: boolean } {
  if (count >= 4) return { grid: "grid-cols-2 md:grid-cols-4", spanLast: false };
  if (count === 3) return { grid: "grid-cols-2 md:grid-cols-3", spanLast: true };
  if (count === 2) return { grid: "grid-cols-2", spanLast: false };
  return { grid: "grid-cols-1", spanLast: false };
}
