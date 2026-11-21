import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { hashFileParts, Sha256 } from "./sha256";

const ref = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytesOf = (n: number, seed = 1) => {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
};

describe("incremental SHA-256", () => {
  test("matches the reference at the padding boundaries (0, 55, 56, 63, 64, 65, 119, 120, 128 bytes)", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const b = bytesOf(n, n + 3);
      expect(new Sha256().update(b).hex()).toBe(ref(b));
    }
  });

  test("the same digest whatever the slices are", () => {
    const b = bytesOf(10_007);
    for (const cut of [1, 3, 63, 64, 65, 4096]) {
      const h = new Sha256();
      for (let i = 0; i < b.length; i += cut) h.update(b.subarray(i, i + cut));
      expect(h.hex()).toBe(ref(b));
    }
  });

  test("past 512 MB (2^32 bits) the bit length stays right", () => {
    // 600 MiB streamed in 8 MiB slices, compared with node's hasher fed the same slices.
    const slice = bytesOf(8 * 1024 * 1024, 9);
    const mine = new Sha256();
    const theirs = createHash("sha256");
    for (let i = 0; i < 75; i++) {
      slice[0] = i;
      mine.update(slice);
      theirs.update(slice);
    }
    expect(mine.hex()).toBe(theirs.digest("hex"));
  }, 120_000);
});

describe("hashFileParts", () => {
  test("a file over one part: the whole digest and each part's, one slice at a time", async () => {
    const b = bytesOf(2 * 1000 + 37);
    const out = await hashFileParts(new Blob([b]), { partSize: 1000 });
    expect(out.sha256).toBe(ref(b));
    expect(out.parts).toEqual([ref(b.subarray(0, 1000)), ref(b.subarray(1000, 2000)), ref(b.subarray(2000))]);
  });

  test("a file of one part is hashed whole, with no part list", async () => {
    const b = bytesOf(1000);
    expect(await hashFileParts(new Blob([b]), { partSize: 1000 })).toEqual({ sha256: ref(b), parts: null });
  });
});
