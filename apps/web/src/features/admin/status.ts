import type { MessageKey } from "@orrn/i18n";
import type { ToneName } from "@orrn/ui/tokens";

import { toDate, type DateInput } from "./format";

export type CompanyStatus = "pending" | "active" | "suspended";
export type PrintStationStatus = "pending" | "active" | "offline" | "revoked";
export type GrantState = "active" | "ended" | "stopped";

/** Active is green, waiting for approval needs action (amber), suspended is blocked (red). */
export function companyStatusTone(status: string): ToneName {
  if (status === "active") return "green";
  if (status === "suspended") return "red";
  return "amber";
}

/** Connected is green, waiting or offline needs attention (amber), turned off is red, none is neutral. */
export function printingTone(status: PrintStationStatus | string | null | undefined): ToneName {
  if (status === "active") return "green";
  if (status === "pending" || status === "offline") return "amber";
  if (status === "revoked") return "red";
  return "neutral";
}

/** A support session is active until its end time, unless someone stopped it first. */
export function grantState(
  grant: { expiresAt: DateInput; revokedAt: DateInput | null },
  now: Date = new Date(),
): GrantState {
  if (grant.revokedAt) return "stopped";
  return toDate(grant.expiresAt).getTime() > now.getTime() ? "active" : "ended";
}

/** When a support session ends (or ended): the moment it was stopped, else its planned end. */
export function grantEndsAt(grant: { expiresAt: DateInput; revokedAt: DateInput | null }): Date {
  return toDate(grant.revokedAt ?? grant.expiresAt);
}

/** In progress is blue (spec §2); finished sessions are quiet. */
export function grantTone(state: GrantState): ToneName {
  return state === "active" ? "blue" : "neutral";
}

const STATION_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * A print station name from the company slug: lowercase, hyphens only, the
 * random suffix approval adds (`-1a2b3c4d`) dropped, 3 to 63 characters.
 */
export function suggestStationName(slug: string): string {
  let name = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-[0-9a-f]{8}$/, "");
  name = name.slice(0, 63).replace(/-+$/, "");
  if (name.length < 3) name = `${name || "plant"}-print`;
  return name;
}

/** Why a station name is not usable, or null. Mirrors the server's DNS label rule. */
export function validateStationName(name: string): "required" | "length" | "format" | null {
  if (!name) return "required";
  if (name.length < 3 || name.length > 63) return "length";
  if (!STATION_NAME.test(name)) return "format";
  return null;
}

/** Message key for a company status word ("Active", "Suspended", "Waiting for approval"). */
export function companyStatusKey(status: string): MessageKey {
  if (status === "active") return "status.company.active";
  if (status === "suspended") return "status.company.suspended";
  return "status.company.pending";
}

/** Message key for a print station status; null means label printing is not set up. */
export function printingKey(status: PrintStationStatus | string | null | undefined): MessageKey {
  switch (status) {
    case "active":
      return "status.printSetup.active";
    case "pending":
      return "status.printSetup.pending";
    case "offline":
      return "status.printSetup.offline";
    case "revoked":
      return "status.printSetup.revoked";
    default:
      return "status.printSetup.none";
  }
}

export function grantStateKey(state: GrantState): MessageKey {
  return `admin.access.state.${state}`;
}
