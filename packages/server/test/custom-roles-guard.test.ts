/**
 * XE PLATFORM row 79 guard: server code never checks a plant action from the role alone. Every action check goes
 * through the member's effective set (`ctxCan`, `ctxCanAny`, `meOfCtx`, `ctxHoldsGuard`, `actionProcedure`), so a
 * custom role applies everywhere. Things that deliberately key on the ROLE (approver rules, the Today layout,
 * stations, who may hand out which role, owner checks) do not call `can()` at all and are not matched here.
 *
 * Fails when a file under packages/server/src or apps/server/src builds a role-only `can()` subject, reads
 * `ROLE_ACTIONS`, or calls `fixedRoleCan` outside the listed uses.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const DIRS = ["packages/server/src", "apps/server/src"];

/** Allowed, with the reason. Paths relative to the repo root. */
const ALLOWED: Record<string, { pattern: RegExp; why: string }[]> = {
  "packages/server/src/lib/permissions.ts": [{ pattern: /.*/, why: "the permission core itself" }],
  "packages/server/src/lib/buddy/access.ts": [
    { pattern: /company: \{ role \}, isPlatformAdmin: false, platformRole: null \}, "buddy\.use"/, why: "buddy.use is owner only and never grantable; the owner never has a custom role" },
  ],
  "packages/server/src/routers/pressRun.ts": [
    { pattern: /fixedRoleCan\(role, action\)/, why: "who may be NAMED operator or supervisor on a run (another member's station role)" },
  ],
};

const RULES: { name: string; re: RegExp }[] = [
  { name: "role-only can() subject", re: /company:\s*\{\s*role(\s*:\s*[\w.!?]+)?\s*\}/ },
  { name: "role-only can() subject (ternary)", re: /company:\s*[\w.]*role\s*\?\s*\{\s*role/ },
  { name: "ROLE_ACTIONS read", re: /\bROLE_ACTIONS\b/ },
  { name: "fixedRoleCan outside its listed uses", re: /\bfixedRoleCan\(/ },
  { name: "old roleHoldsGuard", re: /\broleHoldsGuard\(/ },
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("custom roles: no action check from the role alone", () => {
  test("server source", () => {
    const hits: string[] = [];
    for (const dir of DIRS) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const allowed = ALLOWED[rel] ?? [];
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/^\s*(\/\/|\*)/.test(line)) return;
            for (const rule of RULES) {
              if (rule.re.test(line) && !allowed.some((a) => a.pattern.test(line))) hits.push(`${rel}:${i + 1} ${rule.name}: ${line.trim()}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });

  test("the guard catches the old pattern", () => {
    const sample = 'if (!can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.price")) x();';
    expect(RULES.some((r) => r.re.test(sample))).toBe(true);
    expect(RULES.some((r) => r.re.test("const me = { company: { role }, isPlatformAdmin: false };"))).toBe(true);
  });
});
