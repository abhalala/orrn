import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The camera loads ZXing's wasm from our own build (`zxing-wasm` pinned in
 * apps/web) while the JS glue comes from the copy `barcode-detector` depends
 * on. Glue and wasm must be the same release, or every detect() fails.
 */
function packageRoot(entry: string): string {
  let dir = dirname(realpathSync(fileURLToPath(import.meta.resolve(entry))));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name && entry.startsWith(pkg.name)) return dir;
    } catch {
      // keep walking up
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`package root of ${entry} not found`);
    dir = up;
  }
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

describe("zxing-wasm pin", () => {
  test("the wasm we serve is the release barcode-detector's glue was built for", () => {
    const web = readJson(join(import.meta.dir, "../../../package.json"));
    const pinned: string = web.dependencies["zxing-wasm"];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);

    const ours = readJson(join(packageRoot("zxing-wasm/reader"), "package.json"));
    expect(ours.version).toBe(pinned);

    // The copy barcode-detector itself resolves (its own dependency, not ours).
    const bdRoot = packageRoot("barcode-detector/ponyfill");
    const bd = readJson(join(bdRoot, "package.json"));
    const theirs = readJson(join(realpathSync(join(bdRoot, "..", "zxing-wasm")), "package.json"));
    expect(theirs.version).toBe(pinned);
    expect(String(bd.dependencies["zxing-wasm"])).toContain(pinned);
  });
});
