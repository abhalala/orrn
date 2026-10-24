/**
 * Pure helpers for the die-room screens. Nothing here computes a drift figure: percent, tone,
 * band position and kg/m arrive from the server (`dieInstance.get`, `.drift`, `die.get`) and are
 * only formatted. What IS parsed here is what a person types (a weight in kg, a wall in mm).
 */
import type { StatusTone } from "@orrn/domain";

export type DriftTone = "none" | "under" | "green" | "amber" | "red";
export type BandPosition = "in" | "above" | "below";
export type CopyStatus = "available" | "in_use" | "at_nitriding" | "at_maker" | "retired" | "on_trial";

export const COPY_STATUSES: readonly CopyStatus[] = ["available", "in_use", "at_nitriding", "at_maker", "on_trial", "retired"];

/** Tabs of the die card, in the order the spec lists them. */
export const CARD_TABS = ["readings", "runs", "nitriding", "tier", "maker", "files"] as const;
export type CardTab = (typeof CARD_TABS)[number];

/** `?tab=` from the URL: anything unknown is the first tab. Plain function (no zod in route files). */
export function cardTabParam(value: unknown): CardTab {
  return typeof value === "string" && (CARD_TABS as readonly string[]).includes(value) ? (value as CardTab) : "readings";
}

export function toneToChip(tone: DriftTone): StatusTone {
  switch (tone) {
    case "green":
      return "green";
    case "amber":
      return "amber";
    case "red":
      return "red";
    case "under":
      return "blue";
    case "none":
      return "neutral";
  }
}

export function statusTone(status: CopyStatus): StatusTone {
  switch (status) {
    case "available":
      return "green";
    case "in_use":
      return "blue";
    case "at_nitriding":
    case "at_maker":
    case "on_trial":
      return "amber";
    case "retired":
      return "neutral";
  }
}

export function positionTone(position: BandPosition): StatusTone {
  switch (position) {
    case "in":
      return "green";
    case "above":
      return "red";
    case "below":
      return "blue";
  }
}

/** Grams per 12 ft as kg to three decimals: 5967 -> "5.967". */
export function milliKgText(milli: number): string {
  return (milli / 1000).toFixed(3);
}

/** A band as one string, always kg per 12 ft to three decimals: "5.900–6.200". */
export function bandRangeText(minG: number, maxG: number): string {
  return `${milliKgText(minG)}–${milliKgText(maxG)}`;
}

/**
 * THE band format, used on the board, the section, the card, the lift and the forms:
 * "5.900\u20136.200 kg/12ft" (kg per 12 ft to three decimals, an en dash, the translated unit).
 */
export function formatBand(minG: number, maxG: number, unit: string): string {
  return `${bandRangeText(minG, maxG)} ${unit}`;
}

/**
 * A band for reading when bands of one section must be told apart: "1.2 mm \u00b7 5.900\u20136.200 kg/12ft",
 * or just the band when the section has no wall written (the server sends 0 then). `mm` and
 * `kg12` are the translated units.
 */
export function bandTitle(band: { wallTenthMm: number; weightMinG: number; weightMaxG: number }, mm: string, kg12: string): string {
  const range = formatBand(band.weightMinG, band.weightMaxG, kg12);
  return band.wallTenthMm > 0 ? `${wallMmText(band.wallTenthMm)} ${mm} \u00b7 ${range}` : range;
}

/** Wall in tenths of a mm: 12 -> "1.2". */
export function wallMmText(tenth: number): string {
  return (tenth / 10).toFixed(1);
}

