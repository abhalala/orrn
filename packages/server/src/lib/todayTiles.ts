/**
 * Today's role tiles (FP-PF-15, specs §E7 "role tiles"; explorer wave 1 H6). Each role gets the
 * shortcuts of its own station, in plant-flow order:
 *
 * - owner / admin / manager: every tile (orders, die room, press, pack, dispatch, stock, store, approvals, guides)
 * - office: orders, dispatch, stock, approvals (it holds stock.move / stock.count; "Take ready stock")
 * - supervisor: press, pack, dispatch, approvals (it approves press_time and press_late_entry)
 * - operator: pack, dispatch, stock
 * - packer: pack, stock
 * - die room: die room (copies to issue)
 * - press: press
 * - foundry: approvals (it approves cast_close; a foundry tile when the /foundry route lands)
 * - storekeeper: store
 * - viewer, accountant: none (viewers get the four KPIs only)
 *
 * Pure (no db), so the web reads the same list for its loading shape; `dashboard.today` sends
 * the tiles (with their counts) and is the one the screen renders. A tile of a module the plant
 * switched off is left out.
 */
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { isModuleOn, type CompanyModule } from "@orrn/domain";

export const TODAY_TILE_KEYS = ["orders", "dieRoom", "press", "pack", "dispatch", "stock", "store", "approvals", "guides"] as const;
export type TodayTileKey = (typeof TODAY_TILE_KEYS)[number];

const ALL: readonly TodayTileKey[] = TODAY_TILE_KEYS;

export const ROLE_TILES: Readonly<Record<CompanyRole, readonly TodayTileKey[]>> = {
  owner: ALL,
  admin: ALL,
  manager: ALL,
  office: ["orders", "dispatch", "stock", "approvals"],
  supervisor: ["press", "pack", "dispatch", "approvals"],
  operator: ["pack", "dispatch", "stock"],
  packer: ["pack", "stock"],
  die_room: ["dieRoom"],
  press: ["press"],
  storekeeper: ["store"],
  accountant: [],
  foundry: ["approvals"],
  viewer: [],
};

/** The module a tile belongs to (none: approvals and guides are always on). */
export const TILE_MODULE: Readonly<Partial<Record<TodayTileKey, CompanyModule>>> = {
  orders: "orders",
  dieRoom: "dies",
  press: "press",
  pack: "bundles",
  dispatch: "dispatches",
  stock: "bundles",
  store: "store",
};

/** The tiles this role sees on Today, with the plant's modules applied (empty list = all on). */
export function todayTileKeys(role: CompanyRole | null | undefined, modules: readonly string[] | null | undefined): TodayTileKey[] {
  if (!role) return [];
  const lower = (modules ?? []).map((m) => m.toLowerCase());
  return (ROLE_TILES[role] ?? []).filter((key) => {
    const module = TILE_MODULE[key];
    return !module || isModuleOn(lower, module);
  });
}
