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
});
