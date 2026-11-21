/**
 * Who may use the buddy, and whether it is on (design 2026-11-18, §4.1, §6, §13).
 *
 * - The person: an active membership whose role is in `BUDDY_ROLES` and holds `buddy.use`. Never an
 *   impersonating platform admin (impersonation resolves to `owner`, so `can()` alone would let them in).
 * - The plant: its slug is in `BUDDY_COMPANIES`.
 * - The stage: the four `HERMES_*` names are set.
 * - The link: the person has an active `buddy_link` in this plant (made by "Connect Hermes").
 * - The grant: the person holds a grant here that is neither revoked nor past `expires_at` (D-L1): without one the
 *   chat answers 404 and the launcher hides, the same way for a revoked and a run-out key.
 */
import { isAllowedWebOrigin } from "@orrn/auth/origins";
import { env } from "@orrn/env/server";
import { buddyGrant, buddyLink, company } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import type { Context } from "../../context";
import { now } from "../clock";
import { isDevLocalOrigin } from "../devOrigins";
import { BUDDY_ROLES, can } from "../permissions";
import { companyListed, hermesReady, type BuddyEnv } from "./config";

export type BuddyAccessCtx = Pick<Context, "db" | "companyId" | "role" | "impersonation" | "session"> & {
  via?: "buddy";
};

/** The role may use the buddy: in `BUDDY_ROLES` and holding `buddy.use`. */
export function roleMayUseBuddy(role: CompanyRole | null | undefined, roles: readonly CompanyRole[] = BUDDY_ROLES): boolean {
  if (!role || !roles.includes(role)) return false;
  return can({ company: { role }, isPlatformAdmin: false, platformRole: null }, "buddy.use");
}

export function buddyEnv(): BuddyEnv {
  return env as unknown as BuddyEnv;
}

export type BuddyAccess = {
  /** The person (role, not impersonating, not the tool leg) may use the buddy here. */
  person: boolean;
  /** The plant is listed in `BUDDY_COMPANIES`. */
  listed: boolean;
  /** The four `HERMES_*` names are set on this stage. */
  configured: boolean;
  /** The person's active link in this plant, if any. */
  link: { id: string; hermesProfile: string } | null;
  /** The person's newest grant here that is not revoked and not past `expires_at`, if any (D-L1). */
  grantId: string | null;
};

/**
 * The request comes from one of the web origins the API's CORS answers (`CORS_ORIGIN`, `CORS_ALLOWED_ORIGINS`, and
 * localhost on a development stage). A missing Origin and the string `null` are refused. The buddy's chat and its
 * tRPC mutations need this (security H1, M5): a cross-site form carries a foreign Origin or none.
 */
export function requestOriginAllowed(request: Request | null | undefined): boolean {
  const origin = request?.headers.get("origin")?.trim() ?? "";
  if (!origin || origin === "null") return false;
  const e = env as unknown as { NODE_ENV?: string; CORS_ORIGIN?: string; CORS_ALLOWED_ORIGINS?: string };
  return isAllowedWebOrigin(origin, { corsOrigin: e.CORS_ORIGIN ?? "", corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS }) || isDevLocalOrigin(e, origin);
}

/**
 * `plant`: the active plant's slug and status when the caller has them already (`auth.me`), so no extra read.
 * A person whose role may not use the buddy reads nothing at all (review N4).
 */
export async function buddyAccess(ctx: BuddyAccessCtx, known: { plant?: { slug: string; status: string } } = {}): Promise<BuddyAccess> {
  const none: BuddyAccess = { person: false, listed: false, configured: false, link: null, grantId: null };
  const userId = ctx.session?.user.id;
  if (!userId || !ctx.companyId || ctx.impersonation || ctx.via === "buddy") return none;
  const person = roleMayUseBuddy(ctx.role);
  if (!person) return none;
  const configured = hermesReady(buddyEnv());
  const plant =
    known.plant ??
    (await ctx.db.select({ slug: company.slug, status: company.status }).from(company).where(eq(company.id, ctx.companyId)).get());
  const listed = plant?.status === "active" && companyListed(buddyEnv(), plant.slug);
  if (!listed) return { person, listed, configured, link: null, grantId: null };
  const link = await ctx.db
    .select({ id: buddyLink.id, hermesProfile: buddyLink.hermesProfile })
    .from(buddyLink)
    .where(and(eq(buddyLink.companyId, ctx.companyId), eq(buddyLink.userId, userId), eq(buddyLink.status, "active")))
    .orderBy(desc(buddyLink.createdAt))
    .get();
  if (!link) return { person, listed, configured, link: null, grantId: null };
  const grant = await ctx.db
    .select({ id: buddyGrant.id })
    .from(buddyGrant)
    .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.userId, userId), isNull(buddyGrant.revokedAt), or(isNull(buddyGrant.expiresAt), gt(buddyGrant.expiresAt, now()))))
    .orderBy(desc(buddyGrant.createdAt))
    .get();
  return { person, listed, configured, link, grantId: grant?.id ?? null };
}

/** `auth.me.buddy` (§13): on this stage, the role may, the plant is listed, and the person is connected with a live grant. */
export function buddyOn(access: BuddyAccess): boolean {
  return access.person && access.listed && access.configured && access.link !== null && access.grantId !== null;
}
