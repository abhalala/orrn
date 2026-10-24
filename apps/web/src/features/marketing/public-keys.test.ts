import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { enPublic } from "@orrn/i18n/en-public";
import { en } from "@orrn/i18n/en";

/**
 * The web entry carries only the English in @orrn/i18n's en-public.gen.ts;
 * the rest loads lazily and `/` in English does not wait for it. So every
 * message key the `/` page's code names must be public, or a first visitor
 * would see the raw key. This walks the app source `/` statically imports
 * (root route + marketing route, `@/` and relative imports; `import()` is
 * lazy and skipped) and checks each key-shaped string literal.
 *
 * Fails? Add the key to packages/i18n/src/public-keys.ts and run
 * `bun run --cwd packages/i18n gen:public`.
 */
const SRC = resolve(import.meta.dir, "../..");
const ROOTS = ["routes/__root.tsx", "routes/_public.tsx", "routes/_public/index.tsx"].map((f) => join(SRC, f));

function resolveImport(from: string, spec: string): string | undefined {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : undefined;
  if (!base) return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
    (p) => existsSync(p) && /\.tsx?$/.test(p),
  );
}

function sourceClosure(roots: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)) {
      if (/^\s*import\s+type\b/.test(m[0]) || /^\s*export\s+type\b/.test(m[0])) continue;
      const next = resolveImport(file, (m[1] ?? m[2])!);
      if (next && !next.endsWith(".test.ts")) queue.push(next);
    }
  }
  return [...seen];
}

function flatKeys(tree: object, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? [path] : flatKeys(v as object, path);
  });
}

describe("/ renders only public English", () => {
  const allKeys = new Set(flatKeys(en));
  const publicKeys = new Set(flatKeys(enPublic));
  const files = sourceClosure(ROOTS);

  test("walks the marketing page", () => {
    expect(files.some((f) => f.endsWith("features/marketing/hero.tsx"))).toBe(true);
  });

  test("every message key the / page names is in en-public.gen.ts", () => {
    const missing = new Set<string>();
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`]([a-zA-Z][\w]*(?:\.[\w]+)+)(\$\{)?/g)) {
        const literal = m[1]!;
        // A template like `status.bundle.${s}` names every key under its prefix.
        const named = m[2] ? [...allKeys].filter((k) => k.startsWith(literal)) : allKeys.has(literal) ? [literal] : [];
        for (const key of named) if (!publicKeys.has(key)) missing.add(`${key} (${file.slice(SRC.length + 1)})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
