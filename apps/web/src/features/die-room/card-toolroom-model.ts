/** Pure rules of the die card's Tool room block (XE ADM). No React. */

export type InspectionResult = "pass" | "fail";

export type InspectionInput = { result: InspectionResult; notes?: string };

/** What the Record inspection sheet may send: a fail needs notes, a pass may carry them. */
export function inspectionInput(result: InspectionResult, notes: string): { ok: true; input: InspectionInput } | { ok: false } {
  const text = notes.trim();
  if (result === "fail" && !text) return { ok: false };
  return { ok: true, input: text ? { result, notes: text } : { result } };
}

/** A copy that failed its receive inspection cannot be issued until a later inspection passes. */
export const blocksIssue = (inspection: InspectionResult | null | undefined): boolean => inspection === "fail";
