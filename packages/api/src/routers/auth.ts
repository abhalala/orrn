import { eq } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";

import { authedProcedure, router } from "../index";

/**
 * Single source of truth for client-side identity + tenancy.
 *
 * Web and native clients call `auth.me` once via the route guard / app shell,
 * and read role + company + platform flag from the returned shape rather than
 * piecing it together from `authClient.useSession()`.
 */
export const authRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const companyRow =
      ctx.membership && ctx.companyId
        ? (
            await ctx.db
              .select({
                id: company.id,
                name: company.name,
                slug: company.slug,
                status: company.status,
                plan: company.plan,
              })
              .from(company)
              .where(eq(company.id, ctx.companyId))
              .limit(1)
          )[0] ?? null
        : null;

    return {
      user: {
        id: userId,
        name: ctx.session.user.name,
        email: ctx.session.user.email,
        image: ctx.session.user.image ?? null,
      },
      company:
        companyRow && ctx.role
          ? {
              id: companyRow.id,
              name: companyRow.name,
              slug: companyRow.slug,
              status: companyRow.status,
              plan: companyRow.plan,
              role: ctx.role,
            }
          : null,
      isPlatformAdmin: ctx.isPlatformAdmin,
      impersonation: ctx.impersonation ?? null,
    };
  }),
});
