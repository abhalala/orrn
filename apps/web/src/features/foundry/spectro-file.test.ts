import { describe, expect, test } from "bun:test";

import { base64ToBlob, savedName } from "./spectro-file";

describe("spectro file helpers", () => {
  test("base64 comes back as the same bytes with the stored type", async () => {
    const blob = base64ToBlob(Buffer.from("PDF-1.4 hello").toString("base64"), "application/pdf");
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(13);
    expect(await blob.text()).toBe("PDF-1.4 hello");
  });
  test("an empty file is an empty blob, not an error", () => {
    expect(base64ToBlob("", "text/csv").size).toBe(0);
  });
  test("a saved name keeps no path pieces and is never empty", () => {
    expect(savedName("a/b\\c:d.pdf")).toBe("a_b_c_d.pdf");
    expect(savedName("  ")).toBe("spectro");
    expect(savedName("x".repeat(300))).toHaveLength(120);
  });
});
