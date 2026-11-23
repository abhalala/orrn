import { expect, test } from "bun:test";
import { memoryNonceStore } from "../src/nonce";

test("nonce store: replay refused, expiry frees, full refuses", () => {
  const s = memoryNonceStore({ ttlMs: 100, maxSize: 2 });
  expect(s.claim("a", 0)).toBe(true);
  expect(s.claim("a", 1)).toBe(false);
  expect(s.claim("b", 2)).toBe(true);
  expect(s.claim("c", 3)).toBe(false); // full, nothing expired
  expect(s.claim("c", 101)).toBe(true); // a expired
});
