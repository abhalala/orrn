import { count, desc, eq } from "drizzle-orm";

import { company, platformAdmin, waitlistRequest } from "@orrn/db/schema/tenant";
import { can } from "../../lib/permissions";
import { platformProcedure, router } from "../../index";

import { companiesProcedures } from "./companies";
import { impersonationProcedures } from "./impersonation";
import { spoolProcedures } from "./spool";
import { staffProcedures } from "./staff";
import { waitlistProcedures } from "./waitlist";

export const platformRouter = router({
  /**
   * Aggregated counts + recent rows for the staff console home page. Every
   * field is gated by the caller's platform role so a support agent doesn't
   * leak counts they aren't allowed to act on. One round-trip per scope using
   * Promise.all to keep Worker wall time bounded.
   */
  overview: platformProcedure.query(async ({ ctx }) => {
    const me = {
      company: null,
      isPlatformAdmin: true,
      platformRole: ctx.platformRole,
    };

    const canCompanies = can(me, "platform.company.manage");
    const canWaitlist = can(me, "platform.waitlist.review");
    const canStaff = can(me, "platform.staff.list");

    const [
      companyCounts,
      waitlistPendingRow,
      staffCountRow,
      recentCompanies,
      recentWaitlist,
    ] = await Promise.all([
      canCompanies
        ? ctx.db
            .select({ status: company.status, count: count() })
            .from(company)
            .groupBy(company.status)
        : Promise.resolve([] as { status: string; count: number }[]),
      canWaitlist
        ? ctx.db
            .select({ count: count() })
            .from(waitlistRequest)
            .where(eq(waitlistRequest.status, "pending"))
            .get()
        : Promise.resolve(undefined),
      canStaff
        ? ctx.db.select({ count: count() }).from(platformAdmin).get()
        : Promise.resolve(undefined),
      canCompanies
        ? ctx.db
            .select({
              id: company.id,
              name: company.name,
              slug: company.slug,
              status: company.status,
              plan: company.plan,
              createdAt: company.createdAt,
            })
            .from(company)
            .orderBy(desc(company.createdAt))
            .limit(5)
        : Promise.resolve(
            [] as Array<{
              id: string;
              name: string;
              slug: string;
              status: string;
              plan: string | null;
              createdAt: Date;
            }>,
          ),
      canWaitlist
        ? ctx.db
            .select({
              id: waitlistRequest.id,
              companyName: waitlistRequest.companyName,
              requesterEmail: waitlistRequest.requesterEmail,
              requesterName: waitlistRequest.requesterName,
              createdAt: waitlistRequest.createdAt,
            })
            .from(waitlistRequest)
            .where(eq(waitlistRequest.status, "pending"))
            .orderBy(desc(waitlistRequest.createdAt))
            .limit(5)
        : Promise.resolve(
            [] as Array<{
              id: string;
              companyName: string;
              requesterEmail: string;
              requesterName: string;
              createdAt: Date;
            }>,
          ),
    ]);

    const byStatus = new Map(companyCounts.map((r) => [r.status, r.count]));
    const companiesActive = byStatus.get("active") ?? 0;
    const companiesSuspended = byStatus.get("suspended") ?? 0;
    const companiesTotal = Array.from(byStatus.values()).reduce(
      (sum, n) => sum + n,
      0,
    );

    return {
      companies: canCompanies
        ? {
            total: companiesTotal,
            active: companiesActive,
            suspended: companiesSuspended,
            recent: recentCompanies,
          }
        : null,
      waitlist: canWaitlist
        ? {
            pending: waitlistPendingRow?.count ?? 0,
            recent: recentWaitlist,
          }
        : null,
      staff: canStaff
        ? {
            total: staffCountRow?.count ?? 0,
          }
        : null,
    };
  }),

  ...waitlistProcedures,
  ...companiesProcedures,
  ...impersonationProcedures,
  ...staffProcedures,
  ...spoolProcedures,
});
