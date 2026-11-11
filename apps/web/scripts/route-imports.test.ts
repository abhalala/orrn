/**
 * Route-budget guard (final explore round 1, I2): a route file's `validateSearch` and `beforeLoad` stay in the app
 * entry, so anything a route file imports is in the `/` closure. The audit action words (about 180 strings) and
 * the approvals view code are for the pages only; the routes take their pure helpers from `model.ts`
 * and `approval-filter.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  /features\/audit\/action-words/,
  /features\/approvals\/approval-view/,
  // Imports the plant formatter text helpers (units layer): the search helper for the card tab is `card-tab.ts`.
  /features\/die-room\/die-room-model/,
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("route files import no view code that is meant to be lazy", () => {
  const files = routeFiles(join(import.meta.dir, "../src/routes"));
  test("scans the route tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });
  test("no route file imports the audit words or the approvals view", () => {
    const hits: string[] = [];
    for (const file of files) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports) if (FORBIDDEN.some((re) => re.test(spec))) hits.push(`${file.split("/src/")[1]} imports ${spec}`);
    }
    expect(hits).toEqual([]);
  });
  // TanStack's code splitter leaves a route file whole when it exports anything besides `Route`, so every import of
  // that file (the plant formatter and the unit registry, in the units layer) lands in the app entry and the `/` closure.
  // A component a test wants goes in its own module under features/.
  test("no route file exports anything but Route", () => {
    const hits: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class|default)\s+(\w+)?/gm)) {
        if (m[1] !== "Route") hits.push(`${file.split("/src/")[1]} exports ${m[1] ?? "default"}`);
      }
    }
    expect(hits).toEqual([]);
  });
  // Vite warns "does not export a Route" for any file under routes/ that is not a route, and the router plugin
  // reads it as a route. Tests sit beside the feature code they test (`features/<area>/*.test.tsx`).
  test("no test file sits in the routes folder", () => {
    const tests: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.test\.tsx?$/.test(name)) tests.push(path.split("/src/")[1]!);
      }
    };
    walk(join(import.meta.dir, "../src/routes"));
    expect(tests).toEqual([]);
  });
});
