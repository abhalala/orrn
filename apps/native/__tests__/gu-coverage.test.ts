import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";

/**
 * W4-GU: a Gujarati phone never shows an English screen word. Every dictionary key the app's source names
 * (a quoted string equal to a key, a group it reads whole, or the static start of a `${}` key) has a
 * Gujarati string. A new screen that reads a key with no Gujarati fails here.
 */
type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.add(path);
    else flatten(value, path, out);
  }
  return out;
}

const enKeys = flatten(en as unknown as Tree);
const guKeys = flatten(gu as unknown as Tree);
const ROOT = join(import.meta.dir, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

function usedKeys(): Set<string> {
  const used = new Set<string>();
  for (const file of [...sources(join(ROOT, "app")), ...sources(join(ROOT, "features")), ...sources(join(ROOT, "lib")), ...sources(join(ROOT, "components"))]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_${}]+)+)["'`]/g)) {
      const text = m[1]!;
      if (text.includes("${")) {
        const prefix = text.slice(0, text.indexOf("${"));
        for (const k of enKeys) if (k.startsWith(prefix)) used.add(k);
      } else if (enKeys.has(text)) used.add(text);
      else for (const k of enKeys) if (k.startsWith(`${text}.`)) used.add(k);
    }
  }
  return used;
}

describe("the phone speaks Gujarati to the end", () => {
  test("the scanner finds the app's keys (guards the scanner itself)", () => {
    const used = usedKeys();
    expect(used.size).toBeGreaterThan(800);
    expect(used.has("errors.network")).toBe(true);
    expect(used.has("refusal.unknown")).toBe(true);
    expect(used.has("native.pack.openSession")).toBe(true);
  });

  test("every key a native screen reads has a Gujarati string", () => {
    const missing = [...usedKeys()].filter((k) => !guKeys.has(k)).sort();
    expect(missing).toEqual([]);
  });
});
