/**
 * XE PLATFORM row 79: custom role reads shared by the request context builders and the roles router. Pure DB reads;
 * the rule itself is `effectiveActions` in `permissions.ts`.
 */
import type { createDb } from "@orrn/db";
import { customRole, membershipCustomRole } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import type { CustomRoleGrant } from "./permissions";

type Db = ReturnType<typeof createDb>;

/** The custom role one membership holds in its plant, or null. */
export async function customGrantForMembership(db: Db, membershipId: string, companyId: string): Promise<CustomRoleGrant | null> {
  const row = await db
    .select({ baseRole: customRole.baseRole, added: customRole.added, removed: customRole.removed })
    .from(membershipCustomRole)
    .innerJoin(customRole, and(eq(customRole.id, membershipCustomRole.customRoleId), eq(customRole.companyId, companyId)))
    .where(and(eq(membershipCustomRole.membershipId, membershipId), eq(membershipCustomRole.companyId, companyId)))
    .get();
  return row ? { baseRole: row.baseRole, added: row.added ?? [], removed: row.removed ?? [] } : null;
}
