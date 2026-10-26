import { describe, expect, test } from "bun:test";

import { PUBLIC_PATH, renderPublic } from "../scripts/gen-public";
import { en } from "./en";
import { enPublic } from "./en-public.gen";
import { PUBLIC_KEYS, pickMessages, type MessageTree } from "./public-keys";

function has(tree: MessageTree, path: string): boolean {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== undefined;
}

describe("public English (the web entry's strings for /)", () => {
  test("src/en-public.gen.ts matches en.ts and public-keys.ts (run `bun run --cwd packages/i18n gen:public`)", async () => {
    expect(await Bun.file(PUBLIC_PATH).text()).toBe(renderPublic());
    expect(enPublic).toEqual(pickMessages(en, PUBLIC_KEYS) as typeof enPublic);
  });

  test("every public key names a string or a namespace in en.ts", () => {
    expect(PUBLIC_KEYS.filter((key) => !has(en, key))).toEqual([]);
  });

  test("pickMessages keeps whole subtrees and single leaves, nothing else", () => {
    const tree = { a: { x: "1", y: "2" }, b: { c: { d: "3", e: "4" } }, f: "5" };
    expect(pickMessages(tree, ["a", "b.c.d", "f"])).toEqual({ a: { x: "1", y: "2" }, b: { c: { d: "3" } }, f: "5" });
    expect(pickMessages(tree, ["b.nope"])).toEqual({});
  });
});
