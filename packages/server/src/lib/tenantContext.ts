import type { createDb } from "@orrn/db";
import { company, membership, platformAdmin } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { and, desc, eq } from "drizzle-orm";

import { resolveImpersonation } from "./impersonation";

type Db = ReturnType<typeof createDb>;

/**
 * Active company for users in more than one plant (spec P10). Honoured only
 * when the user has a membership in that (active) company; otherwise ignored.
 */
export const COMPANY_HEADER = "x-orrn-company";

/**
 * Header read on every request. When present AND the requesting user is a
 * platform admin with a valid, non-revoked grant, we override `companyId` /
 * `role` / `membership` to that company.
 */
export const IMPERSONATE_HEADER = "x-orrn-impersonate-company";

export type ImpersonationInfo = {
  /** The platform admin user id that initiated the impersonation. */
  actorUserId: string;
  /** The companyId being impersonated (also reflected in ctx.companyId). */
  companyId: string;
  /** Active grant backing this session. */
  grantId: string;
  expiresAt: Date;
};

export type ActiveMembership = {
  id: string;
  companyId: string;
  role: CompanyRole;
  companyStatus: "pending" | "active" | "suspended";
};

/**
 * The user's memberships in active companies, most recent first: the company
 * last chosen with `company.switch`, else the newest membership.
 */
export async function listActiveMemberships(db: Db, userId: string) {
  return db
    .select({
      id: membership.id,
      companyId: membership.companyId,
      role: membership.role,
      companyStatus: company.status,
      name: company.name,
    })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(and(eq(membership.userId, userId), eq(company.status, "active")))
    .orderBy(desc(membership.lastActiveAt), desc(membership.createdAt), desc(membership.id));
}

/**
 * Resolve the tenant half of the request context from the signed-in user and
 * the two request headers. Pure DB + header logic (no Better Auth), so tests
 * exercise exactly what production runs.
 */
export async function resolveTenantContext(
  db: Db,
  input: { userId: string | null | undefined; companyHeader?: string | null; impersonateHeader?: string | null },
) {
  const { userId } = input;
  const memberships = userId ? await listActiveMemberships(db, userId) : [];
  const requested = input.companyHeader
    ? memberships.find((m) => m.companyId === input.companyHeader)
    : undefined;
  const chosen = requested ?? memberships[0];
  const ownMember: ActiveMembership | null = chosen
    ? { id: chosen.id, companyId: chosen.companyId, role: chosen.role, companyStatus: chosen.companyStatus }
    : null;

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
  let effectiveMember: ActiveMembership | null = ownMember;
  let effectiveCompanyId: string | null = ownMember?.companyId ?? null;
  let effectiveRole: CompanyRole | null = ownMember?.role ?? null;
  let impersonationHeaderRejected = false;

  if (input.impersonateHeader) {
    const resolved = await resolveImpersonation(db, {
      userId: userId ?? undefined,
      isPlatformAdmin,
      platformRole,
      targetCompanyId: input.impersonateHeader,
    });

    if (!resolved.ok || !userId) {
      impersonationHeaderRejected = true;
    } else {
      effectiveMember = {
        id: `impersonation:${resolved.companyId}`,
        companyId: resolved.companyId,
        role: "owner",
        companyStatus: resolved.companyStatus,
      };
      effectiveCompanyId = resolved.companyId;
      effectiveRole = "owner";
      impersonation = {
        actorUserId: userId,
        companyId: resolved.companyId,
        grantId: resolved.grantId,
        expiresAt: resolved.expiresAt,
      };
    }
  }

  return {
    membership: effectiveMember,
    companyId: effectiveCompanyId,
    role: effectiveRole,
    isPlatformAdmin,
    platformRole,
    impersonation,
    impersonationHeaderRejected,
  };
}
