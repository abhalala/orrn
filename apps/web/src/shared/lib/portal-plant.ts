/**
 * The plant a party reads in the portal (a party can have a login in several plants). The choice
 * rides on `x-orrn-company`, and only on the party's own procedures: the same header on a plant
 * member's call that names a plant they do not belong to would be refused (AGENTS.md, tenant
 * isolation). Pure helpers here; the tRPC client calls them.
 */
export const PORTAL_PLANT_KEY = "orrn.portalPlant";

/**
 * Party procedures that honour `x-orrn-company` (portalProcedure). Staff `portal.users.*` etc. never do.
 * Add a new party procedure here (the link in trpc-links.ts sends these in their own batch).
 */
const PARTY_PROCEDURE = /^portal\.(me|today|sections\.visible|orders\.(list|get|create)|dispatches\.(list|get)|packingList\.get|certificate\.get)$/;

export function isPartyProcedure(name: string): boolean {
  return PARTY_PROCEDURE.test(name);
}

/**
 * True when `portal.access` did not answer (offline, 5xx): the guard shows "try again", it does not
 * treat the party as having no plants (a member would see Not found, a party the no-access page).
 * A 4xx is an answer.
 */
export function portalAccessUnreachable(error: unknown): boolean {
  const status = (error as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
  return !(typeof status === "number" && status >= 400 && status < 500);
}

export function readPortalPlant(): string | null {
  try {
    return localStorage.getItem(PORTAL_PLANT_KEY) || null;
  } catch {
    return null;
  }
}

export function storePortalPlant(companyId: string | null) {
  try {
    if (companyId) localStorage.setItem(PORTAL_PLANT_KEY, companyId);
    else localStorage.removeItem(PORTAL_PLANT_KEY);
  } catch {
    // Blocked storage: the first plant is used.
  }
}

/** The plant to read: the stored choice when the party still has a login there, else the first. */
export function pickPortalPlant<T extends { companyId: string }>(plants: readonly T[], stored: string | null): T | null {
  return plants.find((p) => p.companyId === stored) ?? plants[0] ?? null;
}
