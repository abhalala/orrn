import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";

import { PLATFORM_REFUSALS, platformRefusalKey } from "./platform-refusal";

const get = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
const server = (file: string) => readFileSync(join(import.meta.dir, "../../../../../packages/server/src", file), "utf8");

/** The string values of a `const X = { a: "..." } as const` block. */
function sentences(src: string, marker: string): string[] {
  const from = src.indexOf(marker);
  const end = src.indexOf("} as const", from);
  return [...src.slice(from, end).matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
}

describe("role and plant API refusals", () => {
  test("every sentence the two routers throw has a key, in English and Hindi", () => {
    const all = [
      ...sentences(server("routers/roles.ts"), "export const ROLE_REFUSALS"),
      ...sentences(server("routers/apiAccess.ts"), "export const API_REFUSALS"),
      ...sentences(server("lib/moduleGate.ts"), "export const MODULE_OFF_MESSAGE").slice(0, 0),
      "That module is not on for this plant",
    ];
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((s) => !(s in PLATFORM_REFUSALS))).toEqual([]);
    for (const key of Object.values(PLATFORM_REFUSALS)) expect([typeof get(en, key), typeof get(hi, key)]).toEqual(["string", "string"]);
    expect(server("lib/moduleGate.ts")).toContain('MODULE_OFF_MESSAGE = "That module is not on for this plant"');
  });

  test("an error maps to its key; an unknown sentence never shows the server's words", () => {
    expect(platformRefusalKey(new Error("People still hold this role. Give them another role first"))).toBe("plat3.refusal.inUse");
    expect(platformRefusalKey({ message: "A role with this name already exists" })).toBe("plat3.refusal.nameTaken");
    expect(platformRefusalKey(new Error("boom"))).toBe("plat3.refusal.generic");
    expect(platformRefusalKey(undefined)).toBe("plat3.refusal.generic");
  });
});
