/**
 * Worker startup CPU guard (Cloudflare `[10021] Script startup exceeded CPU time limit`).
 *
 * Everything the Worker entry imports statically is evaluated when the isolate starts, and Cloudflare
 * caps that CPU time. Deploy Dev for main 9882cebb hit the cap with every router evaluated at import.
 * So: top-level routers load lazily (routers/index.ts), and the full auth package, better-auth and the
 * model SDK load on first use. This test walks the static import graph from `apps/server/src/index.ts`
 * (value imports only; `import type` and `await import()` are skipped, as esbuild does) and fails when a
 * router module or one of those heavy packages becomes reachable at startup again.
 *
 * Measured with `wrangler check startup` (non-idle CPU of the startup profile, local machine):
 * about 143 ms before, about 46 ms after. Numbers and method: the PR "perf(server): cut Worker
 * startup CPU (10021 headroom)".
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const ENTRY = join(ROOT, "apps/server/src/index.ts");
const ROUTERS_DIR = join(ROOT, "packages/server/src/routers");

/** Bare packages that must never evaluate at startup. Load them inside the handler that needs them. */
const HEAVY_PACKAGES = ["better-auth", "@better-auth/", "@anthropic-ai/sdk", "@simplewebauthn/"];
/** Workspace modules that must never evaluate at startup (the full auth package builds better-auth). */
const HEAVY_FILES = ["packages/auth/src/index.ts"];

const exportsCache = new Map<string, Record<string, unknown>>();

function workspaceExports(pkg: string): Record<string, unknown> {
  let map = exportsCache.get(pkg);
  if (!map) {
    const json = JSON.parse(readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
    map = json.exports ?? {};
    exportsCache.set(pkg, map);
  }
  return map;
}

function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { default?: unknown }).default === "string") {
    return (value as { default: string }).default;
  }
  return null;
}

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** A workspace file path, or `{ external }` for a bare package. */
function resolveSpecifier(from: string, spec: string): string | { external: string } | null {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(from), spec));
  const m = /^@orrn\/([^/]+)(?:\/(.+))?$/.exec(spec);
  if (!m) return { external: spec };
  const [, pkg, sub] = m;
  const key = sub ? `./${sub}` : ".";
  const map = workspaceExports(pkg!);
  let target = exportTarget(map[key]);
  if (!target) {
    for (const [pattern, value] of Object.entries(map)) {
      if (!pattern.endsWith("/*")) continue;
      const prefix = pattern.slice(0, -1);
      const t = exportTarget(value);
      if (t && key.startsWith(prefix)) {
        target = t.replace("*", key.slice(prefix.length));
        break;
      }
    }
  }
  return target ? resolveFile(join(ROOT, "packages", pkg!, target)) : null;
}

/** Value imports and re-exports evaluated at module load. `import type` / `export type` are erased. */
function staticSpecifiers(source: string): string[] {
  const out: string[] = [];
  const fromClause = /^\s*(?:import|export)\s+(?!type\s)[^;]*?\s+from\s+["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s+["']([^"']+)["']/gm;
  for (const m of source.matchAll(fromClause)) out.push(m[1]!);
  for (const m of source.matchAll(sideEffect)) out.push(m[1]!);
  return out;
}

type Reach = { files: Map<string, string | null>; externals: Map<string, string> };

/** Every workspace file and bare package reachable from the entry through static imports, with the importer. */
function eagerGraph(): Reach {
  const files = new Map<string, string | null>([[ENTRY, null]]);
  const externals = new Map<string, string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
      const target = resolveSpecifier(file, spec);
      if (target === null) continue;
      if (typeof target === "object") {
        if (!externals.has(target.external)) externals.set(target.external, file);
        continue;
      }
      if (!files.has(target)) {
        files.set(target, file);
        queue.push(target);
      }
    }
  }
  return { files, externals };
}

function chain(reach: Reach, file: string): string {
  const steps: string[] = [];
  for (let cur: string | null | undefined = file; cur; cur = reach.files.get(cur)) steps.unshift(relative(ROOT, cur));
  return steps.join(" -> ");
}

