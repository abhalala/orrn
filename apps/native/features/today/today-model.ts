import { gToKg, type StatusTone } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { can, type Me } from "@orrn/server/lib/permissions";

/**
 * Pure rules for the Today screen (spec §4 Native, Today). Kept free of React
 * Native imports so bun tests can load it.
 */

/** Which greeting key to use for the phone's hour (0 to 23). */
export function greetingKey(hour: number): MessageKey {
  if (hour < 12) return "today.greetingMorning";
  if (hour < 17) return "today.greetingAfternoon";
  return "today.greetingEvening";
}

type StockSlice = { bundles: number; weightG: number };
export type StockTotals = { available: StockSlice; reserved: StockSlice; dispatched: StockSlice; void: StockSlice };

/** "In stock" is available plus held, never dispatched or void (web semantics). */
export function inStock(totals: StockTotals): { bundles: number; kg: number } {
  return {
    bundles: totals.available.bundles + totals.reserved.bundles,
    kg: gToKg(totals.available.weightG + totals.reserved.weightG),
  };
}

/** The checklist shows only before the first bundle ever exists (void bundles count as existing). */
export function showStartHere(totals: StockTotals): boolean {
  return totals.available.bundles + totals.reserved.bundles + totals.dispatched.bundles + totals.void.bundles === 0;
}

export type TodayTile = "pack" | "stock" | "guides" | "dispatch";

/** Colour block and copy keys per tile, in one place so the screen only maps. */
export const TILE_META: Record<TodayTile, { tone: StatusTone; title: MessageKey; hint: MessageKey; href: string }> = {
  pack: { tone: "blue", title: "today.tiles.pack", hint: "today.tiles.packHint", href: "/pack/new" },
  dispatch: { tone: "red", title: "today.tiles.dispatch", hint: "today.tiles.dispatchHint", href: "/dispatch" },
  stock: { tone: "amber", title: "today.tiles.stock", hint: "today.tiles.stockHint", href: "/stock" },
  guides: { tone: "neutral", title: "today.tiles.guides", hint: "today.tiles.guidesHint", href: "/more/guides" },
};

/**
 * Action tiles, in order. Only people who pack or work a dispatch get tiles;
 * viewers and accountants see the numbers only (ruling T19). A company's
 * module list hides tiles it did not buy (an empty list means all modules).
 */
export function todayTiles(me: Me | null | undefined): TodayTile[] {
  if (!me?.company) return [];
  const modules = (me.company.modules ?? []).map((m) => m.toLowerCase());
  const has = (m: string) => modules.length === 0 || modules.includes(m);
  const pack = has("bundles") && can(me, "bundle.create");
  const dispatch = has("dispatches") && can(me, "dispatch.complete");
  if (!pack && !dispatch) return [];
  const tiles: TodayTile[] = [];
  if (pack) tiles.push("pack");
  if (dispatch) tiles.push("dispatch");
  if (has("bundles")) tiles.push("stock");
  tiles.push("guides");
  return tiles;
}
