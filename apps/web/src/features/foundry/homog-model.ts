/**
 * Pure view model for the homogenizing screens (XE row 41): status tone, the stage stepper, which buttons
 * a status allows, the release rule and the recipe form check. No React. Every verdict (soak, in-band
 * minutes) is the server's; nothing here decides one. Temperatures are x10 integers on the wire.
 */
import { homogRecipeError, HOMOG_DEFAULT_RECIPE, parseDecimal, type StatusTone } from "@orrn/domain";

export const HOMOG_STATUSES = ["loading", "in_furnace", "out", "released", "held", "void"] as const;
export type HomogStatus = (typeof HOMOG_STATUSES)[number];

export const HOMOG_TONE: Record<HomogStatus, StatusTone> = { loading: "blue", in_furnace: "amber", out: "amber", released: "green", held: "red", void: "neutral" };

export type HomogVerdict = "ok" | "short" | "over" | "no_readings";
export const HOMOG_VERDICT_TONE: Record<HomogVerdict, StatusTone> = { ok: "green", short: "amber", over: "red", no_readings: "neutral" };

export function homogTone(status: string): StatusTone {
  return HOMOG_TONE[status as HomogStatus] ?? "neutral";
}

/** Verdict of a frozen batch from the list columns (`soakOk` is set when it comes out). */
export function listVerdictTone(soakOk: boolean | null): StatusTone {
  return soakOk === null ? "neutral" : soakOk ? "green" : "red";
}

export const HOMOG_STAGES = ["load", "furnace", "out", "release"] as const;
export type HomogStage = (typeof HOMOG_STAGES)[number];

/** Step reached on the stepper: 0 load, 1 in furnace, 2 out, 3 released. Held waits at "out"; void shows no steps. */
export function homogStageIndex(status: string): number {
  switch (status) {
    case "loading":
      return 0;
    case "in_furnace":
      return 1;
    case "out":
    case "held":
      return 2;
    case "released":
      return 3;
    default:
      return 0;
  }
}

export type HomogActions = {
  /** Add or remove lines, start. */
  load: boolean;
  start: boolean;
  reading: boolean;
  out: boolean;
  /** Release (always allowed for out/held). Hold only while out. */
  release: boolean;
  hold: boolean;
  void: boolean;
};

/** What a status allows. Permissions (`foundry.homog`, `foundry.homogRelease`) are the screen's `<Can>`. */
export function homogActions(status: string, soakOk: boolean | null = null, lineCount = 0): HomogActions {
  const s = status as HomogStatus;
  const decide = s === "out" || s === "held";
  return {
    load: s === "loading",
    start: s === "loading" && lineCount > 0,
    reading: s === "in_furnace",
    out: s === "in_furnace",
    release: decide,
    hold: s === "out" && soakOk !== true,
    void: s !== "released" && s !== "void",
  };
}

/**
 * Releasing needs a reason when the soak did not pass or the batch was held (the server refuses without
 * it). A passed soak releases with no note. A "hold" is a release call with no note on a failed soak.
 */
export function releaseNeedsNote(status: string, soakOk: boolean | null): boolean {
  return status === "held" || (status === "out" && soakOk !== true);
}

export const NOTE_MIN = 3;
export function noteOk(note: string): boolean {
  return note.trim().length >= NOTE_MIN;
}

// --- Recipe ----------------------------------------------------------------------------------------------------

export type RecipeDraft = { tempC: string; toleranceC: string; soakMin: string };

export function defaultRecipeDraft(): RecipeDraft {
  return {
    tempC: String(HOMOG_DEFAULT_RECIPE.targetTempX10 / 10),
    toleranceC: String(HOMOG_DEFAULT_RECIPE.toleranceX10 / 10),
    soakMin: String(HOMOG_DEFAULT_RECIPE.soakMin),
  };
}

/** "580" / "580.5" -> 5800 / 5805, or null for blank, negative or more than one decimal. */
export function x10Of(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || !(n >= 0)) return null;
  const x = Math.round(n * 10);
  return Math.abs(x - n * 10) < 1e-6 ? x : null;
}

export type RecipeIssue = "temp" | "band" | "soak";

export type RecipeResult = { ok: true; targetTempX10: number; toleranceX10: number; soakMin: number } | { ok: false; field: RecipeIssue };

/** The recipe as the server takes it (300-650 C, band 1-50 C, soak 10 min to 48 h), or the first bad field. */
export function recipeInput(d: RecipeDraft): RecipeResult {
  const temp = x10Of(d.tempC);
  const tol = x10Of(d.toleranceC);
  const soak = parseDecimal(d.soakMin);
  if (temp === null) return { ok: false, field: "temp" };
  if (tol === null) return { ok: false, field: "band" };
  if (soak === null || !Number.isInteger(soak)) return { ok: false, field: "soak" };
  const err = homogRecipeError({ targetTempX10: temp, toleranceX10: tol, soakMin: soak });
  if (err === "temp_range") return { ok: false, field: "temp" };
  if (err === "band_range") return { ok: false, field: "band" };
  if (err === "soak_range") return { ok: false, field: "soak" };
  return { ok: true, targetTempX10: temp, toleranceX10: tol, soakMin: soak };
}

export type NewBatchIssue = "furnace" | "alloy" | RecipeIssue;

/** The first thing wrong on the "new batch" form, or null. */
export function newBatchIssue(f: { furnaceId: string; alloyId: string; recipe: RecipeDraft }): NewBatchIssue | null {
  if (!f.furnaceId) return "furnace";
  if (!f.alloyId) return "alloy";
  const r = recipeInput(f.recipe);
  return r.ok ? null : r.field;
}

/** A reading in degrees C as the server takes it (0-800 C), or null. */
export function readingX10(text: string): number | null {
  const x = x10Of(text);
  return x !== null && x <= 8_000 ? x : null;
}

/** The band for the sparkline from a batch's frozen recipe. */
export function recipeBand(r: { targetTempX10: number; toleranceX10: number }): { lowX10: number; highX10: number } {
  return { lowX10: r.targetTempX10 - r.toleranceX10, highX10: r.targetTempX10 + r.toleranceX10 };
}

/** Whole pieces typed in a form, or null (zero and negatives are not pieces). */
export function pcsOf(text: string): number | null {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
}
