import type { BuiltinHole } from "./types";

/** From `columnGuide("dies")` and `IMPORT_FIELDS.dies`. Plan B2, example 1. */
export const builtinDies: BuiltinHole = {
  id: "dies",
  version: 1,
  target: "dies",
  keys: ["series", "sectionCode"],
  onExisting: "ask",
  fields: [
    { field: "series", aliases: ["series", "die series"], required: true, caseTo: "upper" },
    { field: "sectionCode", aliases: ["section code", "section", "die no", "code", "die section code", "die section"], required: true },
    { field: "weightMinG", aliases: ["min weight", "weight min", "min", "minimum weight", "min wt", "range min"], unitFromHeader: "linear_mass", required: true },
    { field: "weightMaxG", aliases: ["max weight", "weight max", "max", "maximum weight", "max wt", "range max"], unitFromHeader: "linear_mass", required: true },
    { field: "name", aliases: ["name", "die name", "description"] },
    { field: "widthMm", aliases: ["width", "dimensions width"], unitFromHeader: "dimension" },
    { field: "thicknessMm", aliases: ["thickness", "dimensions thickness", "thk"], unitFromHeader: "dimension" },
    { field: "legMm", aliases: ["leg"], unitFromHeader: "dimension" },
    { field: "status", aliases: ["status"], pick: { active: "active", archived: "archived" } },
    { field: "notes", aliases: ["notes", "note", "remarks"] },
  ],
};
