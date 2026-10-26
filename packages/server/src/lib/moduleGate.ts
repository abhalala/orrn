import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import type { ApprovalKind } from "@orrn/db/schema/approval";
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
  // Scrap vendors are purchase masters (routers/vendor.ts).
  vendor: "purchase",
};

/**
 * Single procedures of an otherwise ungated router. `stock` keeps its location masters open (a
 * store-only plant still lists its yard), but moving bundles and taking legacy bundles onto the
 * ledger are bundle work.
 */
export const PROCEDURE_MODULE: Readonly<Record<string, CompanyModule>> = {
  "stock.move": "bundles",
  "stock.openingBalance": "bundles",
};

/**
 * The module whose rows an approval kind's decision writes (lib/approvalApply.ts). `approval.decide`
 * checks it per request, since one router serves every kind. Typed over every kind, so a new kind
 * does not compile until it is registered here.
 */
export const APPROVAL_KIND_MODULE: Readonly<Record<ApprovalKind, CompanyModule>> = {
  dc_note: "purchase",
  cast_close: "foundry",
  die_rerank: "dies",
  dispatch_overdraw: "dispatches",
  phantom_void: "bundles",
  die_owner_override: "dies",
  order_reallocate: "orders",
  press_time: "press",
  press_reopen: "press",
  ageing_override: "ageing",
  press_late_entry: "press",
  melt_correct: "foundry",
};

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The module a procedure path (`die.create`, `orders.lines.add`) belongs to, or null (ungated). */
export function moduleForPath(path: string): CompanyModule | null {
  if (own(PROCEDURE_MODULE, path)) return PROCEDURE_MODULE[path]!;
  const top = path.split(".")[0] ?? "";
  return own(ROUTER_MODULE, top) ? ROUTER_MODULE[top]! : null;
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
