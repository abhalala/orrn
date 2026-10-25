import type { Locale } from "../core";
import { guidesEn } from "./en";
import { guidesGu } from "./gu";
import { guidesHi } from "./hi";
import { GUIDE_SLUGS, type CompanyRole, type Guide, type GuideBook, type GuideSlug } from "./types";

export * from "./types";

/**
 * Gujarati has the floor guides only (`GUIDE_SLUGS_GU`: pack, reprint, scan, build a dispatch, dispatch from an
 * order, the press station, a press stoppage, a die reading, die issue and return). Every other guide reads the
 * English book in gu, like any other missing gu message. The guides page chrome (`guides.*`) is Gujarati.
 */
const BOOKS: Record<Locale, GuideBook> = { en: guidesEn, hi: guidesHi, gu: { ...guidesEn, ...guidesGu } };

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
