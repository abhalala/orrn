/**
 * Customer portal (FP-PF-01..04, Wave 3; C29). A party login is a `customer_portal_user` row, never a
 * membership or a company role. Everything here derives the company AND the customer from that row.
 *
 * Visibility (specs §E7 "Rules", platform spec §6):
 * - a section (catalogue `die`) is visible when a live `customer_portal_section` grant exists for this
 *   customer, OR this customer is the effective owner of the section or of at least one live copy;
 * - a copy is visible when its effective owner (copy column, else the section's) is null (plant) or
 *   this customer: a copy another customer owns is hidden even when the section is granted;
 * - a grant never overrides a foreign SECTION owner: a section another customer owns shows only when
 *   one of its copies is overridden to this customer (then only that copy shows);
 * - archived / deleted sections and retired copies never show;
 * - anything outside these rules answers NOT_FOUND "Not found" (never FORBIDDEN, never a hint).
 */
import { readFloorSettings, type FloorSettings } from "@orrn/domain";
import { customer } from "@orrn/db/schema/customers";
import { customerPortalUser } from "@orrn/db/schema/portal";
import { company, membership } from "@orrn/db/schema/tenant";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import type { OrrnDb } from "./atomic";

/** The one answer a portal caller gets for anything it may not see (rule: miss = Not found). */
export const PORTAL_NOT_FOUND = "Not found";

export function portalNotFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: PORTAL_NOT_FOUND });
}

export const PORTAL_REFUSALS = {
  noAccess: "Party portal access required",
  wrongPlant: "You don't have access to that plant",
  disabled: "The party portal is off for this plant",
  impersonation: "The party portal can't be opened while acting as a plant",
  member: "This login works in the plant here. Use the plant screens",
} as const;

export type PortalAccess = {
  portalUserId: string;
  companyId: string;
  companyName: string;
  customerId: string;
  customerName: string;
  settings: Record<string, unknown>;
  floor: FloorSettings;
};

/** The user's active portal rows in active plants (customer not deleted), most recently accepted first. */
export async function listPortalAccess(db: OrrnDb, userId: string) {
  const rows = await db
    .select({
      portalUserId: customerPortalUser.id,
      companyId: customerPortalUser.companyId,
      companyName: company.name,
      customerId: customerPortalUser.customerId,
      customerName: customer.name,
      settings: company.settings,
    })
    .from(customerPortalUser)
    .innerJoin(company, eq(company.id, customerPortalUser.companyId))
    .innerJoin(
      customer,
      and(eq(customer.id, customerPortalUser.customerId), eq(customer.companyId, customerPortalUser.companyId)),
    )
    .where(
      and(
        eq(customerPortalUser.userId, userId),
        eq(customerPortalUser.status, "active"),
        eq(company.status, "active"),
        sql`${customer.deletedAt} is null`,
      ),
    )
    .orderBy(desc(customerPortalUser.acceptedAt), desc(customerPortalUser.id));
  return rows.map((r) => {
    const settings = (r.settings ?? {}) as Record<string, unknown>;
    return { ...r, settings, floor: readFloorSettings(settings) };
  });
}

/**
 * Resolve the portal half of a request (portalProcedure). `companyHeader` (`x-orrn-company`) picks
 * the plant for a party with logins in several plants; naming a plant without an active portal row
 * there is FORBIDDEN, never a fallback (RP2). Then: portalEnabled, and no membership in that plant.
 */
export async function resolvePortalAccess(
  db: OrrnDb,
  input: { userId: string; companyHeader: string | null },
): Promise<PortalAccess> {
  const rows = await listPortalAccess(db, input.userId);
  const chosen = input.companyHeader ? rows.find((r) => r.companyId === input.companyHeader) : rows[0];
  if (!chosen) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: input.companyHeader && rows.length > 0 ? PORTAL_REFUSALS.wrongPlant : PORTAL_REFUSALS.noAccess,
    });
  }
  if (!chosen.floor.portalEnabled) throw new TRPCError({ code: "FORBIDDEN", message: PORTAL_REFUSALS.disabled });
  // PF §9-12: never both staff and party in one plant (grant and accept refuse it; this re-checks).
  const [member] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.userId, input.userId), eq(membership.companyId, chosen.companyId)))
    .limit(1);
  if (member) throw new TRPCError({ code: "FORBIDDEN", message: PORTAL_REFUSALS.member });
  return chosen;
}

/** True when this user has a non-revoked portal row (invited or active) in the plant. */
export async function hasLivePortalRow(db: OrrnDb, companyId: string, by: { userId?: string; email?: string }) {
  const who = by.userId
    ? eq(customerPortalUser.userId, by.userId)
    : sql`${customerPortalUser.email} = ${(by.email ?? "").toLowerCase()}`;
  const [row] = await db
    .select({ id: customerPortalUser.id })
    .from(customerPortalUser)
    .where(and(eq(customerPortalUser.companyId, companyId), who, sql`${customerPortalUser.status} <> 'revoked'`))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Visibility SQL (no id lists bound: fixed parameter count whatever the catalogue size)
// ---------------------------------------------------------------------------

/**
 * Predicate on an outer `die` row aliased as `d`: visible to `customerId` in `companyId`.
 * Grant counts only when the section is not owned by another customer.
 */
export function sectionVisibleSql(companyId: string, customerId: string): SQL {
  return sql`(d.company_id = ${companyId} and d.deleted_at is null and d.status = 'active' and (
    d.owner_customer_id = ${customerId}
    or ((d.owner_customer_id is null or d.owner_customer_id = ${customerId}) and exists (
      select 1 from customer_portal_section g
      where g.company_id = d.company_id and g.customer_id = ${customerId} and g.die_id = d.id and g.revoked_at is null))
    or exists (
      select 1 from die_instance ci
      where ci.company_id = d.company_id and ci.section_id = d.id and ci.status <> 'retired'
        and ci.owner_customer_id = ${customerId})
  ))`;
}

/** Predicate on a copy `ci` of section `d`: its effective owner is the plant or this customer. */
export function copyVisibleSql(customerId: string): SQL {
  return sql`(ci.status <> 'retired' and (coalesce(ci.owner_customer_id, d.owner_customer_id) is null
    or coalesce(ci.owner_customer_id, d.owner_customer_id) = ${customerId}))`;
}

/** Most sections one portal list returns (a party sees a handful; this only bounds the read). */
export const MAX_PORTAL_SECTIONS = 500;

export type PortalSection = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  profileKind: string | null;
  alloy: string | null;
  temper: string | null;
  /** Band per 12 ft (grams); null when the plant hides die bands. */
  band: { minG: number; maxG: number } | null;
  granted: boolean;
  owned: boolean;
};

