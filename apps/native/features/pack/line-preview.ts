import { driftPercentText, formatKg } from "@orrn/domain";
import type { StatusTone } from "@orrn/domain";

/**
 * Pack line verdicts from the server (`bundle.previewLine` / `previewLines`, D15). The screen shows
 * these numbers and never works out kg/12 ft, a band position or a drift itself: the same bundle
 * reads the same on the pack line, the saved session, the stock lists and `/b/$serial`.
 */
export type ServerPosition = "in" | "below" | "above" | null;
export type ServerDriftTone = "none" | "under" | "green" | "amber" | "red";

export type LineVerdict = {
  kgPer12ftMilli: number | null;
  band: { bandId: string | null; minG: number; maxG: number; source: "copy" | "section" } | null;
  position: ServerPosition;
  driftTone: ServerDriftTone;
  driftPercentTenths: number | null;
};

/** The word key for a position ("In range", "Below range", "Above range"); null = no band. */
export function positionKey(position: ServerPosition): "status.range.inRange" | "status.range.below" | "status.range.above" | null {
  if (position === "in") return "status.range.inRange";
  if (position === "below") return "status.range.below";
  if (position === "above") return "status.range.above";
  return null;
}

/** Chip tone of a position: green inside the band, amber outside. */
export function positionTone(position: ServerPosition): StatusTone {
  return position === "in" ? "green" : position ? "amber" : "neutral";
}

/** Chip tone of the drift against the band start; `under` (lighter than the start) reads blue. */
export function driftChipTone(tone: ServerDriftTone): StatusTone | null {
  if (tone === "none") return null;
  if (tone === "under") return "blue";
  return tone;
}

/** "+4.1%" from the server's tenths, or null without a band. */
export function driftText(tenths: number | null): string | null {
  return tenths == null ? null : driftPercentText(tenths);
}

/** kg/12 ft to three decimals ("2.499"), the figure the packing list prints. Null without one. */
export function kg12Text(milli: number | null): string | null {
  return milli == null ? null : formatKg(milli / 1000, 3);
}

/** What the preview asks the server about: one bundle being typed. */
export type PreviewInput = { dieId: string | null; dieInstanceId?: string; lengthMm: number; weightG: number | null; pieces: number | null };

/**
 * The preview input as ONE string. The screen builds a new object on every render, so the debounce must
 * compare this key (equal content = equal string) and never the object itself.
 */
export function previewInputKey(i: PreviewInput): string {
  return JSON.stringify([i.dieId, i.dieInstanceId ?? null, i.lengthMm, i.weightG, i.pieces]);
}

/** The input a key stands for (the inverse of `previewInputKey`). */
export function previewInputOf(key: string): PreviewInput {
  const [dieId, dieInstanceId, lengthMm, weightG, pieces] = JSON.parse(key) as [string | null, string | null, number, number | null, number | null];
  return { dieId, ...(dieInstanceId ? { dieInstanceId } : {}), lengthMm, weightG, pieces };
}

/**
 * The band as the plant writes it ("2.4 to 2.6"), from grams per 12 ft. The word between the two figures
 * is the person's language: `rangeTo` is `t("units.rangeTo", { min, max })`.
 */
export function bandText(band: Pick<NonNullable<LineVerdict["band"]>, "minG" | "maxG">, rangeTo: (vars: { min: string; max: string }) => string): string {
  const f = (g: number) => (Number.isInteger(g / 100) ? (g / 1000).toFixed(1) : formatKg(g / 1000, 3));
  return rangeTo({ min: f(band.minG), max: f(band.maxG) });
}

/** Whether a line has enough to ask the server (all three figures are positive whole numbers). */
export function previewReady(i: { dieId: string | null; lengthMm: number; weightG: number | null; pieces: number | null }): boolean {
  return Boolean(i.dieId) && i.lengthMm > 0 && (i.weightG ?? 0) > 0 && (i.pieces ?? 0) > 0;
}
