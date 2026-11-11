import type { ResolverId, UnitKind } from "../recipe";
import type { IngestTarget, RefusalCode } from "../states";
import type { UnitId } from "../units-adapter";

/** A field is a unit kind (numbers), a date, an enum or text. */
export type FieldKind = UnitKind | "text" | "date" | "enum";

/** `null` means the value is fine; otherwise the refusal code. */
export type FieldCheck = (value: string | number) => RefusalCode | null;

export type TargetField = {
  name: string;
  kind: FieldKind;
  /** Canonical unit of a numeric field: the unit of the stored integer. */
  unit: UnitId | null;
  required: boolean;
  /** The lookup that resolves this field to a live record (`lookup` step). */
  resolver: ResolverId | null;
  /** Allowed values of an `enum` field. */
  enum: readonly string[] | null;
  /** More than one value in a cell, separated by `;`. Up to `max` values. */
  multi: { sep: string; max: number } | null;
  /** One line for the bot's catalogue. */
  note: string;
  check: FieldCheck | null;
};

/** `field` is the offending field (null for the whole row). */
export type RowCheck = (values: Record<string, string | number | null>) => { field: string | null; code: RefusalCode } | null;

export type TargetDef = {
  id: IngestTarget;
  /** Merge order (plan B4). Masters first, orders last. */
  order: number;
  fields: TargetField[];
  /** The fields that find a live record. */
  keys: string[];
  /** Resolver that matches a live record by each key field, where it is not a plain column compare. */
  keyResolvers: Partial<Record<string, ResolverId>>;
  checkRow: RowCheck | null;
};
