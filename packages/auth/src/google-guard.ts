import type { createDb } from "@orrn/db";
import { atomicBatch } from "@orrn/db/atomic";
import { account, passkey, session, twoFactor, user } from "@orrn/db/schema/auth";
import { invite, platformAdmin } from "@orrn/db/schema/tenant";
import { APIError, getOAuthState } from "better-auth/api";
import { google } from "better-auth/social-providers";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { assertEnrolmentAllowed } from "./enrolment-guard";
import { sessionOfRequest, upgradeSession } from "./session-method";
import { writeUserAudit } from "./sign-in-methods";

/**
 * Google sign-in (plan 2026-11-18; spec Design §3-6). ORRN has no public sign-up (D14), so:
 *
 * - Google makes an account only for an email with a live invite (not accepted, not revoked, not
 *   expired; any plant, member or portal kind), and then accepts every live invite for that email
 *   through `@orrn/server`'s `acceptLiveInvitesFor` (registered with `configureAuthHooks`).
 * - Godseye staff (a `platform_admin` row, the source `platformProcedure` reads) never sign in with
 *   Google: those accounts reach every plant. They use a passkey or a password and code.
 * - Only a Google email Google itself verified (`email_verified`) counts.
 * - Google proves the mailbox. Linking it to an account whose email was never proven removes the
 *   old password and ends every other session (closes "an admin set a password on someone else's
 *   address"); an already-proven account is only linked.
 *
 * The checks run in the provider's `getUserInfo`, the one step both flows (`/sign-in/social` with an
 * id token, and the browser's `/callback/google`) pass before Better Auth links or creates anything.
 * The id-token flow answers 403 with the code; the redirect flow lands on the OAuth error URL
 * (`<web>/login` unless the client named another trusted one) with `?error=CODE`. Database hooks
 * back the create rule up. Tested in packages/server/test/auth-google.test.ts.
 *
 * Never log Google tokens, invite tokens or links, or the email: invite ids only.
 */
export const GOOGLE_NOT_INVITED = "GOOGLE_NOT_INVITED";
export const GOOGLE_NOT_FOR_STAFF = "GOOGLE_NOT_FOR_STAFF";
export const GOOGLE_EMAIL_NOT_VERIFIED = "GOOGLE_EMAIL_NOT_VERIFIED";
/**
 * Council round 1, A6 (Claude I2): Google sign-in links itself to an existing account by email with no
 * code. Anyone who controls the mailbox can make a Google account on that address, so for an account
 * that already has a passkey or the authenticator app, that would skip the code (and, while the email is
 * unconfirmed, wipe those methods). Such an account is refused at sign-in; linking from Settings >
 * Sign-in while signed in (`linkSocial`) stays allowed. An account with only a password, or none (an
 * invitee, dad), still gets one-tap Google: the reset email already gave the mailbox that much.
 */
export const GOOGLE_LINK_FROM_SETTINGS = "GOOGLE_LINK_FROM_SETTINGS";

const MESSAGES = {
  [GOOGLE_NOT_INVITED]: "This Google account has no ORRN invite. Ask your admin to invite this email.",
  [GOOGLE_NOT_FOR_STAFF]: "Godseye staff accounts sign in with a passkey or a password and code, not Google.",
  [GOOGLE_EMAIL_NOT_VERIFIED]: "Google has not verified this email. Sign in another way.",
  [GOOGLE_LINK_FROM_SETTINGS]:
    "This account already has a passkey or authenticator. Sign in with it, then link Google in Settings > Sign-in.",
} as const;
type GoogleRefusal = keyof typeof MESSAGES;

type Db = ReturnType<typeof createDb>;

/** What `@orrn/server` lends the auth package (it cannot import `@orrn/server`). */
export type AuthHooks = {
  /** Accepts every live invite for the email; returns how many. Refusals are skipped, never thrown. */
  acceptLiveInvitesFor?: (db: Db, userId: string, email: string) => Promise<number>;
};

// Module state on purpose: `resetAuthForTests` drops auth instances, never this registration.
let registered: AuthHooks = {};

/** Called once by `@orrn/server` when it loads (`context.ts`, next to `createAuth`). */
export function configureAuthHooks(hooks: AuthHooks): void {
  registered = { ...registered, ...hooks };
}

