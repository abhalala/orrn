import type { DateFormat, UnitKind } from "../recipe";
import type { IngestTarget } from "../states";

export type BuiltinField = {
  field: string;
  aliases: string[];
  required?: boolean;
  /** Numeric field: the unit is read from the header (`Min weight (kg/12ft)`). Absent unit means the question. */
  unitFromHeader?: UnitKind;
  /** Value words to canonical values; anything else is refused. */
  pick?: Record<string, string>;
  /** Case step after trim. */
  caseTo?: "upper" | "lower" | "title";
  /** Format of a date field. Default `dmy`. */
  dateFormat?: DateFormat;
};

/** A hole that ships in code. `instantiate` turns it into a concrete recipe for one block's headers. */
export type BuiltinHole = {
  id: string;
  version: number;
  target: IngestTarget;
  keys: string[];
  onExisting: "ask" | "fill_blanks" | "skip";
  fields: BuiltinField[];
};
