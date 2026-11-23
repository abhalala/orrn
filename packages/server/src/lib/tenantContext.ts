import type { createDb } from "@orrn/db";
import { company, customRole, membership, membershipCustomRole, platformAdmin } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { and, desc, eq, sql } from "drizzle-orm";

import { resolveImpersonation } from "./impersonation";
import { effectiveActions, type Action, type CustomRoleGrant } from "./permissions";

type Db = ReturnType<typeof createDb>;

/**
 * Active company for users in more than one plant (spec P10). Honoured only
 * when the user has a membership in that (active) company; naming any other
 * company rejects the request (ruling RP2: never a silent fallback).
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
  /**
   * The plant requires secure sign-in (`company.settings.requireStrongSignIn`; council round 1, A4):
   * `companyProcedure` accepts only a session made with a passkey, Google or the authenticator code.
   * Absent on an impersonation membership (support is never held by it).
   */
  requireStrongSignIn?: boolean;
};

/**
 * The user's memberships in active companies, most recent first: the company
 * last chosen with `company.switch`, else the newest membership.
 */
export async function listActiveMemberships(db: Db, userId: string) {
  const base = {
    id: membership.id,
    companyId: membership.companyId,
    role: membership.role,
    companyStatus: company.status,
    name: company.name,
    /** Null while this plant's onboarding is open for the person (plan 2026-11-18, Task 9). */
    onboardedAt: membership.onboardedAt,
    /** 1 when the plant requires secure sign-in (council round 1, A4). */
    strict: sql<number | null>`json_extract(${company.settings}, '$.requireStrongSignIn')`,
  };
  const where = and(eq(membership.userId, userId), eq(company.status, "active"));
  const order = [desc(membership.lastActiveAt), desc(membership.createdAt), desc(membership.id)] as const;
  try {
    // XE PLATFORM: the custom role a member holds (if any) rides the same query: no extra round trip per request.
    return await db
      .select({
        ...base,
        customRoleId: customRole.id,
        customRoleName: customRole.name,
        customRoleBase: customRole.baseRole,
        customRoleAdded: customRole.added,
        customRoleRemoved: customRole.removed,
      })
      .from(membership)
      .innerJoin(company, eq(company.id, membership.companyId))
      .leftJoin(membershipCustomRole, eq(membershipCustomRole.membershipId, membership.id))
      .leftJoin(
        customRole,
        and(eq(customRole.id, membershipCustomRole.customRoleId), eq(customRole.companyId, membership.companyId)),
      )
      .where(where)
      .orderBy(...order);
  } catch (error) {
    // The app may deploy before migration 0066 (the `auth.me` note on buddy tables): then nobody holds a custom
    // role and every member keeps the fixed role. Any other error is real.
    if (!isMissingCustomRoleTable(error)) throw error;
    const rows = await db
      .select(base)
      .from(membership)
      .innerJoin(company, eq(company.id, membership.companyId))
      .where(where)
      .orderBy(...order);
    return rows.map((r) => ({
      ...r,
      customRoleId: null,
      customRoleName: null,
      customRoleBase: null,
      customRoleAdded: null,
      customRoleRemoved: null,
    }));
  }
}

function isMissingCustomRoleTable(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && !seen.has(e)) {
    seen.add(e);
    const message = e instanceof Error ? e.message : String(e);
    if (/no such table: (custom_role|membership_custom_role)/.test(message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** The custom role of a membership row from `listActiveMemberships`, as `effectiveActions` takes it. */
export function customGrantOf(row: {
  customRoleId: string | null;
  customRoleBase: CompanyRole | null;
  customRoleAdded: string[] | null;
  customRoleRemoved: string[] | null;
}): CustomRoleGrant | null {
  if (!row.customRoleId || !row.customRoleBase) return null;
  return { baseRole: row.customRoleBase, added: row.customRoleAdded ?? [], removed: row.customRoleRemoved ?? [] };
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
    ? {
        id: chosen.id,
        companyId: chosen.companyId,
        role: chosen.role,
        companyStatus: chosen.companyStatus,
        requireStrongSignIn: Number(chosen.strict) === 1,
      }
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
  // XE PLATFORM row 79: the effective action set, read fresh on every request (an edited role applies at once).
  let actions: ReadonlySet<Action> | null = chosen ? effectiveActions(chosen.role, customGrantOf(chosen)) : null;
  let customRoleInfo: { id: string; name: string } | null =
    chosen?.customRoleId && chosen.customRoleName ? { id: chosen.customRoleId, name: chosen.customRoleName } : null;
  let impersonationHeaderRejected = false;
  // RP2: a named company the user can't act in is an error, not a fallback.
  let companyHeaderRejected = Boolean(input.companyHeader) && !requested;

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
      actions = effectiveActions("owner");
      customRoleInfo = null;
      // Impersonation picks the company itself; the plant header is irrelevant.
      companyHeaderRejected = false;
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
    actions,
    customRole: customRoleInfo,
    isPlatformAdmin,
    platformRole,
    impersonation,
    impersonationHeaderRejected,
    companyHeaderRejected,
  };
}
