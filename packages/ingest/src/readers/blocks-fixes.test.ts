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

describe("C15: a short letterhead or title row is not the header", () => {
  test("company name and a date in two cells", () => {
    const [b] = findBlocks([
      ["FOURCUBES EXTRUSIONS", "", "", "Date: 31/10/2025"],
      ["Sr", "Party", "Section", "Qty"],
      [1, "Om Metals", "T 4012", 20],
    ]);
    expect(b!.headers).toEqual(["Sr", "Party", "Section", "Qty"]);
    expect(b!.headerRows).toBe(1);
    expect(b!.title).toBe("FOURCUBES EXTRUSIONS Date: 31/10/2025");
    expect(b!.rows).toEqual([["1", "Om Metals", "T 4012", "20"]]);
  });

  test("a two-cell title with adjacent cells", () => {
    const [b] = findBlocks([
      ["Stock statement", "as on 31.10.2025"],
      ["Series", "Section", "Qty", "Weight"],
      ["R", "2105", 4, 12.5],
    ]);
    expect(b!.headers).toEqual(["Series", "Section", "Qty", "Weight"]);
    expect(b!.rows.length).toBe(1);
  });

  test("a real two-row header still merges", () => {
    const [b] = findBlocks([
      ["Section", "Weight", "", "Rate"],
      ["", "Min", "Max", ""],
      ["R2105", 2.1, 2.4, 200],
    ]);
    expect(b!.headerRows).toBe(2);
    expect(b!.headers).toEqual(["Section", "Weight Min", "Weight Max", "Rate"]);
  });
});

describe("C33: a footer after a blank row is not a new block", () => {
  test("Prepared by and Checked by under the table", () => {
    const blocks = findBlocks([
      ["Sr", "Section", "Qty"],
      [1, "2105", 4],
      [2, "2106", 5],
      [],
      ["Prepared by", "", "Checked by"],
    ]);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.headers).toEqual(["Sr", "Section", "Qty"]);
  });
});

