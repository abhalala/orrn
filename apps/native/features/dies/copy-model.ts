import { canCancelIssue, canReturnDie, type StatusTone } from "@orrn/domain";

import type { BandPosition, CopyStatus, DriftTone } from "./attention";

/**
 * Die copy card rules for the phone. Mirrors apps/web/src/features/die-room/die-room-model.ts:
 * nothing here works out a drift figure (percent, tone, band position and kg/m come from
 * `dieInstance.get`); what IS parsed is what a person types on the keypad.
 */

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
  return position === "in" ? "green" : position === "above" ? "red" : "blue";
}

/** Grams per 12 ft as kg to three decimals: 5967 -> "5.967". */
export function milliKgText(milli: number): string {
  return (milli / 1000).toFixed(3);
}

/** "5.900 to 6.200" (no unit; the caller adds the translated unit). */
export function bandRangeText(minG: number, maxG: number): string {
  return `${milliKgText(minG)}–${milliKgText(maxG)}`;
}

/** Percent drift from the server's tenths: 11 -> "+1.1%", -4 -> "-0.4%", 0 -> "0.0%". */
export function pctTenthText(tenth: number): string {
  const sign = tenth > 0 ? "+" : tenth < 0 ? "-" : "";
  const abs = Math.abs(tenth);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}%`;
}

/** Wall in tenths of a mm: 12 -> "1.2". */
export function wallMmText(tenth: number): string {
  return (tenth / 10).toFixed(1);
}

/** Whole kg with Indian grouping, for life and output: 8_000_000 g -> "8,000". */
export function kgGroupedText(grams: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(grams / 1000);
}

/** The server refuses a section above 500 kg per 12 ft. */
export const MAX_MILLI = 500_000;

/**
 * What a person typed on the keypad (kg per 12 ft) as grams per 12 ft, the integer the server
 * stores. Up to three decimals; null when empty, not a number or outside 0.001 to 500 kg.
 */
export function parseKgToMilli(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(clean)) return null;
  const [whole = "0", frac = ""] = clean.split(".");
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  return milli >= 1 && milli <= MAX_MILLI ? milli : null;
}

/** HV hardness: a whole number from 1. */
export function parseHardness(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,4}$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 1 ? n : null;
}

/** One key press on the reading pad: digits and one point, at most 6 whole and 3 decimal digits. */
export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export function applyPadKey(text: string, key: PadKey): string {
  if (key === "back") return text.slice(0, -1);
  if (key === ".") {
    if (text.includes(".")) return text;
    return text === "" ? "0." : `${text}.`;
  }
  const [whole = "", frac] = text.split(".");
  if (frac !== undefined) return frac.length >= 3 ? text : `${text}${key}`;
  if (whole === "0") return key === "0" ? text : key;
  return whole.length >= 6 ? text : `${text}${key}`;
}

/** What the card lets this person do with the copy, by its status and the permission matrix. */
export type CopyAbilities = {
  reading: boolean;
  nitridingOut: boolean;
  nitridingBack: boolean;
  issue: boolean;
  maker: boolean;
};

export function copyAbilities(status: CopyStatus, allowed: (action: "die.reading" | "die.card" | "die.issue" | "die.maker") => boolean): CopyAbilities {
  return {
    reading: status !== "retired" && allowed("die.reading"),
    nitridingOut: status === "available" && allowed("die.card"),
    nitridingBack: status === "at_nitriding" && allowed("die.card"),
    issue: status === "available" && allowed("die.issue"),
    maker: allowed("die.maker"),
  };
}

export type IssueRunState = { status: string; dieInAt: number | null; dieOutAt: number | null } | null;

/** Return and cancel on an open issue, by the same rules the server applies (domain `canReturnDie`, `canCancelIssue`). */
export function issueActions(run: IssueRunState): { return: boolean; cancel: boolean; dieOnPress: boolean } {
  const ret = canReturnDie({ issueStatus: "issued", run: run ? { dieInAt: run.dieInAt, dieOutAt: run.dieOutAt } : null });
  return {
    return: ret.ok,
    cancel: canCancelIssue({ issueStatus: "issued", run: run ? { status: run.status, dieInAt: run.dieInAt } : null }),
    dieOnPress: !ret.ok && ret.refusal === "die_on_press",
  };
}

export type QueuedRun = { id: string; number: string; sectionId: string; pressLineId: string | null; pressLineCode: string | null };
export type PressLine = { id: string; code: string };

/**
 * The line an issue goes to: the run's own line, else the only active line. Null means the person
 * must pick one (the run was released without a line and there are several).
 */
export function issueLine(run: Pick<QueuedRun, "pressLineId">, lines: readonly PressLine[]): string | null {
  if (run.pressLineId) return run.pressLineId;
  return lines.length === 1 ? lines[0]!.id : null;
}

/** Queued runs of one section, the only runs a copy of it can go to. */
export function runsForSection(runs: readonly QueuedRun[], sectionId: string): QueuedRun[] {
  return runs.filter((r) => r.sectionId === sectionId);
}

type MetaCarrier = { data?: { code?: string } | null; message?: string };

/**
 * The words for a failed die-room call. The server's refusals are plain ORRN sentences that name
 * the copy ("12170-2 is retired; it takes no readings"), so BAD_REQUEST / CONFLICT / NOT_FOUND pass
 * through; a role refusal and anything unexpected use the shared wording.
 */
export function refusalText(error: unknown, fallbacks: { forbidden: string; generic: string; network: string }): string {
  const code = (error as MetaCarrier | null)?.data?.code;
  const message = (error as MetaCarrier | null)?.message;
  if (code === "FORBIDDEN") return message && message.startsWith("This die belongs") ? message : fallbacks.forbidden;
  if (code === "BAD_REQUEST" || code === "CONFLICT" || code === "NOT_FOUND") {
    // A zod failure arrives as a JSON array of issues: never show that to a person.
    if (message && !message.trimStart().startsWith("[")) return message;
  }
  if (code === undefined) return fallbacks.network;
  return fallbacks.generic;
}

/** "12170-2": what the floor writes. A typed slash finds the same copy. */
export function copyCodeQuery(raw: string): string {
  return raw.trim().replace(/\//g, "-");
}

/** A scanned or typed text that looks like a die copy code: section code, a hyphen, a copy number. */
export function looksLikeCopyCode(raw: string): boolean {
  return /^\d[A-Z0-9]*-\d{1,4}$/i.test(raw.trim().replace(/\//g, "-"));
}

/** A QR that holds a link to a card (`/dies/copies/<id>`): the copy id, else null. */
export function copyIdFromLink(raw: string): string | null {
  const m = /\/dies\/copies\/([^/?#\s]+)/i.exec(raw.trim());
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
