import type { Locale } from "@orrn/i18n";
import { listGuides, type CompanyRole, type Guide } from "@orrn/i18n/guides";

/**
 * The guides a person sees in More: their own role's, in the current
 * language. Owners and admins run the whole plant, so they see all of them.
 */
export function guidesFor(locale: Locale, role: CompanyRole | string | null | undefined): Guide[] {
  if (role === "owner" || role === "admin") return listGuides(locale);
  return listGuides(locale, role as CompanyRole | undefined);
}
