/**
 * Entry in the plant's unit for forms whose draft is TEXT in a fixed unit (kg, g, mm, ft, in, kg per 12 ft).
 * The form model keeps reading its draft exactly as before (so the models stay pure and their tests stand); this module
 * converts between that draft text and what the person types in the plant's unit, with the exact path of `@orrn/domain`.
 *
 *   typed text (plant unit)  --strict parse-->  canonical integer  --exact-->  draft text (the model's unit)
 *   draft text (model unit)  --exact-->         canonical integer  --entryText-->  what the box shows
 *
 * A plant whose unit already is the draft's unit gets the draft untouched (the old box, character for character).
 */
import { convertStorage, convertText, entryDecimals, formatStorage, resolveField, type FieldId, type Fmt, type Kind, type ParseProblem, type UnitId } from "@orrn/domain";

export type EntrySpec = {
  /** The quantity (names the kind and the stored unit). */
  field: FieldId;
  /** The unit the form's draft text is written in. */
  native: UnitId;
  /**
   * A box that was a plain mm box on every plant (a die wall, a billet diameter, a split cut). A feet and inches plant keeps
   * that box and its draft as they were: a bare number there is mm, never feet. A plant on metres still converts.
   */
  plainOnFtIn?: boolean;
  /**
   * The form's model takes WHOLE units of `native` (die life in whole kg). A box that converts (a pound plant) rounds what is
   * typed to the nearest whole native unit before it writes the draft, and says what it stored; under half a unit it refuses.
   */
  wholeNative?: boolean;
};

export const MASS_KG: EntrySpec = { field: "order.weight", native: "kg" };
/** A weight the model keeps in whole kg (die life). */
export const WHOLE_KG: EntrySpec = { ...MASS_KG, wholeNative: true };
export const MASS_G: EntrySpec = { field: "order.weight", native: "g" };
export const LENGTH_MM: EntrySpec = { field: "bundle.length", native: "mm" };
/** A wall or die measure in mm that may carry a tenth: the stored step is a tenth of a mm. */
export const WALL_MM: EntrySpec = { field: "die.wall", native: "mm", plainOnFtIn: true };
/** A diameter or short cut in mm that every plant, feet and inches ones too, has always typed in mm (billet diameter, split cut). */
export const DIAMETER_MM: EntrySpec = { field: "bundle.length", native: "mm", plainOnFtIn: true };
export const LENGTH_FT: EntrySpec = { field: "bundle.length", native: "ft" };
export const LENGTH_IN: EntrySpec = { field: "bundle.length", native: "in" };
export const SECTION_KG12: EntrySpec = { field: "die.band", native: "kg_12ft" };

const PLAIN = { grouping: "none", decimal: ".", group: "," } as const;

export const kindOf = (spec: EntrySpec): Kind => resolveField(spec.field).kind;

/** Feet and inches plants: forms that hold feet or inches already are in the plant's unit. */
export function followsPlant(fmt: Fmt, spec: EntrySpec): boolean {
  const unit = fmt.unitOf(kindOf(spec));
  if (unit.id === spec.native) return true;
  if (spec.plainOnFtIn && spec.native === "mm" && unit.composite) return true;
  // Small amounts typed in grams (nitriding powder) stay in grams for a kg or tonne plant; only pounds change them.
  if (spec.native === "g" && (unit.id === "kg" || unit.id === "t")) return true;
  // Feet and inch boxes (the foundry's billet and tank gauge) keep their words for a plant on mm, as today; a feet and
  // inches plant is already there; only a plant that chose metres converts them.
  if (spec.native === "ft" || spec.native === "in") return unit.id === "mm" || Boolean(unit.composite);
  return false;
}

/**
 * The box for a log or billet length. Feet for a plant that follows feet (mm and feet and inches plants, as today); whole mm
 * for a plant on metres, so a typed metre figure is stored exactly (3.5 m is 3500 mm, not 11.48 ft read back as 3499).
 */
export const logLengthSpec = (fmt: Fmt): EntrySpec => (followsPlant(fmt, LENGTH_FT) ? LENGTH_FT : LENGTH_MM);

/** Exact canonical integer of a draft written in the model's unit; null when it is not a plain number. */
export function draftToCanonical(spec: EntrySpec, draft: string): number | null {
  if (draft.trim() === "") return null;
  const r = convertText(resolveField(spec.field), draft, spec.native, { mode: "round" });
  return r.ok ? r.value : null;
}

/** The model's draft text for a canonical integer: the most digits that read back the same, no grouping. */
export function canonicalToDraft(spec: EntrySpec, value: number): string {
  const f = resolveField(spec.field);
  if (spec.wholeNative) return String(convertStorage(value, f.storage, spec.native).value);
  return formatStorage(value, f.storage, spec.native, Math.max(0, entryDecimals(spec.native, f.storage)), PLAIN, { trim: true });
}

/** What the box shows for a draft: the plant's unit, round-trip digits. A draft that is not a number shows as it is. */
export function draftToTyped(fmt: Fmt, spec: EntrySpec, draft: string): string {
  if (followsPlant(fmt, spec)) return draft;
  const v = draftToCanonical(spec, draft);
  return v === null ? (draft.trim() === "" ? "" : draft) : fmt.entryText(spec.field, v);
}

export type TypedStep = { draft: string; value: number | null; problem: ParseProblem | "kind" | null };

/**
 * One keystroke. In the plant's own unit the text is the draft (the old behaviour, no refusal added). In another unit
 * the text is read strictly: a good value becomes the draft in the model's unit; blank gives a blank draft; a refused
 * text gives a blank draft and the reason, so the form model sees "no value" and the box says what to type.
 */
export function typedToDraft(fmt: Fmt, spec: EntrySpec, text: string): TypedStep {
  if (followsPlant(fmt, spec)) return { draft: text, value: draftToCanonical(spec, text), problem: null };
  if (text.trim() === "") return { draft: "", value: null, problem: null };
  const r = fmt.parse(spec.field, text);
  if (!r.ok) return { draft: "", value: null, problem: r.problem };
  if (spec.wholeNative) {
    const f = resolveField(spec.field);
    const whole = convertStorage(r.value, f.storage, spec.native).value;
    if (r.value > 0 && whole < 1) return { draft: "", value: null, problem: "tooSmall" };
    return { draft: String(whole), value: convertStorage(whole, spec.native, f.storage).value, problem: null };
  }
  return { draft: canonicalToDraft(spec, r.value), value: r.value, problem: null };
}

/**
 * One press of an on-screen keypad. `current` is the text the person sees in the plant's unit (on a plant whose unit already
 * is the draft's unit, that is the draft). The key edits that text, never the draft, so "2 . 5" on a kg per metre plant is
 * 2.5 kg/m. `limit` says what text may be built up (digits and places). Null when the key adds nothing.
 */
export function keypadStep(fmt: Fmt, spec: EntrySpec, current: string, key: string, limit: RegExp): { typed: string; draft: string } | null {
  let typed: string;
  if (key === "back") typed = current.slice(0, -1);
  else if (key === "." && current.includes(".")) return null;
  else {
    typed = current + key;
    if (!limit.test(typed)) return null;
  }
  return { typed, draft: typedToDraft(fmt, spec, typed).draft };
}
