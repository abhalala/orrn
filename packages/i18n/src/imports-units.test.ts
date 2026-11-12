import { expect, test } from "bun:test";

import { en } from "./en";
import { hi } from "./hi";

// The import readout names the unit the file parser used. The parser reads an unlabelled weight column, and a "(kg)" column,
// as kilograms whatever the plant's weight unit is, so the word is the fixed word, never the plant's {massUnit}.
test("the import readout names kilograms as kg for every plant", () => {
  expect(en.imports.unit.kg).toBe("kg");
  expect(hi.imports.unit.kg).toBe("kg");
});
