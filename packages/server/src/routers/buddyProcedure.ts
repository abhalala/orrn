/** The guard every `buddy.*` procedure uses (design 2026-11-18, §4.4). */
import { TRPCError } from "@trpc/server";

import { companyProcedure } from "../index";
import { roleMayUseBuddy } from "../lib/buddy/access";

const NOT_ALLOWED = "You don't have permission to do that";

/** Browser session, active membership, a role in `BUDDY_ROLES` with `buddy.use`, no impersonation. */
export const buddyProcedure = companyProcedure.use(({ ctx, next }) => {
  const via = (ctx as { via?: string }).via;
  if (via === "buddy" || ctx.impersonation || !roleMayUseBuddy(ctx.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ALLOWED });
  }
  return next({ ctx });
});

