import { describe, expect, test } from "bun:test";

import { findBlocks } from "./blocks";

// Synthetic sheets for the review 1 findings. No real plant data.

describe("C14: a header with a blank cell does not swallow a text data row", () => {
  test("customer list with an empty Contact-2 column", () => {
    const [b] = findBlocks([
      ["Customer", "Contact", "", "City"],
      ["Shree Ganesh", "Asha", "", "Surat"],
      ["Om Metals", "Ravi", "", "Pune"],
    ]);
    expect(b!.headerRows).toBe(1);
    expect(b!.headers).toEqual(["Customer", "Contact", "", "City"]);
    expect(b!.rows[0]).toEqual(["Shree Ganesh", "Asha", "", "Surat"]);
  });

  test("a text row that fills the blank but looks like the rows below is data", () => {
    const [b] = findBlocks([
      ["Customer", "Contact", "", "City"],
      ["Shree Ganesh", "Asha", "Mumbai", "Surat"],
      ["Om Metals", "Ravi", "Delhi", "Pune"],
    ]);
    expect(b!.headerRows).toBe(1);
    expect(b!.rows.length).toBe(2);
  });
});