export type PortalCopy = {
  id: string;
  sectionId: string;
  code: string;
  /** Latest reading, grams per 12 ft. */
  latestKgPer12ftMilli: number | null;
  band: { minG: number; maxG: number } | null;
};

type SectionRow = {
  id: string;
  series: string;
  section_code: string;
  name: string | null;
  profile_kind: string | null;
  alloy: string | null;
  temper: string | null;
  weight_min_g: number;
  weight_max_g: number;
  granted: number;
  owned: number;
};

type CopyRow = {
  id: string;
  section_id: string;
  code: string;
  latest: number | null;
  band_min: number | null;
  band_max: number | null;
  weight_min_g: number;
  weight_max_g: number;
};

/** The visible sections (and optionally only one), with their visible copies. */
export async function visibleSections(
  db: OrrnDb,
  access: Pick<PortalAccess, "companyId" | "customerId" | "floor">,
  opts: { sectionId?: string } = {},
): Promise<{ sections: PortalSection[]; copies: PortalCopy[] }> {
  const { companyId, customerId } = access;
  const only = opts.sectionId ? sql` and d.id = ${opts.sectionId}` : sql``;
  const sections = await db.all<SectionRow>(sql`
    select d.id, d.series, d.section_code, d.name, d.profile_kind, d.alloy, d.temper, d.weight_min_g, d.weight_max_g,
      exists (select 1 from customer_portal_section g where g.company_id = d.company_id and g.customer_id = ${customerId}
        and g.die_id = d.id and g.revoked_at is null) as granted,
      (d.owner_customer_id = ${customerId} or exists (select 1 from die_instance ci where ci.company_id = d.company_id
        and ci.section_id = d.id and ci.status <> 'retired' and ci.owner_customer_id = ${customerId})) as owned
    from die d
    where ${sectionVisibleSql(companyId, customerId)}${only}
    order by d.series, d.section_code
    limit ${MAX_PORTAL_SECTIONS}`);
  const copies = await db.all<CopyRow>(sql`
    select ci.id, ci.section_id, ci.code,
      (select r.kg_per_12ft_milli from die_weight_reading r where r.company_id = ci.company_id and r.die_instance_id = ci.id
        order by r.read_at desc, r.id desc limit 1) as latest,
      b.weight_min_g as band_min, b.weight_max_g as band_max, d.weight_min_g, d.weight_max_g
    from die_instance ci
    join die d on d.id = ci.section_id and d.company_id = ci.company_id
    left join die_band b on b.id = ci.band_id and b.company_id = ci.company_id
    where ci.company_id = ${companyId} and ${sectionVisibleSql(companyId, customerId)} and ${copyVisibleSql(customerId)}${only}
    order by d.series, d.section_code, ci.seq_no
    limit ${MAX_PORTAL_SECTIONS * 4}`);
  const showBand = access.floor.dieBands;
  return {
    sections: sections.map((r) => ({
      id: r.id,
      series: r.series,
      sectionCode: r.section_code,
      name: r.name,
      profileKind: r.profile_kind,
      alloy: r.alloy,
      temper: r.temper,
      band: showBand ? { minG: Number(r.weight_min_g), maxG: Number(r.weight_max_g) } : null,
      granted: Boolean(Number(r.granted)),
      owned: Boolean(Number(r.owned)),
    })),
    copies: copies.map((r) => ({
      id: r.id,
      sectionId: r.section_id,
      code: r.code,
      latestKgPer12ftMilli: r.latest == null ? null : Number(r.latest),
      band: showBand
        ? { minG: Number(r.band_min ?? r.weight_min_g), maxG: Number(r.band_max ?? r.weight_max_g) }
        : null,
    })),
  };
}

/** NOT_FOUND unless every section id is visible to this party (order placement, C29). */
export async function assertSectionsVisible(
  db: OrrnDb,
  access: Pick<PortalAccess, "companyId" | "customerId">,
  sectionIds: readonly string[],
): Promise<void> {
  for (const sectionId of new Set(sectionIds)) {
    const [row] = await db.all<{ ok: number }>(
      sql`select 1 as ok from die d where d.id = ${sectionId} and ${sectionVisibleSql(access.companyId, access.customerId)} limit 1`,
    );
    if (!row) portalNotFound();
  }
}

/**
 * Remove every key that names a cast from a customer-facing snapshot (Q39: no cast numbers on the
 * customer PL) and the internal author id. Works on any JSON value; returns a copy.
 */
export function stripForParty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForParty);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/cast/i.test(k) || k === "generatedBy" || /^rate/i.test(k) || /paise$/i.test(k)) continue;
      out[k] = stripForParty(v);
    }
    return out;
  }
  return value;
}
