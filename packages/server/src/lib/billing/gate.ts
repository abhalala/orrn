/**
 * XE-BILL: every billing and e-invoice procedure, reads included, needs its module on (both are opt-in,
 * CONTRACTS "Opt-in modules") and its action. The router-level gate in `companyProcedure` covers only
 * mutations, and invoices carry money, so reads are gated here too.
 */
import { TRPCError } from "@trpc/server";

import { isModuleOn } from "@orrn/domain";

import { actionProcedure, anyActionProcedure } from "../../index";
import { companyModules, MODULE_OFF_MESSAGE } from "../moduleGate";
import type { Action } from "../permissions";
import type { OrrnDb } from "../atomic";

export async function assertBilling(ctx: { db: OrrnDb; companyId: string }, withEinvoice = false): Promise<string[]> {
  const modules = await companyModules(ctx.db, ctx.companyId);
  if (!isModuleOn(modules, "billing") || (withEinvoice && !isModuleOn(modules, "einvoice"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
  }
  return modules;
}

/** Billing procedure: the action (any of several) and the billing module. */
export function billingProcedure(...actions: [Action, ...Action[]]) {
  const base = actions.length === 1 ? actionProcedure(actions[0]) : anyActionProcedure(...actions);
  return base.use(async ({ ctx, next }) => {
    const modules = await assertBilling(ctx);
    return next({ ctx: { ...ctx, modules } });
  });
}

/** E-invoice procedure: billing AND einvoice on. */
export function einvoiceProcedure(...actions: [Action, ...Action[]]) {
  const base = actions.length === 1 ? actionProcedure(actions[0]) : anyActionProcedure(...actions);
  return base.use(async ({ ctx, next }) => {
    const modules = await assertBilling(ctx, true);
    return next({ ctx: { ...ctx, modules } });
  });
}
