import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

type Tree = { readonly [key: string]: string | Tree };
const has = (tree: Tree, key: string) => {
  let at: string | Tree | undefined = tree;
  for (const part of key.split(".")) at = typeof at === "object" ? at[part] : undefined;
  return typeof at === "string";
};

/**
 * BACKLOG 54: Today's press tile is read on the floor, so every string it shows is in gu (and hi):
 * it uses `today.press.*` (gu-complete, gu.test.ts) plus the gu-complete `units` / `press.console`.
 */
describe("Today's press tile strings", () => {
  const source = readFileSync(join(import.meta.dir, "today-tile.tsx"), "utf8");
  const keys = [...source.matchAll(/\bt\("([\w.]+)"/g)].map((m) => m[1] as string);

  test("it reads only today.press, units and press.console keys", () => {
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !/^(today\.press|units|press\.console)\./.test(k))).toEqual([]);
  });

  test("every key it reads is in en, hi and gu", () => {
    for (const k of keys) expect({ k, en: has(en as Tree, k), hi: has(hi as unknown as Tree, k), gu: has(gu as unknown as Tree, k) }).toEqual({ k, en: true, hi: true, gu: true });
  });
});
