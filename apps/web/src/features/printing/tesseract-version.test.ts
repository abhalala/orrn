import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Photo import serves Tesseract's worker (from `tesseract.js`) and its wasm core (from
 * `tesseract.js-core`, pinned in apps/web) from this app. The worker is built against one core
 * release; a mismatch fails every read, so both pins move together.
 */
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

describe("tesseract pins", () => {
  test("the core we serve is the release the worker expects", () => {
    const web = readJson(join(import.meta.dir, "../../../package.json"));
    expect(web.dependencies["tesseract.js"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(web.dependencies["tesseract.js-core"]).toMatch(/^\d+\.\d+\.\d+$/);
    const worker = readJson(join(import.meta.dir, "../../../node_modules/tesseract.js/package.json"));
    const core = readJson(join(import.meta.dir, "../../../node_modules/tesseract.js-core/package.json"));
    expect(worker.version).toBe(web.dependencies["tesseract.js"]);
    expect(core.version).toBe(web.dependencies["tesseract.js-core"]);
    expect(worker.dependencies["tesseract.js-core"].replace(/^[\^~]/, "")).toBe(core.version);
  });
});
