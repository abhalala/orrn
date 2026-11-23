/**
 * XE parity lane HR: procedure builders for the `hr` and `payroll` routers (kept apart from lib/hr/core.ts so
 * the device push route can use the data helpers without loading the procedure builders).
 */
import { actionProcedure, anyActionProcedure } from "../../index";
import type { Action } from "../permissions";
import { assertHr } from "./core";

function base(actions: [Action, ...Action[]]) {
  return actions.length === 1 ? actionProcedure(actions[0]) : anyActionProcedure(...actions);
}

/** HR procedure: any of `actions`, and `hr` on. */
export function hrProcedure(...actions: [Action, ...Action[]]) {
  return base(actions).use(async ({ ctx, next }) => {
    await assertHr(ctx);
    return next({ ctx });
  });
}

/** Payroll procedure: any of `actions`, `payroll` and `hr` on. */
export function payrollProcedure(...actions: [Action, ...Action[]]) {
  return base(actions).use(async ({ ctx, next }) => {
    await assertHr(ctx, true);
    return next({ ctx });
  });
}