/** True when a live invite (any company, member or portal kind) exists for the email. */
export async function googleCreateAllowed(db: Db, email: string, now: Date = new Date()): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const row = await db
    .select({ id: invite.id })
    .from(invite)
    .where(and(sql`lower(${invite.email}) = ${address}`, isNull(invite.acceptedAt), isNull(invite.revokedAt), gt(invite.expiresAt, now)))
    .get();
  return Boolean(row);
}

/** True when the user is Godseye staff (has a `platform_admin` row, as `platformProcedure` requires). */
export async function isPlatformStaff(db: Db, userId: string): Promise<boolean> {
  const row = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(eq(platformAdmin.userId, userId)).get();
  return Boolean(row);
}

/**
 * Refuses a Google sign-in. In the browser redirect flow (an OAuth state is in this request) the
 * answer is a redirect to the flow's error URL with `?error=CODE`; otherwise a 403 with the code.
 */
async function refuse(code: GoogleRefusal): Promise<never> {
  const state = await getOAuthState().catch(() => null);
  if (state?.errorURL) {
    const sep = state.errorURL.includes("?") ? "&" : "?";
    throw new APIError("FOUND", undefined, new Headers({ location: `${state.errorURL}${sep}error=${code}` }));
  }
  throw new APIError("FORBIDDEN", { code, message: MESSAGES[code] });
}

type GoogleIdentity = { id: string | number; email?: string | null; emailVerified?: boolean | null };

/** True when the account has a passkey or the authenticator app on (A6). */
async function hasPasskeyOrAuthenticator(db: Db, userId: string): Promise<boolean> {
  const [row, key] = await Promise.all([
    db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).get(),
    db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).get(),
  ]);
  return row?.on === true || Boolean(key);
}

/**
 * Decides a Google identity before Better Auth links or creates anything. The account is found the
 * way Better Auth's `findOAuthUser` finds it: the linked Google account first, then the email.
 * `linkingUserId`: the signed-in person linking Google from Settings (`linkSocial`); the A6 refusal is
 * skipped only when the account found by email is that same person.
 */
