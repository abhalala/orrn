/** Plant-side wording helpers for party logins and grants (pure). */
export type LoginStatus = "invited" | "active" | "revoked";

export const LOGIN_TONE: Record<LoginStatus, "blue" | "green" | "neutral"> = {
  invited: "blue",
  active: "green",
  revoked: "neutral",
};

export function isLoginStatus(v: unknown): v is LoginStatus {
  return v === "invited" || v === "active" || v === "revoked";
}

/** A login the office can still act on: turn off (invited, active) or give again (invited, revoked). */
export function loginActions(status: LoginStatus): { revoke: boolean; resend: boolean; regrant: boolean } {
  return { revoke: status !== "revoked", resend: status === "invited", regrant: status === "revoked" };
}

/** A section grant that the party will not see: another customer owns the section. */
export function grantHidden(grant: { ownerCustomerId: string | null }, customerId: string): boolean {
  return grant.ownerCustomerId != null && grant.ownerCustomerId !== customerId;
}

/** Server refusals worth showing in the plant's own words; anything else is the generic line. */
export function staffErrorKey(error: unknown):
  | "portal.staff.portalOff"
  | "portal.staff.alreadyActive"
  | "portal.staff.plantLogin"
  | "portal.staff.otherParty"
  | "portal.staff.alreadyGranted"
  | "errors.forbidden"
  | "errors.generic" {
  const e = error as { message?: unknown; data?: { code?: unknown } } | null;
  const m = typeof e?.message === "string" ? e.message : "";
  if (e?.data?.code === "FORBIDDEN") return "errors.forbidden";
  if (/Turn on the party portal/i.test(m)) return "portal.staff.portalOff";
  if (/already active/i.test(m)) return "portal.staff.alreadyActive";
  if (/plant login|plant invite/i.test(m)) return "portal.staff.plantLogin";
  if (/another party/i.test(m)) return "portal.staff.otherParty";
  if (/already sees/i.test(m)) return "portal.staff.alreadyGranted";
  return "errors.generic";
}

/** The link the office passes on: the server's invite link plus `?kind=portal`, so the page speaks to a party. */
export function partyInviteUrl(url: string): string {
  return url.includes("?") ? url : `${url}?kind=portal`;
}
