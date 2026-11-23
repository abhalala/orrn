/**
 * `decisionLanded` for the HR appliers without importing lib/approvalApply.ts (which imports them: a value
 * import back would be a cycle that reads the appliers before they exist). Same SQL as approvalApply's.
 */
import { sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";

export function decisionLanded(ctx: { companyId: string; seq: number }, approvalId: string, decision: "approved" | "rejected"): SQL {
  return sql`exists (select 1 from ${approval} a where a.id = ${approvalId} and a.company_id = ${ctx.companyId} and a.server_seq = ${ctx.seq} and a.status = ${decision})`;
}