const FIX =
  "Startup CPU guard (Cloudflare 10021, AGENTS.md 'Worker startup'): register routers in packages/server/src/routers/index.ts as " +
  '`key: lazy(() => import("./file").then((m) => m.fileRouter)),` and never import a router, `@orrn/auth`, better-auth ' +
  'or the model SDK statically from the Worker entry path; use `const { x } = await import("...")` inside the handler.';

describe("Worker startup stays light (10021)", () => {
  const reach = eagerGraph();

  test("the walk sees the real entry graph", () => {
    expect(reach.files.has(join(ROUTERS_DIR, "index.ts"))).toBe(true);
    expect(reach.files.has(join(ROOT, "packages/server/src/context.ts"))).toBe(true);
    expect(reach.files.size).toBeGreaterThan(50);
  });

  test("no router module is evaluated at startup: every top-level router is lazy", () => {
    const eagerRouters = [...reach.files.keys()]
      .filter((f) => f.startsWith(`${ROUTERS_DIR}/`) && f !== join(ROUTERS_DIR, "index.ts"))
      .map((f) => `${chain(reach, f)}\n  ${FIX}`);
    expect(eagerRouters).toEqual([]);
  });

  test("the full auth package, better-auth and the model SDK are not evaluated at startup", () => {
    const heavy = [
      ...HEAVY_FILES.map((f) => join(ROOT, f))
        .filter((f) => reach.files.has(f))
        .map((f) => `${chain(reach, f)}\n  ${FIX}`),
      ...[...reach.externals]
        .filter(([name]) => HEAVY_PACKAGES.some((p) => name === p || name.startsWith(p.endsWith("/") ? p : `${p}/`)))
        .map(([name, by]) => `${chain(reach, by)} -> ${name}\n  ${FIX}`),
    ];
    expect(heavy).toEqual([]);
  });

  test("routers/index.ts registers every router with lazy(), except the two inline procedures", () => {
    const src = readFileSync(join(ROUTERS_DIR, "index.ts"), "utf8");
    const body = src.slice(src.indexOf("export const appRouter = router({"), src.indexOf("export type AppRouter"));
    const entries = [...body.matchAll(/^ {2}(\w+):\s*(.*)$/gm)].map((m) => ({ key: m[1]!, value: m[2]! }));
    const notLazy = entries.filter((e) => !e.value.startsWith("lazy(() => import(") && !["healthCheck", "privateData"].includes(e.key));
    expect(notLazy.map((e) => `${e.key}: ${e.value}\n  ${FIX}`)).toEqual([]);
    expect(entries.length).toBeGreaterThan(40);
  });

  test("the press router registers the ageing reopen blocker itself (the ageing router may not be loaded)", async () => {
    // Only the press run router: this file never loads routers/ageing.ts before this test.
    await import("../src/routers/pressRun");
    const { reopenBlockers } = await import("../src/lib/press/reopenBlockers");
    const touched = new Error("ageing blocker queried the db");
    const db = new Proxy({}, { get: () => { throw touched; } }) as never;
    await expect(reopenBlockers(db, "company-1", "run-1")).rejects.toBe(touched);
  });

  test("loadAllRouters makes every procedure visible, nested routers included", async () => {
    const { appRouter, loadAllRouters } = await import("../src/routers/index");
    await loadAllRouters();
    const procedures = Object.keys(appRouter._def.procedures);
    expect(Object.keys(appRouter._def.lazy)).toEqual([]);
    expect(procedures.length).toBeGreaterThan(600);
    // A nested path (platform is a router of routers) and a sibling-prefix pair (die / dieInstance).
    expect(procedures.some((p) => p.startsWith("platform."))).toBe(true);
    expect(procedures.some((p) => p.startsWith("die."))).toBe(true);
    expect(procedures.some((p) => p.startsWith("dieInstance."))).toBe(true);
  });
});
