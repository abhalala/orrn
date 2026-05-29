import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import { company, impersonationGrant, membership, platformAdmin } from "@orrn/db/schema";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export type ImpersonationInfo = {
  /** The platform admin user id that initiated the impersonation. */
  actorUserId: string;
  /** The companyId being impersonated (also reflected in ctx.companyId). */
  companyId: string;
  /** Active grant backing this session. */
  grantId: string;
  expiresAt: Date;
};

/**
 * Header read on every request. When present AND the requesting user is a
 * platform admin with a valid, non-revoked grant, we override `ctx.companyId`
 * / `ctx.role` / `ctx.membership` to that company.
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
        .select({ userId: platformAdmin.userId, role: platformAdmin.role })
        .from(platformAdmin)
        .where(eq(platformAdmin.userId, userId))
        .limit(1)
    : [];

  const isPlatformAdmin = Boolean(platform);
  const platformRole = platform?.role ?? null;

  let impersonation: ImpersonationInfo | null = null;
  let effectiveMember = ownMember ?? null;
  let effectiveCompanyId = ownMember?.companyId ?? null;
  let effectiveRole = ownMember?.role ?? null;

  const impersonateCompanyId = context.req.header(IMPERSONATE_HEADER);
  let impersonationHeaderRejected = false;

  if (impersonateCompanyId) {
    if (!isPlatformAdmin || !userId) {
      impersonationHeaderRejected = true;
    } else {
      const now = new Date();
      const [grant] = await db
        .select()
        .from(impersonationGrant)
        .where(
          and(
            eq(impersonationGrant.platformAdminId, userId),
            eq(impersonationGrant.companyId, impersonateCompanyId),
            isNull(impersonationGrant.revokedAt),
            gt(impersonationGrant.expiresAt, now),
          ),
        )
        .orderBy(desc(impersonationGrant.createdAt))
        .limit(1);

      if (!grant) {
        impersonationHeaderRejected = true;
      } else {
        const [impCompany] = await db
          .select({ id: company.id, status: company.status })
          .from(company)
          .where(eq(company.id, impersonateCompanyId))
          .limit(1);

        if (!impCompany || impCompany.status !== "active") {
          impersonationHeaderRejected = true;
        } else {
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
            grantId: grant.id,
            expiresAt: grant.expiresAt,
          };
        }
      }
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
    platformRole,
    impersonation,
    impersonationHeaderRejected,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
