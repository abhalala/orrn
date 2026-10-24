/**
 * Pure model for the Settings screen (plan Task 24). The tab list lives in
 * `sections.tsx`; this file holds what can be tested without React.
 */
import type { CompanyRole } from "@orrn/i18n";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export type LengthUnitSetting = "mm" | "inch";

/** The company's stored length unit; anything but "inch" is mm (the server default). */
export function lengthUnitOf(settings: Record<string, unknown> | undefined): LengthUnitSetting {
  return settings?.lengthUnit === "inch" ? "inch" : "mm";
}

export function timezoneOf(settings: Record<string, unknown> | undefined): string {
  const tz = settings?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_TIMEZONE;
}

/**
 * IANA zones for the picker: the browser's list, always containing the
 * current choice and the plant default so the select never shows a blank.
 */
export function timezoneOptions(current: string, supported?: readonly string[]): string[] {
  let list: readonly string[] = supported ?? [];
  if (!supported) {
    try {
      list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      list = [];
    }
  }
  return [...new Set([DEFAULT_TIMEZONE, current, ...list])].sort((a, b) => a.localeCompare(b));
}

/** Roles one person may hand out when inviting: only an owner can invite an owner. */
export function invitableRoles(myRole: CompanyRole | string | undefined, all: readonly CompanyRole[]): CompanyRole[] {
  return all.filter((role) => role !== "owner" || myRole === "owner");
}

export function isExpired(expiresAt: Date | string | number, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

export function validEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
