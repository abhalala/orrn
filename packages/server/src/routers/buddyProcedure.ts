/** The guard every `buddy.*` procedure uses (design 2026-11-18, §4.4). */
import { TRPCError } from "@trpc/server";

import { companyProcedure } from "../index";
import { requestOriginAllowed, roleMayUseBuddy } from "../lib/buddy/access";

const NOT_ALLOWED = "You don't have permission to do that";

/**
 * Browser session, active membership, a role in `BUDDY_ROLES` with `buddy.use`, no impersonation. A mutation also
 * needs an Origin the API's CORS allows (security H1, M5): a cross-site form (tRPC also reads multipart bodies)
 * carries a foreign Origin or none, so it cannot mint, renew, revoke, confirm or reject. This holds whatever the
 * general tRPC CSRF rule becomes.
 */
export const buddyProcedure = companyProcedure.use(({ ctx, next, type }) => {
  const via = (ctx as { via?: string }).via;
  if (via === "buddy" || ctx.impersonation || !roleMayUseBuddy(ctx.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ALLOWED });
  }
  if (type === "mutation" && !requestOriginAllowed(ctx.request)) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ALLOWED });
  }
  return next({ ctx });
});
