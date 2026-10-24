import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";

import {
  pctTenthText,
  positionTone,
  statusTone,
  toneToChip,
  type BandPosition,
  type CopyStatus,
  type DriftTone,
} from "./die-room-model";

/** Where the copy is: rack, press, nitriding, die maker, retired. */
export function StatusChip({ status }: { status: CopyStatus }) {
  const { t } = useT();
  return (
    <Chip tone={statusTone(status)} truncate={false}>
      {t(`dieRoom.status.${status}`)}
    </Chip>
  );
}

/**
 * The server's percent against the band start, coloured by the server's tone. The word comes
 * with the number so colour is never the only signal ("+1.1% In band").
 */
export function PercentChip({ tone, pctTenth }: { tone: DriftTone; pctTenth: number | null }) {
  const { t } = useT();
  if (tone === "none" || pctTenth == null) return null;
  return (
    <Chip tone={toneToChip(tone)} truncate={false}>
      {pctTenthText(pctTenth)} {t(`dieRoom.drift.${tone}`)}
    </Chip>
  );
}

/** In, above or below the copy's band, by grams (the server's `position`). */
export function BandPositionChip({ position }: { position: BandPosition | null | undefined }) {
  const { t } = useT();
  if (!position) return null;
  return (
    <Chip tone={positionTone(position)} truncate={false}>
      {t(`dieRoom.position.${position}`)}
    </Chip>
  );
}

/** A section's worst tone across its available copies: the word, or "No reading" when none has one. */
export function WorstToneChip({ tone }: { tone: DriftTone }) {
  const { t } = useT();
  return (
    <Chip tone={toneToChip(tone)} truncate={false}>
      {t(`dieRoom.drift.${tone}`)}
    </Chip>
  );
}
