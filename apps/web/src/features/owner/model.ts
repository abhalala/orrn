/** View model of the owner's morning page: the server's figures written as tiles. Pure, so it is tested without a render. */
import type { MessageKey, TranslateVars } from "@orrn/i18n";

export type OwnerT = (key: MessageKey, vars?: TranslateVars) => string;

/** The figures `reports.morning` returns (the shape of `MorningFigures` in the domain). */
export type OwnerFigures = {
  day: string;
  pressedG: number;
  recoveryBp: number | null;
  runs: number;
  trialG: number;
  downtime: { reason: string; minutes: number }[];
  downtimeMinutes: number;
  dispatches: number;
  dispatchedG: number;
  openLines: number;
  bakiG: number;
  failedCasts: { number: string; alloy: string | null }[];
};

export type OwnerFormat = {
  /** Grams as the plant's mass text, with the unit. */
  kg(g: number): string;
  /** Basis points as a percent with one decimal, with the sign. */
  pct(bp: number): string;
};

export type OwnerTile = { id: string; label: string; value: string; notes: string[]; lines?: string[]; empty?: string };

/** "Part 2 (6063)" or just "Part 2" when the alloy is not known. */
export const failedCastLine = (c: { number: string; alloy: string | null }): string => (c.alloy ? `${c.number} (${c.alloy})` : c.number);

export const downtimeLine = (d: { reason: string; minutes: number }, t: OwnerT): string => `${d.reason} ${t("reg.owner.downtimeMin", { min: d.minutes })}`;

export function ownerTiles(f: OwnerFigures, fmt: OwnerFormat, t: OwnerT): OwnerTile[] {
  const pressedNotes = [t("reg.owner.pressedBody", { runs: f.runs })];
  if (f.trialG > 0) pressedNotes.push(t("reg.owner.trials", { kg: fmt.kg(f.trialG) }));
  return [
    { id: "pressed", label: t("reg.owner.pressed"), value: fmt.kg(f.pressedG), notes: pressedNotes },
    { id: "recovery", label: t("reg.owner.recovery"), value: f.recoveryBp === null ? t("reg.owner.noRuns") : fmt.pct(f.recoveryBp), notes: [] },
    {
      id: "downtime",
      label: t("reg.owner.downtime"),
      value: t("reg.owner.downtimeMin", { min: f.downtimeMinutes }),
      notes: [],
      lines: f.downtime.map((d) => downtimeLine(d, t)),
      empty: f.downtime.length === 0 ? t("reg.owner.noDowntime") : undefined,
    },
    { id: "dispatched", label: t("reg.owner.dispatched"), value: fmt.kg(f.dispatchedG), notes: [t("reg.owner.dispatchedBody", { count: f.dispatches })] },
    { id: "baki", label: t("reg.owner.baki"), value: fmt.kg(f.bakiG), notes: [t("reg.owner.bakiBody", { count: f.openLines })] },
    {
      id: "failed",
      label: t("reg.owner.failedCasts"),
      value: String(f.failedCasts.length),
      notes: [],
      lines: f.failedCasts.map(failedCastLine),
      empty: f.failedCasts.length === 0 ? t("reg.owner.noFailedCasts") : undefined,
    },
  ];
}

/** The day before or after `day` (both `YYYY-MM-DD`). */
export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
