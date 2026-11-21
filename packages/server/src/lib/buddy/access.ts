/**
 * Who may use the buddy, and whether it is on (design 2026-11-18, §4.1, §6, §13).
 *
 * - The person: an active membership whose role is in `BUDDY_ROLES` and holds `buddy.use`. Never an
 *   impersonating platform admin (impersonation resolves to `owner`, so `can()` alone would let them in).
 * - The plant: its slug is in `BUDDY_COMPANIES`.
 * - The stage: the four `HERMES_*` names are set.
 * - The link: the person has an active `buddy_link` in this plant (made by "Connect Hermes").
 */
import { env } from "@orrn/env/server";
import { buddyLink, company } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { and, desc, eq } from "drizzle-orm";

import type { Context } from "../../context";
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
};

export async function buddyAccess(ctx: BuddyAccessCtx): Promise<BuddyAccess> {
  const none: BuddyAccess = { person: false, listed: false, configured: false, link: null };
  const userId = ctx.session?.user.id;
  if (!userId || !ctx.companyId || ctx.impersonation || ctx.via === "buddy") return none;
  const person = roleMayUseBuddy(ctx.role);
  const configured = hermesReady(buddyEnv());
  const plant = await ctx.db
    .select({ slug: company.slug, status: company.status })
    .from(company)
    .where(eq(company.id, ctx.companyId))
    .get();
  const listed = plant?.status === "active" && companyListed(buddyEnv(), plant.slug);
  if (!person || !listed) return { person, listed, configured, link: null };
  const link = await ctx.db
    .select({ id: buddyLink.id, hermesProfile: buddyLink.hermesProfile })
    .from(buddyLink)
    .where(and(eq(buddyLink.companyId, ctx.companyId), eq(buddyLink.userId, userId), eq(buddyLink.status, "active")))
    .orderBy(desc(buddyLink.createdAt))
    .get();
  return { person, listed, configured, link: link ?? null };
}

/** `auth.me.buddy` (§13): on this stage, the role may, the plant is listed, and the person is connected. */
export function buddyOn(access: BuddyAccess): boolean {
  return access.person && access.listed && access.configured && access.link !== null;
}
