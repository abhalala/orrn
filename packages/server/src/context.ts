import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import type { Context as HonoContext } from "hono";

import { COMPANY_HEADER, IMPERSONATE_HEADER, resolveTenantContext } from "./lib/tenantContext";

export type { ImpersonationInfo } from "./lib/tenantContext";

export type CreateContextOptions = {
  context: HonoContext;
};

/**
 * Request context: session → active membership → companyId/role.
 *
 * - `x-orrn-company` picks the active company for a user in several plants
 *   (spec P10); honoured only with a membership there, else the most recent
 *   membership is used (so single-membership users are unaffected).
 * - `x-orrn-impersonate-company` (platform staff with a live grant) overrides
 *   both and acts as owner.
 */
export async function createContext({ context }: CreateContextOptions) {
  const db = createDb();
  const session = await createAuth().api.getSession({
    headers: context.req.raw.headers,
  });

  const tenant = await resolveTenantContext(db, {
    userId: session?.user.id,
    companyHeader: context.req.header(COMPANY_HEADER),
    impersonateHeader: context.req.header(IMPERSONATE_HEADER),
  });

  return {
    auth: null,
    db,
    request: context.req.raw,
    session,
    ...tenant,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
