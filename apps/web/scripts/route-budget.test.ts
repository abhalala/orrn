import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { htmlRoots, measureRoute, staticImports } from "./route-budget";

describe("staticImports", () => {
  test("finds static imports and re-exports, never dynamic import()", () => {
    const code = [
      'import{a as b}from"./a-1.js";',
      'import"./side-2.js";',
      'export{c}from"./re-3.js";',
      'const lazy=()=>import("./lazy-4.js");',
      'import * as ns from "../up-5.js";',
    ].join("");
    expect(staticImports(code).sort()).toEqual(["../up-5.js", "./a-1.js", "./re-3.js", "./side-2.js"]);
  });
});

describe("htmlRoots", () => {
  test("module entries and modulepreloads, not the inline script or the stylesheet", () => {
    const html = `<script>var x=1</script>
      <script type="module" crossorigin src="/assets/index-A.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/runtime-B.js">
      <link rel="stylesheet" href="/assets/index-C.css">`;
    expect(htmlRoots(html)).toEqual(["assets/index-A.js", "assets/runtime-B.js"]);
  });
});

describe("measureRoute", () => {
  let dist: string;
  const files: Record<string, string> = {
    "assets/entry.js": 'import{x}from"./shared.js";const r=()=>import("./route.js");const o=()=>import("./other.js");',
    "assets/preload.js": "export const p=1;",
    "assets/shared.js": "export const x=1;".repeat(20),
    "assets/route.js": 'import{y}from"./route-dep.js";const el={"data-orrn-marketing":true};const l=()=>import("./lazy.js");',
    // Two and three hops from the route chunk, through a subfolder and back up with "../".
    "assets/route-dep.js": 'import{d}from"./nested/deep.js";' + "export const y=2;".repeat(30),
    "assets/nested/deep.js": 'import{f}from"../leaf.js";export const d=5;',
    "assets/leaf.js": "export const f=6;".repeat(40),
    "assets/lazy.js": "export const z=3;".repeat(500),
    "assets/other.js": "export const o=4;".repeat(500),
  };

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), "route-budget-"));
    mkdirSync(join(dist, "assets", "nested"), { recursive: true });
    writeFileSync(
      join(dist, "index.html"),
      '<script type="module" src="/assets/entry.js"></script><link rel="modulepreload" href="/assets/preload.js">',
    );
    for (const [path, code] of Object.entries(files)) writeFileSync(join(dist, path), code);
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  test("counts the entry, preloads and the marked route chunk with their whole static import chain only", () => {
    const result = measureRoute(dist, "data-orrn-marketing");
    const counted = [
      "assets/entry.js",
      "assets/leaf.js",
      "assets/nested/deep.js",
      "assets/preload.js",
      "assets/route-dep.js",
      "assets/route.js",
      "assets/shared.js",
    ];
    expect(result.files.map((f) => f.file).sort()).toEqual(counted);
    expect(result.routeChunks).toEqual(["assets/route.js"]);
    const expected = counted.reduce((sum, path) => sum + gzipSync(files[path]!).length, 0);
    expect(result.gzip).toBe(expected);
  });

  test("reports no route chunks when the marker is missing", () => {
    expect(measureRoute(dist, "data-not-there").routeChunks).toEqual([]);
  });
});
