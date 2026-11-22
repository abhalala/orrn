/**
 * Approver rules per approval kind (XE ADM #78). The plant may choose which roles decide each kind and
 * add a threshold over a figure the request carries (`APPROVAL_MEASURES` in `@orrn/domain`). The rules
 * live in `company.settings.approvalRules`; a kind without a rule keeps `APPROVER_ROLES`, so a plant
 * that never sets one behaves exactly as before. Every check of "may this person decide" goes through
 * here: `approval.decide` (both the early refusal and the per-request one), `approval.list`
 * (`canDecide` per row), the Today approvals tile and the die owner override close.
 */
import { companyRoles, type CompanyRole } from "@orrn/db/schema/tenant";
import { company } from "@orrn/db/schema/tenant";
import { approvalKinds, type ApprovalKind } from "@orrn/db/schema/approval";
import { approverRolesFor, possibleApproverRoles, readApprovalRules, type ApprovalRules } from "@orrn/domain";
import { eq } from "drizzle-orm";

import type { OrrnDb } from "./atomic";
import { APPROVER_ROLES } from "./permissions";

export type { ApprovalRules };

/** The plant's approver rules (valid ones only; an invalid stored rule means the built-in approvers). */
export async function loadApprovalRules(db: OrrnDb, companyId: string): Promise<ApprovalRules> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return readApprovalRules(row?.settings?.approvalRules, companyRoles);
}

/** Built-in approvers of a kind (an unknown kind, appended by a later lane before it registers, has none). */
function builtIn(kind: string): readonly CompanyRole[] {
  return (APPROVER_ROLES as Partial<Record<string, readonly CompanyRole[]>>)[kind] ?? [];
}

/** May `role` decide this one request (its kind and meta), under the plant's rules? */
export function mayDecide(role: CompanyRole | null | undefined, kind: string, meta: Record<string, unknown> | null | undefined, rules: ApprovalRules): boolean {
  if (!role) return false;
  return approverRolesFor(kind, builtIn(kind), rules, meta).includes(role);
}

/** Every kind this role could decide some request of (a threshold's roles count). */
export function kindsRoleMayDecide(role: CompanyRole | null | undefined, rules: ApprovalRules): ApprovalKind[] {
  if (!role) return [];
  return approvalKinds.filter((kind) => possibleApproverRoles(kind, builtIn(kind), rules).includes(role));
}
