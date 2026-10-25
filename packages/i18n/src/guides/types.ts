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

/** The first sixteen guides (packing, dispatch, masters, platform). */
export const GUIDE_SLUGS_BASE = [
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
  "weigh-scrap-lot",
  "store-entries",
  "stock-by-die",
  "stock-count",
  "approve-access-request",
  "floor-tablet-signin",
] as const;

/** FP modules: orders and planning, press, die room, dispatch from an order, count settlement, portal, reasons, foundry, ageing, die share link, approvals. */
export const GUIDE_SLUGS_FP = [
  "book-order",
  "hold-for-order",
  "reallocate-bundles",
  "plan-press-run",
  "press-station-day",
  "press-late-entry",
  "press-downtime",
  "die-reading",
  "die-issue-return",
  "die-trial",
  "bulk-drawings",
  "dispatch-from-order",
  "truck-capacity",
  "packing-list-revisions",
  "combine-packing-lists",
  "settle-count",
  "portal-login",
  "issue-certificate",
  "reason-codes",
  "open-cast",
  "melt-entry",
  "spectro-attach",
  "cast-close-count",
  "load-trolley",
  "age-and-release",
  "pack-from-trolley",
  "die-share-link",
  "approvals-review",
] as const;

export const GUIDE_SLUGS = [...GUIDE_SLUGS_BASE, ...GUIDE_SLUGS_FP] as const;

/**
 * Guides that also exist in Gujarati: the floor flows (pack, scan, dispatch, press station, die issue and
 * return). Every other guide reads the English book in gu, like any other missing gu text.
 */
export const GUIDE_SLUGS_GU = [
  "pack-session",
  "reprint-label",
  "scan-bundle",
  "build-dispatch",
  "dispatch-from-order",
  "press-station-day",
  "press-downtime",
  "die-reading",
  "die-issue-return",
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];
export type GuideSlugBase = (typeof GUIDE_SLUGS_BASE)[number];
export type GuideSlugFp = (typeof GUIDE_SLUGS_FP)[number];
export type GuideSlugGu = (typeof GUIDE_SLUGS_GU)[number];

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
export type GuideBookBase = { [S in GuideSlugBase]: Guide & { slug: S } };
export type GuideBookFp = { [S in GuideSlugFp]: Guide & { slug: S } };
/** A Gujarati book holds only the floor guides. */
export type GuideBookGu = { [S in GuideSlugGu]: Guide & { slug: S } };

export function isGuideSlug(value: string): value is GuideSlug {
  return (GUIDE_SLUGS as readonly string[]).includes(value);
}
