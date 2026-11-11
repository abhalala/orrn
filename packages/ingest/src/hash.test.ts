import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  test("matches node:crypto on edge lengths and unicode", () => {
    const samples = ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(1000), "मिन वज़न ₹ kg/12ft\u001fé"];
    for (const s of samples) expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
  });
});
