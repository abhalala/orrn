import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import { company, membership, platformAdmin } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export type ImpersonationInfo = {
  /** The platform admin user id that initiated the impersonation. */
  actorUserId: string;
  /** The companyId being impersonated (also reflected in ctx.companyId). */
  companyId: string;
};

/**
 * Header read on every request. When present AND the requesting user is a
 * platform admin, we override `ctx.companyId` / `ctx.role` / `ctx.membership`
 * to that company so the request runs *as if* the admin were a member.
 *
 * For M6 we only land the context plumbing + audit metadata + client banner.
 * The proper time-boxed grant table ships in M9; for now any platform admin
 * may impersonate any active company.
 */
const IMPERSONATE_HEADER = "x-orrn-impersonate-company";

export async function createContext({ context }: CreateContextOptions) {
  const db = createDb();
  const session = await createAuth().api.getSession({
    headers: context.req.raw.headers,
  });

  const userId = session?.user.id;
  const [ownMember] = userId
    ? await db
        .select({
          id: membership.id,
          companyId: membership.companyId,
          role: membership.role,
          companyStatus: company.status,
        })
        .from(membership)
        .innerJoin(company, eq(company.id, membership.companyId))
        .where(and(eq(membership.userId, userId), eq(company.status, "active")))
        .limit(1)
    : [];

  const [platform] = userId
    ? await db
        .select({ userId: platformAdmin.userId })
        .from(platformAdmin)
        .where(eq(platformAdmin.userId, userId))
        .limit(1)
    : [];

  const isPlatformAdmin = Boolean(platform);

  // --- Impersonation (platform-admin only, M9 grant table is TODO) ---
  let impersonation: ImpersonationInfo | null = null;
  let effectiveMember = ownMember ?? null;
  let effectiveCompanyId = ownMember?.companyId ?? null;
  let effectiveRole = ownMember?.role ?? null;

  const impersonateCompanyId = context.req.header(IMPERSONATE_HEADER);
  if (impersonateCompanyId && isPlatformAdmin && userId) {
    const [impCompany] = await db
      .select({ id: company.id, status: company.status })
      .from(company)
      .where(eq(company.id, impersonateCompanyId))
      .limit(1);

    if (impCompany && impCompany.status === "active") {
      // Synthesize a membership-shaped object so companyProcedure / roleGuard
      // continue to work without special-casing impersonation everywhere.
      // Platform admins act as `owner` while impersonating so they can exercise
      // any tenant-scoped functionality during support sessions.
      effectiveMember = {
        id: `impersonation:${impCompany.id}`,
        companyId: impCompany.id,
        role: "owner" as const,
        companyStatus: impCompany.status,
      };
      effectiveCompanyId = impCompany.id;
      effectiveRole = "owner" as const;
      impersonation = {
        actorUserId: userId,
        companyId: impCompany.id,
      };
    }
  }

  return {
    auth: null,
    db,
    request: context.req.raw,
    session,
    membership: effectiveMember,
    companyId: effectiveCompanyId,
    role: effectiveRole,
    isPlatformAdmin,
    impersonation,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
