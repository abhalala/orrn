import { describe, expect, test } from "bun:test";

import { findBlocks } from "./blocks";

// Better guesses for unsure blocks (PORTAL-FIX2-OPEN R-new-3, R-new-4). They stay unsure; the guess is the one the
// person will most often confirm. Synthetic sheets only.

describe("R-new-3: a first data row with a cell right of the header stays a data row", () => {
  const cases: [unknown[][], string[], number][] = [
    [[["Name", "Phone", "City"], ["Asha", "", "Surat", "vip"], ["Kamal", "9797", "Rajkot"]], ["Name", "Phone", "City", ""], 2],
    [[["Code", "Party", "City", "State"], ["C001", "Om Metals", "", "Gujarat", "old account"], ["C002", "Shree Ganesh", "Surat", "Gujarat"]], ["Code", "Party", "City", "State", ""], 2],
    [[["Party", "Section", "Qty"], ["Om Metals", "", "", "see note"], ["", "R 2105", 12], ["", "R 2106", 5]], ["Party", "Section", "Qty", ""], 3],
  ];
  for (const [m, headers, n] of cases) {
    test(String((m[0] as string[]).join(" | ")), () => {
      const [b] = findBlocks(m as never);
      expect(b!.headerRows).toBe(1);
      expect(b!.headers).toEqual(headers);
      expect(b!.rows.length).toBe(n);
      expect(b!.confidence).toBe("unsure");
    });
  }
});

describe("R-new-4: a letterhead is a title, and month groups with no key column are a two-row header", () => {
  test("a letterhead cell past the header's last column", () => {
    const [b] = findBlocks([["Despatch Register 2025-26", "", "", "", "Fourcubes Extrusions"], ["Sr", "Party", "Section", "Qty"], [1, "Om Metals", "T 4012", 20]]);
    expect(b!.title).toBe("Despatch Register 2025-26 Fourcubes Extrusions");
    expect(b!.headers).toEqual(["Sr", "Party", "Section", "Qty"]);
    expect(b!.headerRows).toBe(1);
  });

  test("a letterhead over a header with an unnamed column", () => {
    const [b] = findBlocks([["Despatch Register 2025-26", "", "", "Fourcubes Extrusions"], ["Sr", "Party", "Section", ""], [1, "Om Metals", "T 4012", 20]]);
    expect(b!.title).toBe("Despatch Register 2025-26 Fourcubes Extrusions");
    expect(b!.headers).toEqual(["Sr", "Party", "Section", ""]);
    expect(b!.headerRows).toBe(1);
  });

  test("Apr 2025 and May 2025 over uneven sub-columns", () => {
    const [b] = findBlocks([["Apr 2025", "", "", "May 2025", ""], ["Kg", "Pcs", "Amt", "Kg", "Pcs"], [1, 2, 3, 4, 5]]);
    expect(b!.headerRows).toBe(2);
    expect(b!.title).toBeNull();
    expect(b!.headers).toEqual(["Apr 2025 Kg", "Apr 2025 Pcs", "Apr 2025 Amt", "May 2025 Kg", "May 2025 Pcs"]);
  });
});
