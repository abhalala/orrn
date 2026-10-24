/**
 * Pure model for the Settings screen (plan Task 24). The tab list lives in
 * `sections.tsx`; this file holds what can be tested without React.
 */
import {
  COMPANY_MODULES,
  MAX_SHIFTS,
  MAX_STANDARD_TEXT,
  MINUTES_PER_DAY,
  minuteText,
  validateShifts,
  type CompanyModule,
  type Shift,
  type ShiftError,
  type StandardPair,
  type Standards,
} from "@orrn/domain";
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

// ---------------------------------------------------------------------------
// Shifts (FP-PF-05)
// ---------------------------------------------------------------------------


export { MAX_SHIFTS, MAX_STANDARD_TEXT };

/** `HH:MM` for a minute of the day, for `<input type="time">`. */
export const minuteToTime = minuteText;

/** `HH:MM` (or `HH:MM:SS`) to a minute of the day, or null when it isn't a time. */
export function timeToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 && minute < MINUTES_PER_DAY ? minute : null;
}

/** One row of the shifts form. `id` is set for a stored shift (ids never change on rename). */
export type ShiftDraft = { key: string; id?: string; name: string; start: string; end: string };

export function draftFromShifts(shifts: readonly Shift[]): ShiftDraft[] {
  return [...shifts]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({ key: s.id, id: s.id, name: s.name, start: minuteToTime(s.startMin), end: minuteToTime(s.endMin) }));
}

let draftCounter = 0;
export function newShiftDraft(partial: Partial<Omit<ShiftDraft, "key" | "id">> = {}): ShiftDraft {
  draftCounter += 1;
  return { key: `new-${draftCounter}`, name: "", start: "08:00", end: "20:00", ...partial };
}

/** The list order is the shift order: row 1 is shift 1, the one that starts the production day. */
export function shiftsPayload(draft: readonly ShiftDraft[]): { id?: string; name: string; seq: number; startMin: number; endMin: number }[] {
  return draft.map((row, i) => ({
    ...(row.id ? { id: row.id } : {}),
    name: row.name.trim(),
    seq: i + 1,
    startMin: timeToMinute(row.start) ?? -1,
    endMin: timeToMinute(row.end) ?? -1,
  }));
}

/** The same rules the server applies (`validateShifts`), on the form's rows. New rows get a throwaway id. */
export function shiftDraftErrors(draft: readonly ShiftDraft[]): ShiftError[] {
  const asShifts: Shift[] = shiftsPayload(draft).map((s, i) => ({
    id: draft[i]!.id ?? draft[i]!.key,
    name: s.name,
    seq: s.seq,
    startMin: s.startMin,
    endMin: s.endMin,
  }));
  return validateShifts(asShifts);
}

export function shiftsDirty(draft: readonly ShiftDraft[], saved: readonly Shift[]): boolean {
  const a = JSON.stringify(draft.map((r) => [r.id ?? null, r.name.trim(), r.start, r.end]));
  const b = JSON.stringify(draftFromShifts(saved).map((r) => [r.id ?? null, r.name.trim(), r.start, r.end]));
  return a !== b;
}

// ---------------------------------------------------------------------------
// Standards (FP-PF-09)
// ---------------------------------------------------------------------------

export const STANDARD_KINDS = ["solid", "hollow", "semi"] as const;
export type StandardKind = (typeof STANDARD_KINDS)[number];
export type StandardsDraft = Record<StandardKind, StandardPair>;

export function standardsDraft(standards: Standards | undefined | null): StandardsDraft {
  const pick = (kind: StandardKind): StandardPair => ({
    standard: standards?.[kind]?.standard ?? "",
    cml: standards?.[kind]?.cml ?? "",
  });
  return { solid: pick("solid"), hollow: pick("hollow"), semi: pick("semi") };
}

/** Only the kinds that changed, trimmed. A pair sent as two blanks clears the kind on the server. */
export function standardsPatch(draft: StandardsDraft, saved: StandardsDraft): Partial<Record<StandardKind, StandardPair>> {
  const patch: Partial<Record<StandardKind, StandardPair>> = {};
  for (const kind of STANDARD_KINDS) {
    const next = { standard: draft[kind].standard.trim(), cml: draft[kind].cml.trim() };
    if (next.standard !== saved[kind].standard.trim() || next.cml !== saved[kind].cml.trim()) patch[kind] = next;
  }
  return patch;
}

export function standardBlank(pair: StandardPair): boolean {
  return pair.standard.trim() === "" && pair.cml.trim() === "";
}

// ---------------------------------------------------------------------------
// Modules (FP-PF-07)
// ---------------------------------------------------------------------------

/** Each module and whether it is on. An empty list means every module is on. */
export function moduleStates(modules: readonly string[] | undefined | null): { id: CompanyModule; on: boolean }[] {
  const list = (modules ?? []).map((m) => m.toLowerCase());
  return COMPANY_MODULES.map((id) => ({ id, on: list.length === 0 || list.includes(id) }));
}

// ---------------------------------------------------------------------------
// Letterhead (FP-PF-09 / PL v2 header)
// ---------------------------------------------------------------------------

export type LetterheadDraft = { legalName: string; gstin: string; address: string; phone: string };

export function letterheadDraft(l: Partial<Record<keyof LetterheadDraft, string | null>> | undefined | null): LetterheadDraft {
  return { legalName: l?.legalName ?? "", gstin: l?.gstin ?? "", address: l?.address ?? "", phone: l?.phone ?? "" };
}

/** GSTIN is blank, or 15 letters and digits (the server's rule, upper-cased). */
export function gstinValid(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v === "" || /^[0-9]{2}[A-Z0-9]{13}$/.test(v);
}

export function letterheadDirty(a: LetterheadDraft, b: LetterheadDraft): boolean {
  return (["legalName", "gstin", "address", "phone"] as const).some((k) => a[k].trim() !== b[k].trim());
}

// ---------------------------------------------------------------------------
// Devices (FP-PF-11)
// ---------------------------------------------------------------------------

/** The build number in an app version like `1.1 (11)`, or null when there is none. */
export function buildNumberOf(appVersion: string | null | undefined): number | null {
  const m = /\((\d+)\)\s*$/.exec(appVersion ?? "");
  return m ? Number(m[1]) : null;
}

export type DeviceGate = "revoked" | "blocked" | "current" | "web";

/** Revoked beats everything; below the platform's minimum build is blocked; the web app has no build gate. */
export function deviceGate(
  device: { platform: string; appVersion: string | null; revokedAt: string | null },
  minBuild: (platform: string) => number,
): DeviceGate {
  if (device.revokedAt) return "revoked";
  if (device.platform === "web") return "web";
  const build = buildNumberOf(device.appVersion);
  return build !== null && build < minBuild(device.platform) ? "blocked" : "current";
}

// ---------------------------------------------------------------------------
// About (support contact from the company settings JSON)
// ---------------------------------------------------------------------------

export type SupportContact = { name: string | null; phone: string | null; email: string | null; hours: string | null };

/** `settings.support` = `{ name, phone, email, hours }`, tolerant: anything else is "no contact set". */
export function supportContactOf(settings: Record<string, unknown> | undefined): SupportContact | null {
  const raw = settings?.support;
  if (!raw || typeof raw !== "object") return null;
  const pick = (k: string) => {
    const v = (raw as Record<string, unknown>)[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const contact = { name: pick("name"), phone: pick("phone"), email: pick("email"), hours: pick("hours") };
  return contact.name || contact.phone || contact.email ? contact : null;
}
