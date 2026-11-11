/**
 * Pure model for the Units tab (units layer, slice b): the draft the form edits, the payload it saves and the
 * preview lines. The unit lists come from `PLANT_UNIT_CHOICES` (what the first release offers); the arithmetic is
 * `@orrn/domain`'s, so the preview shows exactly what the screens will show after the save.
 */
import {
  formatterFor,
  PLANT_UNIT_CHOICES,
  screenPrefs,
  type Fmt,
  type OfferedKind,
  type PlantUnitSettings,
  type ResolvedPrefs,
  type UnitId,
} from "@orrn/domain";

export type UnitsDraft = {
  mass: "kg" | "t" | "lb";
  length: "mm" | "ft_in" | "m";
  linear_mass: "kg_12ft" | "kg_m" | "lb_ft";
  grouping: "indian" | "international";
  dateOrder: "dmy" | "mdy" | "ymd";
  clock: "h23" | "h12";
};

export const DATE_ORDERS = ["dmy", "mdy", "ymd"] as const;

/** The draft a plant starts from: its stored choice over the orrn default. */
export function draftFromPrefs(prefs: ResolvedPrefs): UnitsDraft {
  const grouping = prefs.number.grouping === "international" ? "international" : "indian";
  return {
    mass: prefs.units.mass as UnitsDraft["mass"],
    length: prefs.units.length as UnitsDraft["length"],
    linear_mass: prefs.units.linear_mass as UnitsDraft["linear_mass"],
    grouping,
    dateOrder: prefs.date.order,
    clock: prefs.clock,
  };
}

export function draftFromSettings(plant: PlantUnitSettings): UnitsDraft {
  return draftFromPrefs(screenPrefs(plant));
}

export function draftDirty(a: UnitsDraft, b: UnitsDraft): boolean {
  return (Object.keys(a) as (keyof UnitsDraft)[]).some((k) => a[k] !== b[k]);
}

/**
 * What `company.updateSettings({ units })` takes. Top-level keys sent replace the stored ones, so each block
 * carries the keys the form does not edit (decimal and group marks, month style) over from the plant.
 */
export function draftPayload(draft: UnitsDraft, plant: PlantUnitSettings) {
  return {
    units: { ...plant.units, mass: draft.mass, length: draft.length, linear_mass: draft.linear_mass },
    number: { ...plant.number, grouping: draft.grouping },
    date: { ...plant.date, order: draft.dateOrder },
    clock: draft.clock,
  };
}

/** The set the screens would use for this draft (the plant's other choices kept). */
export function draftPrefs(draft: UnitsDraft, plant: PlantUnitSettings): ResolvedPrefs {
  return screenPrefs({ ...plant, ...draftPayload(draft, plant) } as PlantUnitSettings);
}

export function choicesOf(kind: OfferedKind): readonly UnitId[] {
  return PLANT_UNIT_CHOICES[kind];
}

/** One sample instant for the date line: 10 Nov 2026, 14:05 UTC (19:35 on the plant clock in India). */
export const SAMPLE_AT = Date.UTC(2026, 10, 10, 14, 5);

export type PreviewLines = { weight: string; length: string; section: string; number: string; date: string };

/** Five sample lines in the style of the draft. The numbers are large enough to show Indian against international grouping. */
export function previewLines(fmt: Fmt): PreviewLines {
  return {
    weight: fmt.q("order.weight", 123_456_789),
    length: fmt.q("bundle.length", 3810),
    section: fmt.q("die.band", 2090),
    number: fmt.money(123_456_750),
    date: `${fmt.date(SAMPLE_AT, { year: true })}, ${fmt.time(SAMPLE_AT)}`,
  };
}

export function previewFor(draft: UnitsDraft, plant: PlantUnitSettings, env: { locale: "en" | "hi" | "gu"; timeZone: string }): PreviewLines {
  return previewLines(formatterFor(draftPrefs(draft, plant), env));
}
