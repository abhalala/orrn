/**
 * Bulk attach of drawings by file name (FP-DR-19). The server reads the names (`files.matchNames`);
 * this decides which files go up, which are listed as not matched, and how the run is summed up.
 * Nothing here guesses a target: a name that matches nothing is listed, never attached.
 */
import type { DieFileKind } from "./die-room-model";

export type NameMatch = {
  name: string;
  status: "section" | "copy" | "unmatched" | "unsupported" | "ambiguous";
  kind: DieFileKind | null;
  sectionId: string | null;
  dieInstanceId: string | null;
  target: string | null;
  pressDrawing: boolean;
  alreadyThere: boolean;
};

export type BulkEntry = {
  /** Position in the picked list, so two files with one name stay apart. */
  index: number;
  match: NameMatch;
};

export type BulkPlan = {
  /** Go up, in the order picked. */
  upload: BulkEntry[];
  /** Matched, but the same name is already on that die: not sent again. */
  already: BulkEntry[];
  /** Names that match no section or copy, or two sections, or are not a kept file type. */
  listed: BulkEntry[];
};

/** Split the server's answer into what to upload and what to list. */
export function planBulk(matches: readonly NameMatch[]): BulkPlan {
  const plan: BulkPlan = { upload: [], already: [], listed: [] };
  matches.forEach((match, index) => {
    const entry = { index, match };
    if (match.status === "section" || match.status === "copy") {
      (match.alreadyThere ? plan.already : plan.upload).push(entry);
    } else plan.listed.push(entry);
  });
  return plan;
}

export type BulkOutcome = { index: number; ok: true; pressDrawing: boolean } | { index: number; ok: false; error: string };

export function summariseBulk(plan: BulkPlan, outcomes: readonly BulkOutcome[]) {
  const done = outcomes.filter((o): o is Extract<BulkOutcome, { ok: true }> => o.ok);
  const failed = outcomes.filter((o): o is Extract<BulkOutcome, { ok: false }> => !o.ok);
  return {
    saved: done.length,
    drawings: done.filter((o) => o.pressDrawing).length,
    failed: failed.length,
    already: plan.already.length,
    notMatched: plan.listed.length,
  };
}

/** The reason line for a listed name: the key under `dieRoom.bulk.reason.*`. */
export function listedReason(status: NameMatch["status"]): "unmatched" | "unsupported" | "ambiguous" {
  return status === "unsupported" ? "unsupported" : status === "ambiguous" ? "ambiguous" : "unmatched";
}

/** Max names per `matchNames` call (the server's cap). */
export const MATCH_BATCH = 200;

/** The type the server checks for a file: images by their type or extension, PDF as PDF, CDR/DWG blank. */
export function mimeForUpload(kind: DieFileKind, file: { name: string; type: string }): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "cdr" || kind === "dwg") return "";
  if (file.type.startsWith("image/")) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

