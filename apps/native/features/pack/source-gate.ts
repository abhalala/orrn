import { castRequiredOnBundle, readFloorSettings } from "@orrn/domain";

import type { PackSource } from "./pack-math";

/**
 * What the Source step still needs before Next (FP-PK-10, requireCastOnBundle). The server decides
 * every one of these again at save; this only tells the packer early and in plain words.
 */
export type SourceChoice = PackSource;

export const DEFAULT_SOURCE: SourceChoice = { showLogo: true };

export type OwnerDecisionLike =
  | { ok: true }
  | { ok: false; block: "pick_copy" | "no_copies" | "owned"; ownerName?: string | null };

export type SourceBlocker =
  | { kind: "cast" }
  | { kind: "copy" }
  | { kind: "noCopies"; ownerName: string | null }
  | { kind: "owned"; ownerName: string | null };

export function sourceBlockers(input: {
  choice: SourceChoice;
  castRequired: boolean;
  owner: OwnerDecisionLike | null | undefined;
}): SourceBlocker[] {
  const out: SourceBlocker[] = [];
  if (input.castRequired && !input.choice.castId) out.push({ kind: "cast" });
  const o = input.owner;
  if (o && !o.ok) {
    if (o.block === "pick_copy") out.push({ kind: "copy" });
    else if (o.block === "no_copies") out.push({ kind: "noCopies", ownerName: o.ownerName ?? null });
    else out.push({ kind: "owned", ownerName: o.ownerName ?? null });
  }
  return out;
}

/** The cast rule the screen shows: the plant's setting, else on once a melt has been locked. */
export function castRequired(settings: unknown, liveCasts: number): boolean {
  return castRequiredOnBundle(readFloorSettings(settings as Record<string, unknown> | null | undefined), liveCasts > 0);
}

/** Copies that can still be packed from (retired copies and copies at the maker are not offered). */
export function packableCopy(status: string): boolean {
  return status !== "retired" && status !== "at_maker";
}

/** Choosing another order line may change who owns the material: a copy chosen before stays only if still valid. */
export function withLine(choice: SourceChoice, lineId: string | undefined): SourceChoice {
  const { salesOrderLineId: _drop, ...rest } = choice;
  return lineId ? { ...rest, salesOrderLineId: lineId } : rest;
}

export function withCopy(choice: SourceChoice, copyId: string | undefined): SourceChoice {
  const { dieInstanceId: _drop, ...rest } = choice;
  return copyId ? { ...rest, dieInstanceId: copyId } : rest;
}

export function withCast(choice: SourceChoice, castId: string | undefined): SourceChoice {
  const { castId: _drop, ...rest } = choice;
  return castId ? { ...rest, castId } : rest;
}

/**
 * D15: choosing an order line that pins a die copy chooses that copy (the server refuses another
 * one unless the office overrides). An unpinned line, or plant stock, keeps the copy as it was.
 */
export function withPinnedLine(choice: SourceChoice, lineId: string | undefined, pinnedCopyId: string | null): SourceChoice {
  const { overridePin: _off, ...rest } = withLine(choice, lineId);
  return pinnedCopyId ? { ...rest, dieInstanceId: pinnedCopyId } : rest;
}

/** The copy radios follow the pin unless the office chose to override it. */
export function copyLocked(choice: SourceChoice, pinnedCopyId: string | null): boolean {
  return Boolean(pinnedCopyId) && !choice.overridePin;
}

/** The office's override switch: off puts the pinned copy back. */
export function withPinOverride(choice: SourceChoice, on: boolean, pinnedCopyId: string | null): SourceChoice {
  const { overridePin: _drop, ...rest } = choice;
  if (on) return { ...rest, overridePin: true };
  return pinnedCopyId ? { ...rest, dieInstanceId: pinnedCopyId } : rest;
}
