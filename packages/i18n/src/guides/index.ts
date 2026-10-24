import type { Locale } from "../core";
import { guidesEn } from "./en";
import { guidesHi } from "./hi";
import { GUIDE_SLUGS, type CompanyRole, type Guide, type GuideSlug } from "./types";

export * from "./types";

/** No Gujarati guides yet: gu reads the English book, like any other missing gu message. */
const BOOKS: Record<Locale, typeof guidesEn> = { en: guidesEn, hi: guidesHi, gu: guidesEn };

/** One guide in the given locale. */
export function getGuide(slug: GuideSlug, locale: Locale): Guide {
  return BOOKS[locale][slug];
}

/**
 * Every guide in display order, optionally only those a role can follow.
 * `platformAdmin` also lists the guides written for orrn support staff.
 */
export function listGuides(locale: Locale, role?: CompanyRole, platformAdmin = false): Guide[] {
  const all = GUIDE_SLUGS.map((slug) => BOOKS[locale][slug]);
  if (!role && !platformAdmin) return all;
  return all.filter(
    (g) => (role !== undefined && g.roles.includes(role)) || (platformAdmin && g.roles.includes("platform_admin")),
  );
}
