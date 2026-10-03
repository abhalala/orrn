import { company, impersonationGrant } from "@orrn/db/schema";
import type { createDb } from "@orrn/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { can, type PlatformStaffRole } from "./permissions";

type Db = ReturnType<typeof createDb>;

export type ImpersonationResolution =
  | { ok: false }
  | {
      ok: true;
      companyId: string;
      grantId: string;
      expiresAt: Date;
      companyStatus: "active";
    };

/**
 * Decide whether the impersonation header may be honoured for this request.
 *
 * A grant is only honoured when ALL hold:
 *  - the caller is platform staff whose *current* role still allows
 *    `platform.impersonate` (re-checked on every use, so a staff member who was
 *    downgraded to support after creating a grant loses it immediately);
 *  - the grant belongs to the caller, targets the header company, and is
 *    neither revoked nor expired;
 *  - the target company is active.
 */
export async function resolveImpersonation(
  db: Db,
  input: {
    userId: string | undefined;
    isPlatformAdmin: boolean;
    platformRole: PlatformStaffRole | null;
    targetCompanyId: string;
  },
): Promise<ImpersonationResolution> {
  const { userId, isPlatformAdmin, platformRole, targetCompanyId } = input;

  if (!userId || !isPlatformAdmin) return { ok: false };
  if (!can({ company: null, isPlatformAdmin, platformRole }, "platform.impersonate")) {
    return { ok: false };
  }

  const [grant] = await db
    .select()
    .from(impersonationGrant)
    .where(
      and(
        eq(impersonationGrant.platformAdminId, userId),
        eq(impersonationGrant.companyId, targetCompanyId),
        isNull(impersonationGrant.revokedAt),
        gt(impersonationGrant.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(impersonationGrant.createdAt))
    .limit(1);
  if (!grant) return { ok: false };

  const [impCompany] = await db
    .select({ id: company.id, status: company.status })
    .from(company)
    .where(eq(company.id, targetCompanyId))
    .limit(1);
  if (!impCompany || impCompany.status !== "active") return { ok: false };

  return {
    ok: true,
    companyId: impCompany.id,
    grantId: grant.id,
    expiresAt: grant.expiresAt,
    companyStatus: "active",
  };
}
