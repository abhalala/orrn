import { parsePieces, parseWeightG } from "./pack-math";
import type { DraftReject } from "./use-pack-draft";

// The reject form's rules, apart from the panel (which reads the plant's codes from the server).

export type RejectForm = { pcs: string; kg: string; reasonCode: string; note: string };
export const EMPTY_REJECT: RejectForm = { pcs: "", kg: "", reasonCode: "", note: "" };

export type RejectErrors = { pcs?: "pcs"; reason?: "reason"; note?: "note"; kg?: "kg" };

/**
 * Validates the reject form; returns the reject or what is wrong (field keys the screen words).
 * `needsNote`: the picked code asks for a note (`other`, or a code the plant set so in Masters).
 */
export function readReject(f: RejectForm, needsNote = f.reasonCode === "other"): { ok: true; reject: DraftReject } | { ok: false; errors: RejectErrors } {
  const pcs = parsePieces(f.pcs);
  const errors: RejectErrors = {};
  if (pcs === null) errors.pcs = "pcs";
  if (!f.reasonCode) errors.reason = "reason";
  if (f.reasonCode && needsNote && !f.note.trim()) errors.note = "note";
  const kgTyped = f.kg.trim() !== "";
  const weightG = kgTyped ? parseWeightG(f.kg) : null;
  if (kgTyped && weightG === null) errors.kg = "kg";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    reject: {
      pcs: pcs!,
      ...(weightG !== null ? { weightG } : {}),
      reasonCode: f.reasonCode,
      ...(f.note.trim() ? { note: f.note.trim() } : {}),
    },
  };
}
