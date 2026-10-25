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
import { todayTileKeys, type TodayTileKey } from "@orrn/server/lib/todayTiles";
import { BookOpen, ClipboardList, Factory, PackagePlus, ShieldCheck, Truck, Warehouse, Wrench } from "lucide-react";

import type { NavItem, NavModule } from "@/shell/nav-items";

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
  const date = new Intl.DateTimeFormat(dateTag(locale), {
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

/**
 * Bundles in stock right now: available only, the Stock screen's "In stock" (held bundles show
 * there as Held). Same rule as the server's `dashboard.today` `kpis.inStock*`.
 */
export function inStock(stock: TodayData["stock"]): { bundles: number; kg: number } {
  return { bundles: stock.available.bundles, kg: stock.available.weightG / 1000 };
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

/**
 * The trend's table, newest first: the owner reads it for today so far,
 * yesterday and last week, so 90 days of rows must not put today at the
 * bottom of a 3,000 px table (the kit lists oldest first).
 */
export function newestFirst<T extends { rows: readonly unknown[] }>(table: T): T {
  return { ...table, rows: [...table.rows].reverse() };
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

/**
 * Today's lists follow the company modules, as the nav does. A viewer gets the four KPIs only
 * (`scope: "kpis"`): the server sends the lists empty, so the screen leaves them out instead of
 * showing "nothing open" for something it was not allowed to read.
 */
export function todaySections(
  me: Me | null | undefined,
  scope: TodayData["scope"] = "full",
): { dispatches: boolean; sessions: boolean } {
  if (scope === "kpis") return { dispatches: false, sessions: false };
  return { dispatches: moduleOn(me, "dispatches"), sessions: moduleOn(me, "bundles") };
}

/** BCP 47 tag for the dates on Today; digits stay Latin in every language. */
function dateTag(locale: string): string {
  return locale === "hi" ? "hi-IN" : locale === "gu" ? "gu-IN" : "en-IN";
}

function dayText(day: string, locale: string): string {
  // `day` is a plain calendar date (YYYY-MM-DD): read it as UTC so no zone can move it.
  return new Intl.DateTimeFormat(dateTag(locale), { day: "numeric", month: "short", timeZone: "UTC", numberingSystem: "latn" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export type ProductionDayCaption = {
  /** "24 Oct": the production day the numbers cover. */
  day: string;
  /** "08:00": when it starts (shift 1), or null when no shifts are saved (it starts at midnight). */
  from: string | null;
  /** The calendar date now, in the plant's zone, as "24 Oct". */
  calendar: string;
  /** True when the calendar date is not the production day (before shift 1 starts): say why. */
  beforeStart: boolean;
  /** The shift running now, or null. */
  shiftName: string | null;
};

/**
 * What the Today caption says (FP-PF-05, FP-PF-15): the production day, when it starts, the
 * calendar date, and the shift now. Before shift 1 starts the production day is yesterday's.
 */
export function productionDayCaption(
  pd: Pick<TodayData["productionDay"], "day" | "startMs" | "shiftsSet" | "shift">,
  timezone: string,
  locale: string,
  nowMs: number,
): ProductionDayCaption {
  const zone = validZone(timezone);
  const calendarDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(new Date(nowMs));
  return {
    day: dayText(pd.day, locale),
    from: pd.shiftsSet ? clockTime(zone)(pd.startMs) : null,
    calendar: dayText(calendarDay, locale),
    beforeStart: pd.shiftsSet && calendarDay !== pd.day,
    shiftName: pd.shift?.name ?? null,
  };
}

/** Rupees with Indian grouping and two decimals, from paise. */
export function formatRupees(paise: number): string {
  return `\u20B9${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type TodayTile = NavItem & { key: TodayTileKey };

/**
 * Every tile Today can show, keyed by the server's tile keys (`lib/todayTiles.ts`). Which of them
 * a person sees is the server's call (`dashboard.today.tiles`, by role and module), so the screen
 * never offers a station the role does not work.
 */
const TILE_DEFS: Readonly<Record<TodayTileKey, TodayTile>> = {
  orders: { key: "orders", to: "/orders", labelKey: "today.floor.orders", icon: ClipboardList },
  dieRoom: { key: "dieRoom", to: "/dies/issues", labelKey: "today.floor.dieRoom", icon: Wrench },
  press: { key: "press", to: "/press", labelKey: "today.floor.press", icon: Factory },
  pack: { key: "pack", to: "/pack/new", labelKey: "today.tiles.pack", icon: PackagePlus },
  dispatch: { key: "dispatch", to: "/dispatch", labelKey: "today.tiles.dispatch", icon: Truck },
  stock: { key: "stock", to: "/stock", labelKey: "today.tiles.stock", icon: Warehouse },
  approvals: { key: "approvals", to: "/approvals", labelKey: "today.floor.approvals", icon: ShieldCheck },
  guides: { key: "guides", to: "/guides", labelKey: "today.tiles.guides", icon: BookOpen },
};

/**
 * The tiles this person sees (BACKLOG 35, FP-PF-15 role tiles). With the server's answer, exactly
 * its tiles in its order; before it (loading, or the numbers failed), the same role table the
 * server uses, so nothing jumps. Viewers get none: "Viewers see no action tiles, only numbers".
 */
export function todayTiles(me: Me | null | undefined, server?: readonly { key: string }[]): TodayTile[] {
  const keys = server ? server.map((x) => x.key) : todayTileKeys(me?.company?.role, me?.company?.modules ?? []);
  return keys.flatMap((key) => (key in TILE_DEFS ? [TILE_DEFS[key as TodayTileKey]] : []));
}

export type TileHint = { key: MessageKey; vars?: Record<string, string> };

const COUNT_HINTS: Partial<Record<TodayTileKey, { some: MessageKey; none: MessageKey; any: MessageKey }>> = {
  dispatch: { some: "today.tiles.dispatchHint", none: "today.tiles.dispatchHintNone", any: "today.tiles.dispatchHintAny" },
  orders: { some: "today.floor.ordersHint", none: "today.floor.ordersHintNone", any: "today.floor.ordersHintAny" },
  dieRoom: { some: "today.floor.dieRoomHint", none: "today.floor.dieRoomHintNone", any: "today.floor.dieRoomHintAny" },
  press: { some: "today.floor.pressHint", none: "today.floor.pressHintNone", any: "today.floor.pressHintAny" },
  approvals: { some: "today.floor.approvalsHint", none: "today.floor.approvalsHintNone", any: "today.floor.approvalsHintAny" },
};

const PLAIN_HINTS: Partial<Record<TodayTileKey, MessageKey>> = {
  pack: "today.tiles.packHint",
  stock: "today.tiles.stockHint",
  guides: "today.tiles.guidesHint",
};

/**
 * The line under a tile's title. A counted tile says its count ("14 open", "2 to issue", "1
 * waiting", or "None open" at zero); while the count is unknown (loading, or the numbers failed)
 * it reads a plain line instead of nothing, so every tile keeps two lines and the titles line up.
 */
export function tileHint(tile: Pick<TodayTile, "key">, count: number | null | undefined): TileHint {
  const counted = COUNT_HINTS[tile.key];
  if (!counted) return { key: PLAIN_HINTS[tile.key] ?? "today.tiles.guidesHint" };
  if (count === undefined || count === null) return { key: counted.any };
  if (count > 0) return { key: counted.some, vars: { count: formatCount(count) } };
  return { key: counted.none };
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
