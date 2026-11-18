import type { createDb } from "@orrn/db";
import { auditLog } from "@orrn/db/schema/audit";
import { account, passkey, user } from "@orrn/db/schema/auth";
import { company, membership } from "@orrn/db/schema/tenant";
import { APIError } from "better-auth/api";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";

import { writeAuthLog } from "./logger";

/**
 * The ways an account signs in, and the two rules on removing them (plan 2026-11-18; spec Design
 * §7-10, Settings > Sign-in). One source for every reader: the magic-link guard, Godseye's owner
 * sign-in (`routers/platform/waitlist.ts`), `auth.me`, `auth.signInMethods` and the hooks below.
 *
 * - A way in is a password (a `credential` account with a password), a passkey, or a linked Google
 *   account. The authenticator app is a second factor, not a way in on its own.
 * - A strong method is the authenticator app (`user.twoFactorEnabled`; a `two_factor` row alone may
 *   be a half-finished enrolment), a passkey, or Google.
 * - LAST_SIGN_IN_METHOD: no removal may leave an account with no way in.
 * - COMPANY_REQUIRES_STRONG_METHOD: while an active plant the person belongs to requires secure
 *   sign-in (`company.settings.requireStrongSignIn`, spec Amendment 2026-11-18 item 3), they may not
 *   remove or turn off their last strong method. Two-factor is otherwise the person's own choice,
 *   owners included.
 *
 * Tested in packages/server/test/auth-sign-in-methods.test.ts and auth-plant-policy.test.ts.
 */
export const LAST_SIGN_IN_METHOD = "LAST_SIGN_IN_METHOD";
export const COMPANY_REQUIRES_STRONG_METHOD = "COMPANY_REQUIRES_STRONG_METHOD";
/** The rows changed under a removal while it was being judged (council rounds 1 and 2). */
export const SIGN_IN_CHANGE_BUSY = "SIGN_IN_CHANGE_BUSY";

/** Server text for the removal refusals (`sign-in-removal.ts`); the apps show their own words by code. */
export const SIGN_IN_CHANGE_MESSAGES = {
  [LAST_SIGN_IN_METHOD]: "This is the last way to sign in to this account. Add another one first.",
  [COMPANY_REQUIRES_STRONG_METHOD]:
    "A plant you belong to requires secure sign-in. Keep a passkey, Google or the authenticator app, or add another one first.",
  [SIGN_IN_CHANGE_BUSY]: "Another change to your sign-in is still saving. Try again in a moment.",
} as const;

type Db = ReturnType<typeof createDb>;

export type SignInMethods = { password: boolean; passkeys: number; google: boolean; authenticator: boolean };

export async function signInMethodsFor(db: Db, userId: string): Promise<SignInMethods> {
  const [row, credential, passkeys, google] = await Promise.all([
    db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).get(),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential"), isNotNull(account.password)))
      .get(),
    db.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId)).get(),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
      .get(),
  ]);
  return {
    password: Boolean(credential),
    passkeys: passkeys?.n ?? 0,
    google: Boolean(google),
    authenticator: row?.twoFactorEnabled === true,
  };
}

/** True when the account has a way in (password, passkey or Google). */
export const hasWayIn = (m: SignInMethods) => m.password || m.passkeys > 0 || m.google;
/** True when the account has a strong method (authenticator app, passkey or Google). */
export const hasStrongMethod = (m: SignInMethods) => m.authenticator || m.passkeys > 0 || m.google;

/**
 * True when an active plant the user belongs to requires secure sign-in
 * (`company.settings.requireStrongSignIn`). A suspended plant does not count: the person cannot enter
 * it (tenantContext refuses it), so its policy does not hold them.
 */
export async function plantRequiresStrongSignIn(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(
      and(
        eq(membership.userId, userId),
        eq(company.status, "active"),
        sql`json_extract(${company.settings}, '$.requireStrongSignIn') = 1`,
      ),
    )
    .get();
  return Boolean(row);
}

export const PASSKEY_REGISTER_PATH = "/passkey/verify-registration";

/**
 * The removals themselves (passkey delete, Google or password unlink, two-factor off) are done by the
 * before-hook in one conditional statement each, so the two rules above hold at the write
 * (`sign-in-removal.ts`, council round 2). `SIGN_IN_CHANGE_BUSY` is what a removal answers when the
 * rows kept changing under it (two retries), which only a burst of concurrent changes can cause.
 */

/**
 * Writes one user-level audit row (no plant; `audit_log.company_id` is nullable). Never throws: the
 * sign-in change it records has already happened. Meta carries row ids only, never a credential id,
 * a public key or a Google token.
 */
export async function writeUserAudit(
  db: Db,
  input: { userId: string; action: "auth.passkey.add" | "auth.passkey.remove" | "auth.google.link"; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      companyId: null,
      actorId: input.userId,
      action: input.action,
      subjectType: "user",
      subjectId: input.userId,
      meta: input.meta ?? {},
    });
  } catch (error) {
    writeAuthLog("error", `audit ${input.action} not written`, error instanceof Error ? error.name : "unknown");
  }
}

type AfterCtx = { path?: string; context: { returned?: unknown } };

/** The endpoint's answer: in-process calls get the object, the HTTP handler a `{ body, _flag: "json" }` wrapper. */
function returnedBody(returned: unknown): Record<string, unknown> | null {
  if (!returned || typeof returned !== "object" || returned instanceof APIError || returned instanceof Response) return null;
  const value = returned as Record<string, unknown>;
  if (value._flag === "json") {
    const body = value.body;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  }
  return value;
}

/**
 * Better Auth `hooks.after`: audit a passkey added. Never throws. (A removed passkey is audited by the
 * removal itself, `sign-in-removal.ts`.)
 */
export async function signInAuditAfter(db: Db, ctx: AfterCtx): Promise<void> {
  try {
    if (ctx.path === PASSKEY_REGISTER_PATH) {
      const created = returnedBody(ctx.context.returned);
      if (typeof created?.id !== "string" || typeof created.userId !== "string") return;
      await writeUserAudit(db, { userId: created.userId, action: "auth.passkey.add", meta: { passkeyId: created.id } });
    }
  } catch (error) {
    writeAuthLog("error", "sign-in audit failed", error instanceof Error ? error.name : "unknown");
  }
}
