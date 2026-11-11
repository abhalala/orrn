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
import { convertText, entryDecimals, formatStorage, resolveField, type FieldId, type Fmt, type Kind, type ParseProblem, type UnitId } from "@orrn/domain";

export type EntrySpec = {
  /** The quantity (names the kind and the stored unit). */
  field: FieldId;
  /** The unit the form's draft text is written in. */
  native: UnitId;
};

export const MASS_KG: EntrySpec = { field: "order.weight", native: "kg" };
export const MASS_G: EntrySpec = { field: "order.weight", native: "g" };
export const LENGTH_MM: EntrySpec = { field: "bundle.length", native: "mm" };
export const LENGTH_FT: EntrySpec = { field: "bundle.length", native: "ft" };
export const LENGTH_IN: EntrySpec = { field: "bundle.length", native: "in" };
export const SECTION_KG12: EntrySpec = { field: "die.band", native: "kg_12ft" };

const PLAIN = { grouping: "none", decimal: ".", group: "," } as const;

export const kindOf = (spec: EntrySpec): Kind => resolveField(spec.field).kind;

/** Feet and inches plants: forms that hold feet or inches already are in the plant's unit. */
export function followsPlant(fmt: Fmt, spec: EntrySpec): boolean {
  const unit = fmt.unitOf(kindOf(spec));
  if (unit.id === spec.native) return true;
  // Small amounts typed in grams (nitriding powder) stay in grams for a kg or tonne plant; only pounds change them.
  if (spec.native === "g" && (unit.id === "kg" || unit.id === "t")) return true;
  // Feet and inch boxes (the foundry's billet and tank gauge) keep their words for a plant on mm, as today; a feet and
  // inches plant is already there; only a plant that chose metres converts them.
  if (spec.native === "ft" || spec.native === "in") return unit.id === "mm" || Boolean(unit.composite);
  return false;
}

/** Exact canonical integer of a draft written in the model's unit; null when it is not a plain number. */
export function draftToCanonical(spec: EntrySpec, draft: string): number | null {
  if (draft.trim() === "") return null;
  const r = convertText(resolveField(spec.field), draft, spec.native, { mode: "round" });
  return r.ok ? r.value : null;
}

/** The model's draft text for a canonical integer: the most digits that read back the same, no grouping. */
export function canonicalToDraft(spec: EntrySpec, value: number): string {
  const f = resolveField(spec.field);
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
  return { draft: canonicalToDraft(spec, r.value), value: r.value, problem: null };
}
