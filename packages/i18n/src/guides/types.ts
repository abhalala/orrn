/** Mirrors `companyRoles` in @orrn/db/schema/tenant (kept local so this package has no server deps). */
export const COMPANY_ROLES = [
  "owner",
  "admin",
  "manager",
  "office",
  "accountant",
  "supervisor",
  "packer",
  "foundry",
  "press",
  "storekeeper",
  "die_room",
  "operator",
  "viewer",
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/**
 * Who a guide is for. `platform_admin` is orrn support staff (Godseye), who have
 * no company role; the guides index shows those guides to them only.
 */
export type GuideRole = CompanyRole | "platform_admin";

export const GUIDE_SLUGS = [
  "pack-session",
  "reprint-label",
  "scan-bundle",
  "build-dispatch",
  "hold-and-dispatch",
  "void-bundle",
  "edit-die",
  "add-customer",
  "invite-member",
  "printer-trouble",
  "stock-by-die",
  "stock-count",
  "approve-access-request",
  "floor-tablet-signin",
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export type GuideStep = { title: string; body: string };
export type GuideProblem = { title: string; fix: string };

export type Guide = {
  slug: GuideSlug;
  /** Roles that can do this job. The guides index shows a user only their role's guides. */
  roles: GuideRole[];
  title: string;
  /** One sentence: when to use this guide. */
  when: string;
  steps: GuideStep[];
  problems: GuideProblem[];
};

export type GuideBook = { [S in GuideSlug]: Guide & { slug: S } };

export function isGuideSlug(value: string): value is GuideSlug {
  return (GUIDE_SLUGS as readonly string[]).includes(value);
}