export async function guardGoogleIdentity(
  db: Db,
  identity: GoogleIdentity,
  now: Date = new Date(),
  opts: { linkingUserId?: string | null } = {},
): Promise<void> {
  if (identity.emailVerified !== true) await refuse(GOOGLE_EMAIL_NOT_VERIFIED);
  const email = (identity.email ?? "").trim().toLowerCase();
  const linked = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "google"), eq(account.accountId, String(identity.id))))
    .get();
  const byEmail = linked || !email ? undefined : await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`).get();
  const userId = linked?.userId ?? byEmail?.id;
  if (userId) {
    if (await isPlatformStaff(db, userId)) await refuse(GOOGLE_NOT_FOR_STAFF);
    // A6: found by email, not yet linked, and this is a sign-in: never link over a passkey or the code.
    const ownLink = Boolean(opts.linkingUserId) && opts.linkingUserId === byEmail?.id;
    if (byEmail && !ownLink && (await hasPasskeyOrAuthenticator(db, byEmail.id))) await refuse(GOOGLE_LINK_FROM_SETTINGS);
    return;
  }
  if (!(await googleCreateAllowed(db, email, now))) await refuse(GOOGLE_NOT_INVITED);
}

/**
 * Id tokens a signed-in person sent to `/link-social` (Settings > Sign-in), with that person's user id, so
 * the provider's `getUserInfo`, which only sees the token, knows the request is that person's link and not
 * a sign-in. Filled by the auth before-hook (`noteGoogleLinkToken`), which runs before Better Auth checks
 * the session, so the hook reads the session itself and notes nothing without one: a token sent with no
 * session, or by someone else, never exempts a sign-in for another account. Emptied by the after-hook;
 * each entry also expires after a minute. The browser redirect flow needs none of this: its OAuth state
 * carries `link.userId`.
 */
const LINK_TOKEN_TTL_MS = 60_000;
const linkTokens = new Map<string, { userId: string; until: number }>();

export const LINK_SOCIAL_PATH = "/link-social";

function tokenOf(ctx: { body?: unknown }): string | null {
  const token = (ctx.body as { idToken?: { token?: unknown } } | undefined)?.idToken?.token;
  return typeof token === "string" && token ? token : null;
}

/** `hooks.before` on `/link-social`: remember the id token as this signed-in person's link. */
export async function noteGoogleLinkToken(db: Db, ctx: { path?: string; body?: unknown }, nowMs = Date.now()): Promise<void> {
  if (ctx.path !== LINK_SOCIAL_PATH) return;
  const token = tokenOf(ctx);
  if (!token) return;
  for (const [key, entry] of linkTokens) if (entry.until <= nowMs) linkTokens.delete(key);
  const current = await sessionOfRequest(db, ctx);
  if (!current) return;
  linkTokens.set(token, { userId: current.userId, until: nowMs + LINK_TOKEN_TTL_MS });
}

/** `hooks.after` on `/link-social`: forget it. */
export function forgetGoogleLinkToken(ctx: { path?: string; body?: unknown }): void {
  if (ctx.path !== LINK_SOCIAL_PATH) return;
  const token = tokenOf(ctx);
  if (token) linkTokens.delete(token);
}

/** The user linking Google in this request (OAuth state `link.userId`, or a noted id token), else null. */
async function linkingUserId(token: { idToken?: string }): Promise<string | null> {
  const state = await getOAuthState().catch(() => null);
  const link = state && typeof state === "object" && "link" in state ? (state as { link?: { userId?: unknown } }).link : undefined;
  if (link && typeof link.userId === "string" && link.userId) return link.userId;
  const entry = token.idToken ? linkTokens.get(token.idToken) : undefined;
  return entry && entry.until > Date.now() ? entry.userId : null;
}

type GoogleEnv = { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };

/**
 * `socialProviders` for the stage: Google only when both its id and secret are set (the same rule
 * `auth.methods` reports), so an unconfigured stage simply has no Google.
 */
export function googleProviderFor(db: Db, environment: GoogleEnv) {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};
  // Better Auth's own id-token decoding, with the ORRN checks after it.
  const base = google({ clientId, clientSecret });
  return {
    google: {
      clientId,
      clientSecret,
      prompt: "select_account" as const,
      getUserInfo: async (token: Parameters<typeof base.getUserInfo>[0]) => {
        const info = await base.getUserInfo(token);
        if (!info) return null;
        await guardGoogleIdentity(db, info.user, new Date(), { linkingUserId: await linkingUserId(token as { idToken?: string }) });
        return info;
      },
    },
  };
}

/** The web sign-in page, where a refused browser sign-in lands (`WEB_PUBLIC_URL`, else `CORS_ORIGIN`). */
export function webLoginUrl(environment: { WEB_PUBLIC_URL?: string; CORS_ORIGIN?: string }): string | undefined {
  const web = environment.WEB_PUBLIC_URL ?? environment.CORS_ORIGIN;
  if (!web) return undefined;
  try {
    return new URL("/login", web).toString();
  } catch {
    return undefined;
  }
}

type HookCtx = { path?: string; context?: { session?: { session: { id: string; userId: string } } | null } } | null;

/** Accounts are created over these paths only by a social provider, and Google is the only one. */
const SOCIAL_PATHS = new Set(["/sign-in/social", "/callback/:id"]);
const isSocialSignIn = (ctx: HookCtx) => Boolean(ctx?.path && SOCIAL_PATHS.has(ctx.path));

async function acceptInvitesQuietly(db: Db, userId: string, email: string): Promise<void> {
  const accept = registered.acceptLiveInvitesFor;
  if (!accept) {
    console.warn("Google sign-up: invite acceptance is not wired; the invites stay open for the invite page");
    return;
  }
  try {
    await accept(db, userId, email);
  } catch (error) {
    // The account exists already; the invite page can still accept. No message: it may carry the address.
    console.error("Google sign-up: accepting invites failed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * When Google is linked to an account whose email was never proven, Google has just proven it, and
 * whoever set the account up (an admin who also saw the invite link, say) may still hold a way in.
 * So every sign-in method that person could have added goes: the password (and any must-change
 * flag), every passkey, the authenticator app (its `two_factor` row and `twoFactorEnabled`), and
 * every other session; and the email is marked verified. One D1 batch, all or nothing.
 *
 * It runs before Better Auth writes the link row. If the batch fails, nothing changes and nothing
 * is linked. If the link write fails after the batch, the old methods are already gone and the
 * account is verified but not linked; a retry recovers: the account is verified now, so Better Auth
 * links it and this clean-up does not run again.
 *
 * Council round 2 (Gemini): the session that is linking (Settings > Sign-in, the secure step) is kept.
 * In the redirect flow's callback `ctx.context.session` is empty, so it is found from the request's own
 * session cookie (`sessionOfRequest`); the account-create after-hook then upgrades it to Google.
 */
async function onGoogleLink(db: Db, userId: string, ctx: HookCtx): Promise<void> {
  const row = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, userId)).get();
  if (!row) return;
  if (await isPlatformStaff(db, userId)) throw new APIError("FORBIDDEN", { code: GOOGLE_NOT_FOR_STAFF, message: MESSAGES[GOOGLE_NOT_FOR_STAFF] });
  if (row.emailVerified) return;
  const current = ctx?.context?.session?.session ?? (await sessionOfRequest(db, ctx));
  const keep = current && current.userId === userId ? current.id : null;
  await atomicBatch(db, [
    db.delete(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))),
    db.delete(passkey).where(eq(passkey.userId, userId)),
    db.delete(twoFactor).where(eq(twoFactor.userId, userId)),
    db.delete(session).where(keep ? and(eq(session.userId, userId), ne(session.id, keep)) : eq(session.userId, userId)),
    db.update(user).set({ emailVerified: true, mustChangePassword: false, twoFactorEnabled: false }).where(eq(user.id, userId)),
  ]);
}

/** Better Auth `databaseHooks` for Google: the create backstop, onboarding, and the link rules. */
export function googleDatabaseHooks(db: Db) {
  return {
    user: {
      create: {
        before: async (data: { email: string } & Record<string, unknown>, ctx: HookCtx) => {
          if (!isSocialSignIn(ctx)) return;
          // Backstop for the getUserInfo check. Better Auth turns this into `?error=GOOGLE_NOT_INVITED`
          // (redirect flow) or OAUTH_LINK_ERROR carrying that message (id-token flow).
          if (!(await googleCreateAllowed(db, data.email ?? ""))) throw new APIError("FORBIDDEN", { code: GOOGLE_NOT_INVITED, message: GOOGLE_NOT_INVITED });
          // Merged into the row by Better Auth: the guard accepted only a Google-verified email.
          return { data: { emailVerified: true } };
        },
        // Runs after the user and its Google account are written. Never throws: the account exists.
        after: async (created: { id: string; email: string }, ctx: HookCtx) => {
          if (!isSocialSignIn(ctx)) return;
          await acceptInvitesQuietly(db, created.id, created.email);
        },
      },
    },
    account: {
      create: {
        before: async (data: { providerId?: unknown; userId?: unknown }, ctx: HookCtx) => {
          if (data.providerId !== "google" || typeof data.userId !== "string") return;
          // Council round 2 (N-C1): a link from a weak session of a person who already has a strong
          // method, in a strict plant, is refused here too (the redirect flow's callback carries no
          // path the before-hook can tell from a sign-in). A Google sign-in has no session of this user.
          const linking = await sessionOfRequest(db, ctx);
          if (linking?.userId === data.userId) await assertEnrolmentAllowed(db, { userId: data.userId, signInMethod: linking.signInMethod });
          await onGoogleLink(db, data.userId, ctx);
        },
        // The link row exists now (a new account made by Google included). User-level audit, no
        // plant; never the Google account id or a token. Never throws.
        // Council round 1, A4: Google linked while signed in (Settings > Sign-in, the secure step) has
        // just been proven in this session, so the session counts as a Google sign-in from now on.
        after: async (created: { providerId?: unknown; userId?: unknown }, ctx: HookCtx) => {
          if (created.providerId !== "google" || typeof created.userId !== "string") return;
          await writeUserAudit(db, { userId: created.userId, action: "auth.google.link" });
          const current = await sessionOfRequest(db, ctx);
          if (current?.userId === created.userId) {
            await upgradeSession(db, { sessionId: current.id, userId: created.userId, method: "google" });
          }
        },
      },
    },
  };
}
