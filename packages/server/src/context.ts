import { configureAuthHooks, createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import type { Context as HonoContext } from "hono";

import { acceptLiveInvitesFor } from "./lib/acceptInvite";
import type { IngestSource } from "./lib/ingest/source";
import { COMPANY_HEADER, IMPERSONATE_HEADER, resolveTenantContext } from "./lib/tenantContext";

export type { ImpersonationInfo } from "./lib/tenantContext";
export type { IngestSource } from "./lib/ingest/source";

// Google sign-up accepts the person's live invites through the same step `invite.acceptByToken`
// uses (plan 2026-11-18). `@orrn/auth` cannot import this package, so it is lent here, once, when
// the module that serves every request loads. Tested in test/auth-google.test.ts.
configureAuthHooks({ acceptLiveInvitesFor });

export type CreateContextOptions = {
  context: HonoContext;
};

/**
 * Request context: session → active membership → companyId/role.
 *
 * - `x-orrn-company` picks the active company for a user in several plants
 *   (spec P10). Naming a company without a membership there makes every
 *   authed procedure FORBIDDEN (ruling RP2). Without the header the most
 *   recent membership is used (single-membership users are unaffected).
 * - `x-orrn-impersonate-company` (platform staff with a live grant) overrides
 *   both and acts as owner.
 */
export async function createContext({ context }: CreateContextOptions) {
  const db = createDb();
  const session = await createAuth(context.env).api.getSession({
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
    // Optional in the type so contexts built elsewhere (tests, the Infinity Portal adapters) need not name it.
    ...({ waitUntil: workerWaitUntil(context) } as { waitUntil?: (job: Promise<unknown>) => void }),
    /**
     * Set only by the Infinity Portal merge adapters on the context they pass to `createCaller`
     * (plan A6). Procedures copy it into `audit_log.meta.source`. Never read from a request.
     * Optional in the type so contexts built elsewhere (tests, fixtures) need not name it.
     */
    ...({} as { ingestSource?: IngestSource }),
    /**
     * orrn buddy (design 2026-11-18, §4.3). `via: "buddy"` is set only on the context `/mcp` builds from a
     * grant token (`lib/buddy/grantContext.ts`); `buddyGrantId` names that grant. `buddyDraftId` is set only
     * on the context `buddy.drafts.confirm` passes to `createCaller`, so the real write's audit row carries
     * `meta.buddyDraftId` (`lib/audit.ts`). Never read from a request. Optional, like `ingestSource`.
     */
    ...({} as { via?: "buddy"; buddyGrantId?: string; buddyDraftId?: string }),
  };
}

/**
 * The Worker's `waitUntil`: work that runs after the answer has gone (plan 2026-11-18, Task 8 fix
 * round 1: the invite page's set-password email, so a match answers as fast as a mismatch). Undefined
 * where there is no execution context (Hono throws on `executionCtx` then); callers await instead.
 */
function workerWaitUntil(context: HonoContext): ((job: Promise<unknown>) => void) | undefined {
  try {
    const ctx = context.executionCtx;
    return (job) => ctx.waitUntil(job);
  } catch {
    return undefined;
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>;
