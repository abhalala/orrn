/**
 * Grant token -> request context for the tool leg (design 2026-11-18, §4.3).
 *
 * Built by hand, never through `createContext`: that would look up a Better Auth session from the request
 * headers and honour a cookie. The context has a fresh `Request` with no inbound headers (the token never
 * sits in `ctx.request`), no platform role, no impersonation, and `via: "buddy"`.
 *
 * Every request re-checks: the grant is not revoked or expired, the membership is active, the company is
 * active and listed in `BUDDY_COMPANIES`, and the role is in `BUDDY_ROLES` and holds `buddy.use`. A plant found
 * suspended or not listed has its grants revoked, not only refused (delta round D-L4, decision 11), so lifting the
 * suspension or listing it again brings no grant back. A stage with no `BUDDY_COMPANIES` at all has the buddy off:
 * refused, not revoked. The
 * synthetic session carries the sign-in method of the browser session that made the grant, so
 * `companyProcedure`'s secure sign-in gate judges the grant exactly like that session (no buddy skip).
 */
import type { createDb } from "@orrn/db";
import { revokeBuddyPlantGrants } from "@orrn/auth/buddy-revoke";
import { buddyGrant, company, membership, user } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { and, eq, sql } from "drizzle-orm";

import type { Context } from "../../context";
import { now } from "../clock";
import { BUDDY_ROLES } from "../permissions";
import { buddyEnv, roleMayUseBuddy } from "./access";
import { buddyCompanies, companyListed } from "./config";
import { hashBuddyToken, looksLikeBuddyToken } from "./token";

type Db = ReturnType<typeof createDb>;

export type BuddyGrantInfo = { id: string; userId: string; companyId: string };

export type BuddyContext = Context & { via: "buddy"; buddyGrantId: string };

/** `last_used_at` moves at most once a minute, so a burst of calls is not a burst of writes. */
const LAST_USED_STEP_MS = 60_000;

export async function contextFromGrant(
  db: Db,
  token: string | null | undefined,
  opts: { roles?: readonly CompanyRole[] } = {},
): Promise<{ ok: true; ctx: BuddyContext; grant: BuddyGrantInfo } | { ok: false }> {
  if (!token || !looksLikeBuddyToken(token)) return { ok: false };
  const at = now();
  const row = await db
    .select({
      id: buddyGrant.id,
      companyId: buddyGrant.companyId,
      userId: buddyGrant.userId,
      revokedAt: buddyGrant.revokedAt,
      expiresAt: buddyGrant.expiresAt,
      lastUsedAt: buddyGrant.lastUsedAt,
      signInMethod: buddyGrant.signInMethod,
      userName: user.name,
      userEmail: user.email,
      membershipId: membership.id,
      role: membership.role,
      companySlug: company.slug,
      companyStatus: company.status,
      strict: sql<number | null>`json_extract(${company.settings}, '$.requireStrongSignIn')`,
    })
    .from(buddyGrant)
    .innerJoin(user, eq(user.id, buddyGrant.userId))
    .innerJoin(company, eq(company.id, buddyGrant.companyId))
    .innerJoin(membership, and(eq(membership.userId, buddyGrant.userId), eq(membership.companyId, buddyGrant.companyId)))
    .where(eq(buddyGrant.tokenHash, await hashBuddyToken(token)))
    .get();
  if (!row) return { ok: false };
  if (row.revokedAt) return { ok: false };
  if (row.expiresAt && row.expiresAt.getTime() <= at.getTime()) return { ok: false };
  if (row.companyStatus === "suspended") return revokePlant(db, row.companyId, "plant_suspended", at);
  if (row.companyStatus !== "active") return { ok: false };
  if (!companyListed(buddyEnv(), row.companySlug)) {
    return buddyCompanies(buddyEnv()).size > 0 ? revokePlant(db, row.companyId, "plant_delisted", at) : { ok: false };
  }
  // Tests may widen the roles (to reach a procedure's own guard); production checks BUDDY_ROLES and buddy.use.
  if (opts.roles ? !opts.roles.includes(row.role) : !roleMayUseBuddy(row.role, BUDDY_ROLES)) return { ok: false };

  if (!row.lastUsedAt || at.getTime() - row.lastUsedAt.getTime() >= LAST_USED_STEP_MS) {
    await db.update(buddyGrant).set({ lastUsedAt: at }).where(eq(buddyGrant.id, row.id));
  }

  const ctx = {
    auth: null,
    db,
    request: new Request("https://buddy.invalid/mcp", { method: "POST" }),
    session: {
      user: { id: row.userId, name: row.userName, email: row.userEmail, image: null },
      session: { id: `buddy:${row.id}`, userId: row.userId, signInMethod: row.signInMethod },
    } as unknown as Context["session"],
    membership: {
      id: row.membershipId,
      companyId: row.companyId,
      role: row.role,
      companyStatus: row.companyStatus,
      requireStrongSignIn: Number(row.strict) === 1,
    },
    companyId: row.companyId,
    role: row.role,
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
    via: "buddy",
    buddyGrantId: row.id,
  } as BuddyContext;
  return { ok: true, ctx, grant: { id: row.id, userId: row.userId, companyId: row.companyId } };
}

/** Ends every live grant of the plant (and its pending drafts and links) in one batch; the call is refused either way. */
async function revokePlant(db: Db, companyId: string, reason: "plant_suspended" | "plant_delisted", at: Date): Promise<{ ok: false }> {
  try {
    await revokeBuddyPlantGrants(db, { companyId }, reason, at);
  } catch {
    // refused anyway; the next call tries the revoke again
  }
  return { ok: false };
}
