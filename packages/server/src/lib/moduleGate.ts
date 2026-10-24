import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";
import { isModuleOn, type CompanyModule } from "@orrn/domain";

import type { OrrnDb } from "./atomic";

/**
 * Bought modules (FP-PF-07; C42; platform spec §4 Modules). `company.modules` non-empty and
 * missing the module => FORBIDDEN, even when the role would allow the action. Empty = all on.
 */
export const MODULE_OFF_MESSAGE = "That module is not on for this plant";

/**
 * Top-level router key -> module. Every MUTATION under these routers passes `assertModule` in
 * `companyProcedure` (router level, so a procedure added later is covered without remembering).
 * Reads are not gated: the floor reads masters across modules (a packer picks the die inside pack
 * with `bundles` on even when `dies` is off; platform spec §4). A direct `die.create` still needs
 * `dies`. Routers that land later register here (append-only): press, ageing, plans, dieRoom.
 */
export const ROUTER_MODULE: Readonly<Record<string, CompanyModule>> = {
  customer: "customers",
  die: "dies",
  dieInstance: "dies",
  dieRoom: "dies",
  bundle: "bundles",
  count: "bundles",
  dispatch: "dispatches",
  packingList: "dispatches",
  orders: "orders",
  plans: "orders",
  foundry: "foundry",
  press: "press",
  ageing: "ageing",
  store: "store",
  purchase: "purchase",
};

/** The module a procedure path (`die.create`, `orders.lines.add`) belongs to, or null (ungated). */
export function moduleForPath(path: string): CompanyModule | null {
  const top = path.split(".")[0] ?? "";
  return Object.prototype.hasOwnProperty.call(ROUTER_MODULE, top) ? ROUTER_MODULE[top]! : null;
}

/** The company's module list as stored (empty = every module on). */
export async function companyModules(db: OrrnDb, companyId: string): Promise<string[]> {
  const row = await db.select({ modules: company.modules }).from(company).where(eq(company.id, companyId)).get();
  return Array.isArray(row?.modules) ? row.modules : [];
}

/**
 * Throw FORBIDDEN when `module` is off for the caller's company. Call it inside a procedure when a
 * mutation of one router writes another module's rows (the router-level gate covers its own).
 */
export async function assertModule(ctx: { db: OrrnDb; companyId: string }, module: CompanyModule): Promise<void> {
  const modules = await companyModules(ctx.db, ctx.companyId);
  if (!isModuleOn(modules, module)) {
    throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
  }
}
