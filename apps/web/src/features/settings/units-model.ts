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
 * The saved choices changed under an open tab (another admin, a second tab, this tab's own save): a draft the person had not
 * touched follows them, so Save does not light up with nothing changed and a later save cannot send the old choices back.
 * A draft the person has edited is kept as it is.
 */
export function rebaseDraft(draft: UnitsDraft, was: UnitsDraft, now: UnitsDraft): UnitsDraft {
  return draftDirty(was, now) && !draftDirty(draft, was) ? now : draft;
}

/**
 * The saved set moved under an open tab and the person has edited some choices: the choices they did not touch follow the
 * saved set (so the preview and Save show what will really be stored), the ones they touched stay as they typed them.
 */
export function followUntouched(draft: UnitsDraft, touched: ReadonlySet<keyof UnitsDraft>, saved: UnitsDraft): UnitsDraft {
  const next = { ...draft };
  let moved = false;
  for (const k of Object.keys(draft) as (keyof UnitsDraft)[]) {
    if (!touched.has(k) && next[k] !== saved[k]) {
      (next as Record<string, string>)[k] = saved[k];
      moved = true;
    }
  }
  return moved ? next : draft;
}

/**
 * What `company.updateSettings({ units })` takes: only the choices the person changed from what the plant has saved.
 * The server merges them over the stored set field by field (`mergeUnitSettings`), so the marks and month style the
 * form does not edit stay as they are, and a draft opened before another admin's save cannot send that admin's
 * choices back. `touched` names the choices the person edited in this tab; with it, a choice the person did not touch is never
 * sent even when the saved set moved under the open tab.
 */
export function draftPayload(draft: UnitsDraft, plant: PlantUnitSettings, touched?: ReadonlySet<keyof UnitsDraft>) {
  const saved = draftFromSettings(plant);
  const changed = (k: keyof UnitsDraft) => draft[k] !== saved[k] && (touched === undefined || touched.has(k));
  const units: Partial<Pick<UnitsDraft, "mass" | "length" | "linear_mass">> = {};
  if (changed("mass")) units.mass = draft.mass;
  if (changed("length")) units.length = draft.length;
  if (changed("linear_mass")) units.linear_mass = draft.linear_mass;
  const out: {
    units?: typeof units;
    number?: { grouping: UnitsDraft["grouping"] };
    date?: { order: UnitsDraft["dateOrder"] };
    clock?: UnitsDraft["clock"];
  } = {};
  if (Object.keys(units).length > 0) out.units = units;
  if (changed("grouping")) out.number = { grouping: draft.grouping };
  if (changed("dateOrder")) out.date = { order: draft.dateOrder };
  if (changed("clock")) out.clock = draft.clock;
  return out;
}

/** The set the screens would use for this draft (the plant's other choices kept). */
export function draftPrefs(draft: UnitsDraft, plant: PlantUnitSettings): ResolvedPrefs {
  const whole = {
    units: { ...plant.units, mass: draft.mass, length: draft.length, linear_mass: draft.linear_mass },
    number: { ...plant.number, grouping: draft.grouping },
    date: { ...plant.date, order: draft.dateOrder },
    clock: draft.clock,
  };
  return screenPrefs({ ...plant, ...whole } as PlantUnitSettings);
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