/** Percent drift from the server's tenths: 11 -> "+1.1%", -4 -> "-0.4%", 0 -> "0.0%". */
export function pctTenthText(tenth: number): string {
  const sign = tenth > 0 ? "+" : tenth < 0 ? "-" : "";
  const abs = Math.abs(tenth);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}%`;
}

/** kg per metre as the server sends it (3 dp already); null = no reading. */
export function kgPerMetreText(value: number | null | undefined): string {
  return value == null ? "" : value.toFixed(3);
}

/** Whole kg from grams with thousands grouping, for life and output: 8_000_000 -> "8,000". */
export function kgGroupedText(grams: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(grams / 1000);
}

export function bytesText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** The server refuses a section above 500 kg per 12 ft. */
export const MAX_MILLI = 500_000;

/**
 * What a person typed in a kg field -> grams (the integer the server stores). Up to three decimals,
 * no more (a weight finer than a gram is a typo). Null when empty or not a positive number.
 */
export function parseKgToMilli(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(clean)) return null;
  const [whole = "0", frac = ""] = clean.split(".");
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  return milli >= 1 && milli <= MAX_MILLI ? milli : null;
}

/** Wall in mm typed by a person -> tenths of a mm. One decimal at most. */
export function parseWallTenths(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!/^\d{1,3}(\.\d)?$/.test(clean)) return null;
  const tenth = Math.round(Number(clean) * 10);
  return tenth >= 1 ? tenth : null;
}

/** A whole number >= 1 (tier rank). */
export function parseRank(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,2}$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 1 ? n : null;
}

/** "12170-2": what the floor writes. A typed slash finds the same copy (the server matches both). */
export function copyCodeQuery(raw: string): string {
  return raw.trim().replace(/\//g, "-");
}

/** Life line: "1,200 of 8,000 kg" (produced of life) in kg; null when the copy has no life set. */
export function lifeText(producedG: number, lifeG: number | null): { produced: string; life: string } | null {
  if (lifeG == null) return null;
  return { produced: kgGroupedText(producedG), life: kgGroupedText(lifeG) };
}

type MetaCarrier = { data?: { meta?: unknown; code?: string } | null; message?: string };

/** The existing band or copy a CONFLICT names (`meta.existing`), when the server sent one. */
export function conflictExisting(error: unknown): { sectionCode: string; weightMinG: number; weightMaxG: number; wallTenthMm: number; bandId: string } | null {
  const meta = (error as MetaCarrier | null)?.data?.meta as { existing?: Record<string, unknown> } | undefined;
  const e = meta?.existing;
  if (!e || typeof e.sectionCode !== "string") return null;
  return {
    sectionCode: e.sectionCode,
    weightMinG: Number(e.weightMinG),
    weightMaxG: Number(e.weightMaxG),
    wallTenthMm: Number(e.wallTenthMm),
    bandId: String(e.bandId),
  };
}

export function errorCode(error: unknown): string | undefined {
  return (error as MetaCarrier | null)?.data?.code;
}

/**
 * The words for a failed die-room call. The server's refusals are already plain ORRN sentences
 * that name the copy ("12170-2 is retired; it takes no readings"), so they pass through; a role
 * refusal and anything unexpected use the shared wording.
 */
export function refusalText(error: unknown, fallbacks: { forbidden: string; generic: string }): string {
  const code = errorCode(error);
  if (code === "FORBIDDEN") {
    const message = (error as MetaCarrier).message;
    // "This die belongs to KD Extrusion" is the answer, not a role refusal.
    return message && message.startsWith("This die belongs") ? message : fallbacks.forbidden;
  }
  if (code === "BAD_REQUEST" || code === "CONFLICT" || code === "NOT_FOUND") {
    const message = (error as MetaCarrier).message;
    // A zod failure arrives as a JSON array of issues: never show that to a person.
    if (message && !message.trimStart().startsWith("[")) return message;
  }
  return fallbacks.generic;
}

/** "24 Oct 2026" from an ISO string, epoch ms or Date (the API sends ISO strings). Empty when unknown. */
export function shortDate(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** "24 Oct, 09:12" for a reading or an issue. */
export function shortDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

/** Basis points as percent with one decimal: 7550 -> "75.5%". */
export function bpText(bp: number | null | undefined): string {
  return bp == null ? "" : `${(bp / 100).toFixed(1)}%`;
}

/** Whole kg typed by a person (a die's life) -> grams. Null when empty or not a whole number >= 1. */
export function parseWholeKgToGrams(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!/^\d{1,8}$/.test(clean)) return null;
  const kg = Number(clean);
  return kg >= 1 ? kg * 1000 : null;
}

/** Grams -> whole kg text for an input ("8000"); empty for null. */
export function gramsToWholeKg(grams: number | null | undefined): string {
  return grams == null ? "" : String(Math.round(grams / 1000));
}

/** A non-negative whole number of grams typed in a nitriding field. */
export function parseGrams(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  return /^\d{1,9}$/.test(clean) ? Number(clean) : null;
}

export type DieFileKind = "image" | "pdf" | "cdr" | "dwg";

/** The file kind a picked file belongs to, by name and type; null when the die room takes no such file. */
export function dieFileKind(file: { name: string; type: string }): DieFileKind | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type.startsWith("image/")) return "image";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "cdr") return "cdr";
  if (ext === "dwg") return "dwg";
  return null;
}
