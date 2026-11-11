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

describe("C-new-1: month group labels with a year are a two-row header, not a title", () => {
  test("Apr 2025 and May 2025 over Kg and Pcs", () => {
    const [b] = findBlocks([
      ["Party", "Apr 2025", "", "May 2025", ""],
      ["", "Kg", "Pcs", "Kg", "Pcs"],
      ["Shree Ganesh", 120, 4, 80, 3],
    ]);
    expect(b!.headerRows).toBe(2);
    expect(b!.headers).toEqual(["Party", "Apr 2025 Kg", "Apr 2025 Pcs", "May 2025 Kg", "May 2025 Pcs"]);
    expect(b!.title).toBeNull();
    expect(b!.rows).toEqual([["Shree Ganesh", "120", "4", "80", "3"]]);
  });

  test("a letterhead with a bare year in its last cell is still a title", () => {
    const [b] = findBlocks([
      ["Sales register", "", "", "FY 2025"],
      ["Sr", "Party", "Section", "Qty"],
      [1, "Om Metals", "T 4012", 20],
    ]);
    expect(b!.headerRows).toBe(1);
    expect(b!.headers).toEqual(["Sr", "Party", "Section", "Qty"]);
    expect(b!.title).toBe("Sales register FY 2025");
  });
});

describe("C-new-5: a letterhead with a year is a title, not a group label", () => {
  test("Despatch Register 2025-26 over Sr, Party, Section, Qty", () => {
    const [b] = findBlocks([
      ["Despatch Register 2025-26", "", "", "Fourcubes Extrusions"],
      ["Sr", "Party", "Section", "Qty"],
      [1, "Om Metals", "T 4012", 20],
    ]);
    expect(b!.headers).toEqual(["Sr", "Party", "Section", "Qty"]);
    expect(b!.headerRows).toBe(1);
    expect(b!.title).toBe("Despatch Register 2025-26 Fourcubes Extrusions");
    expect(b!.rows).toEqual([["1", "Om Metals", "T 4012", "20"]]);
  });

  test("one month group label whose sub-columns repeat under another top cell is a group label", () => {
    const [b] = findBlocks([
      ["Party", "Apr 2025", "", "Total", ""],
      ["", "Kg", "Pcs", "Kg", "Pcs"],
      ["Shree Ganesh", 120, 4, 120, 4],
    ]);
    expect(b!.headerRows).toBe(2);
    expect(b!.headers).toEqual(["Party", "Apr 2025 Kg", "Apr 2025 Pcs", "Total Kg", "Total Pcs"]);
    expect(b!.title).toBeNull();
  });

  // Generated letterheads: a title cell with a year at a random place, a second cell or none, over a 4 to 6 column
  // header. Every one must be a title above a one-row header.
  test("generated letterheads with a year stay titles", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const years = ["2025-26", "FY 2025", "2024", "Apr 2025", "March 2026"];
    const names = ["Despatch Register", "Sales Book", "Stock statement", "Order list"];
    const heads = ["Sr", "Party", "Section", "Qty", "Weight", "Rate"];
    for (let n = 0; n < 200; n++) {
      const width = 4 + rnd(3);
      const head = heads.slice(0, width);
      const top = Array<string>(width).fill("");
      const at = rnd(width - 1);
      top[at] = `${names[rnd(names.length)]} ${years[rnd(years.length)]}`;
      if (rnd(2) === 0) top[width - 1] = rnd(2) === 0 ? "Fourcubes Extrusions" : "Plant 2";
      const data = head.map((h, i) => (i === 0 ? 1 : h === "Party" ? "Om Metals" : h === "Section" ? "T 4012" : 20 + i));
      const [b] = findBlocks([top, head, data]);
      const label = JSON.stringify(top);
      expect(b!.headers, label).toEqual(head);
      expect(b!.headerRows, label).toBe(1);
      expect(b!.title, label).toBe(top.filter((c) => c !== "").join(" "));
    }
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

describe("C34: ragged rows keep the cells right of the header", () => {
  test("a CSV header with 2 cells and data rows with 3", () => {
    const [b] = findBlocks([
      ["Name", "Qty"],
      ["Asha", "5", "Dispatch note 12"],
      ["Ravi", "6"],
    ]);
    expect(b!.headers).toEqual(["Name", "Qty", ""]);
    expect(b!.rows[0]).toEqual(["Asha", "5", "Dispatch note 12"]);
  });
});
