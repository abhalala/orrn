/**
 * B1 (XE-BILL review): every client surface reads modules with the server's rule (`isModuleOn` /
 * `anyModuleOn` in @orrn/domain). A stored `["billing"]` keeps every floor module on.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { todaySections } from "../features/today/today-model";
import { buildCommands } from "./palette/actions";
import { testMe } from "./palette/test-me";

const ROOTS = [join(import.meta.dir, ".."), join(import.meta.dir, "../../../native/lib"), join(import.meta.dir, "../../../native/features"), join(import.meta.dir, "../../../native/app")];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("modules rule (B1)", () => {
  test("no client file keeps its own 'empty list = all on' check", () => {
    const offenders = ROOTS.flatMap((r) => files(r)).filter((p) => /modules\.length\s*(===|>|!==)\s*0/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("Today and the palette keep the floor on a plant that ticked only billing", () => {
    const billing = testMe("owner", { modules: ["billing"] });
    expect(todaySections(billing)).toEqual({ dispatches: true, sessions: true });
    const env = { locale: "en" as const, theme: "system" as const, scanAvailable: true, arrangeAvailable: true, hasRecents: false };
    const withBilling = buildCommands({ ...env, me: billing }).map((c) => c.id);
    const plain = buildCommands({ ...env, me: testMe("owner") }).map((c) => c.id);
    expect(withBilling).toEqual(plain);
    expect(withBilling).toContain("scan-bundle");
  });
});
