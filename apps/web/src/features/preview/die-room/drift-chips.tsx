import type { StatusTone } from "@orrn/domain";
import { Chip } from "@orrn/ui/components/chip";

import {
  bandPositionWord,
  statusLabel,
  type BandPosition,
  type CopyStatus,
  type DriftTone,
} from "./fixtures";

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

export function StatusChip({ status }: { status: CopyStatus }) {
  return <Chip tone={statusTone(status)}>{statusLabel(status)}</Chip>;
}

export function PercentChip({ tone, label }: { tone: DriftTone; label: string }) {
  if (tone === "none") return null;
  return <Chip tone={toneToChip(tone)}>{label}</Chip>;
}

export function BandPositionChip({ position }: { position: BandPosition | null }) {
  if (!position) return null;
  return <Chip tone={positionTone(position)}>{bandPositionWord(position)}</Chip>;
}
