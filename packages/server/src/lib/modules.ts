/**
 * Company modules Godseye can switch on (`company.modules`). An empty list
 * means every module is on (companies created before modules existed), see
 * `visibleItems` in the web nav. Add a module here first: the platform
 * mutation validates against this list and the Godseye form renders it.
 */
export { COMPANY_MODULES, type CompanyModule } from "@orrn/domain";

/** Plans offered in the Godseye form. Older companies may carry another value (for example `dev`); it is kept as is. */
export const COMPANY_PLANS = ["starter", "growth", "enterprise"] as const;
export type CompanyPlan = (typeof COMPANY_PLANS)[number];
