import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const require = createRequire(import.meta.url);
const { SHIMS, withNativeShims } = require("../metro-shims.js") as {
  SHIMS: Record<string, string>;
  withNativeShims: (config: object) => { resolver: { resolveRequest: (ctx: object, name: string, platform: string) => unknown } };
};

/**
 * Seen on the iOS simulator: signing out threw "Cannot find native module
 * 'ExpoNetwork'". @better-auth/expo lazily imports its optional peer
 * expo-network (to refetch the session when the phone comes back online).
 * The JS is resolvable from the bun store but the native module is not
 * linked into the app, and Metro reports a module that throws while loading
 * outside its start-up guard as a fatal error, even though the import has a
 * catch. orrn maps such optional native peers to JS stand-ins.
 */
describe("optional native peers that are not linked", () => {
  test("expo-network resolves to the stand-in", () => {
    const sentinel = { type: "sourceFile", filePath: "upstream" };
    const config = withNativeShims({ resolver: { resolveRequest: () => sentinel } });
    const resolved = config.resolver.resolveRequest({}, "expo-network", "ios") as { type: string; filePath: string };
    expect(resolved.type).toBe("sourceFile");
    expect(resolved.filePath).toBe(SHIMS["expo-network"]!);
    expect(existsSync(resolved.filePath)).toBe(true);
  });

  test("everything else goes to the existing resolver, or Metro's default", () => {
    const sentinel = { type: "sourceFile", filePath: "upstream" };
    expect(withNativeShims({ resolver: { resolveRequest: () => sentinel } }).resolver.resolveRequest({}, "react", "ios")).toBe(sentinel);
    const viaDefault = withNativeShims({ resolver: {} }).resolver.resolveRequest({ resolveRequest: () => "default" }, "react", "ios");
    expect(viaDefault).toBe("default");
  });

  test("a stand-in only exists while the package is not a real dependency (then it would be linked)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    for (const name of Object.keys(SHIMS)) expect(Object.keys(pkg.dependencies)).not.toContain(name);
  });

  test("the expo-network stand-in reports nothing, so Better Auth keeps treating the phone as online", async () => {
    const shim = await import("../lib/shims/expo-network");
    const sub = shim.addNetworkStateListener(() => {
      throw new Error("never called");
    });
    expect(typeof sub.remove).toBe("function");
    sub.remove();
  });

  test("metro.config.js applies the shims", () => {
    expect(readFileSync(join(ROOT, "metro.config.js"), "utf8")).toMatch(/withNativeShims\(/);
  });
});
