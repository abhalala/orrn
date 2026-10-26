/**
 * Shared fixture for the W3-PORTAL-S tests: a sales plant with the portal on, a party login made
 * the real way (office grant -> password account -> invite.acceptByToken), and a caller that sends
 * real request headers (`x-orrn-company`, `x-orrn-impersonate-company`) through production tenant
 * resolution, the way the Worker does.
 */
import { expect } from "bun:test";

import { dieInstance, dieWeightReading, user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import type { TestEnv } from "./harness";
import { salesHelpers, type Api, type SalesHelpers, type SalesPlant } from "./sales-fixture";

export type { Api };

export type PartyLogin = { userId: string; email: string; portalUserId: string; api: Api; token: string };

/** Explicit so the declaration emit never has to spell out the tRPC caller. */
export interface PortalHelpers extends SalesHelpers {
  headerCaller(userId: string, opts?: { company?: string; impersonate?: string }): Promise<Api>;
  portalPlant(settings?: Record<string, unknown>): Promise<SalesPlant>;
  partyLogin(p: SalesPlant, customerId?: string, opts?: { email?: string; userId?: string }): Promise<PartyLogin>;
  copy(
    companyId: string,
    sectionId: string,
    seqNo: number,
    opts?: { owner?: string | null; status?: "available" | "in_use" | "retired"; readingMilli?: number },
  ): Promise<string>;
  codeOf(p: Promise<unknown>): Promise<string>;
}

let uniq = 0;
const tag = () => `${Date.now().toString(36)}${(uniq += 1)}`;

export function portalHelpers(getEnv: () => TestEnv): PortalHelpers {
  const sales = salesHelpers(getEnv);

  /** A caller for `userId` with real plant / impersonation headers (production tenant resolution). */
  async function headerCaller(userId: string, opts: { company?: string; impersonate?: string } = {}): Promise<Api> {
    const env = getEnv();
    const { appRouter } = await import("../src/routers/index");
    const { resolveTenantContext, COMPANY_HEADER, IMPERSONATE_HEADER } = await import("../src/lib/tenantContext");
    return appRouter.createCaller(async () => {
      const [u] = await env.db.select().from(user).where(eq(user.id, userId)).limit(1);
      if (!u) throw new Error(`No user ${userId}`);
      const headers = new Headers();
      if (opts.company) headers.set(COMPANY_HEADER, opts.company);
      if (opts.impersonate) headers.set(IMPERSONATE_HEADER, opts.impersonate);
      const tenant = await resolveTenantContext(env.db, {
        userId,
        companyHeader: opts.company ?? null,
        impersonateHeader: opts.impersonate ?? null,
      });
      return {
        auth: null,
        db: env.db,
        request: new Request("https://api.test", { headers }),
        session: { user: { id: u.id, name: u.name, email: u.email }, session: { id: "test-session" } },
        ...tenant,
      } as never;
    });
  }

  /** A plant with the portal on (and whatever else the test sets). */
  async function portalPlant(settings: Record<string, unknown> = {}): Promise<SalesPlant> {
    return sales.plant({ settings: { portalEnabled: true, ...settings } });
  }

  /**
   * Office grants `email` a login for `customerId`, the party makes its account (a user row, as the
   * invite page's password sign-up does) and accepts the invite. Returns the party's ids and API.
   */
  async function partyLogin(p: SalesPlant, customerId = p.customerId, opts: { email?: string; userId?: string } = {}): Promise<PartyLogin> {
    const env = getEnv();
    const email = opts.email ?? `party.${tag()}@test.orrn`;
    const granted = await p.as("office").portal.users.grant({ customerId, email });
    expect(granted.status).toBe("invited");
    const token = granted.inviteUrl!.split("/invite/")[1]!;
    let userId = opts.userId;
    if (!userId) {
      userId = crypto.randomUUID();
      await env.db.insert(user).values({ id: userId, name: `Party ${tag()}`, email });
    }
    const accepted = await env.callerForUser(userId).invite.acceptByToken({ token });
    expect(accepted).toEqual({ success: true, portal: true });
    return { userId, email, portalUserId: granted.id, api: await headerCaller(userId), token };
  }

  /** A copy of a section; `owner` = copy owner override (null = inherit the section). */
  async function copy(
    companyId: string,
    sectionId: string,
    seqNo: number,
    opts: { owner?: string | null; status?: "available" | "in_use" | "retired"; readingMilli?: number } = {},
  ) {
    const env = getEnv();
    const id = crypto.randomUUID();
    await env.db.insert(dieInstance).values({
      id,
      companyId,
      sectionId,
      seqNo,
      code: `C${tag()}-${seqNo}`,
      status: opts.status ?? "available",
      ownerCustomerId: opts.owner ?? null,
    });
    if (opts.readingMilli) {
      await env.db.insert(dieWeightReading).values({
        id: crypto.randomUUID(),
        companyId,
        dieInstanceId: id,
        kgPer12ftMilli: opts.readingMilli,
        readAt: new Date(),
      });
    }
    return id;
  }

  /** The tRPC error code a promise rejects with. */
  async function codeOf(p: Promise<unknown>): Promise<string> {
    try {
      await p;
    } catch (e) {
      return (e as { code?: string }).code ?? "UNKNOWN";
    }
    return "OK";
  }

  return { ...sales, headerCaller, portalPlant, partyLogin, copy, codeOf };
}
