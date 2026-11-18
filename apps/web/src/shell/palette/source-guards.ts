/**
 * Test helper (palette gating, review B1 to B4): reads what a target page really checks from the source, so the
 * gating test compares the palette's gates with the page and the server instead of with a copy of the answers.
 *
 * - `routeTree(to)`: the route file for a path and the app files it imports (features, shared), a few levels deep.
 * - `procedureActions("press.report")`: the actions the server procedure requires, read from its router file
 *   (`actionProcedure("x")`, `anyActionProcedure("x", "y")`, or a named procedure built from one of those).
 * - `routerModule("press")`: the module the server gates a router's writes on (lib/moduleGate.ts ROUTER_MODULE).
 *
 * Bun test only (node:fs). Not imported by app code.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_SRC = fileURLToPath(new URL("../..", import.meta.url));
const SERVER_SRC = resolve(WEB_SRC, "../../../packages/server/src");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** `/press/report` -> routes/_tenant/press.report.tsx (or `.index.tsx`). */
export function routeFile(to: string): string | null {
  const base = to.replace(/^\//, "").replace(/\//g, ".");
  for (const name of [`${base}.tsx`, `${base}.index.tsx`]) {
    const path = join(WEB_SRC, "routes/_tenant", name);
    if (existsSync(path)) return path;
  }
  return null;
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(WEB_SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/** The route file and the feature files it reaches (imports from `@/features` or relative), `depth` levels deep. */
export function routeTree(to: string, depth = 3): { files: string[]; source: string } {
  const start = routeFile(to);
  if (!start) return { files: [], source: "" };
  const seen = new Set<string>();
  const walk = (file: string, left: number) => {
    if (seen.has(file) || left < 0) return;
    seen.add(file);
    for (const m of read(file).matchAll(/from "((?:@\/features|\.)[^"]*)"/g)) {
      const next = resolveImport(file, m[1]!);
      if (next) walk(next, left - 1);
    }
  };
  walk(start, depth);
  const files = [...seen];
  return { files, source: files.map(read).join("\n") };
}

/** Top-level router key -> router file, from routers/index.ts. */
function routerFiles(): Map<string, { file: string; ident: string }> {
  const index = read(join(SERVER_SRC, "routers/index.ts"));
  const fileOf = new Map<string, string>();
  for (const m of index.matchAll(/import \{([^}]+)\} from "\.\/([^"]+)"/g)) {
    for (const ident of m[1]!.split(",").map((s) => s.trim())) fileOf.set(ident, m[2]!);
  }
  const out = new Map<string, { file: string; ident: string }>();
  for (const m of index.matchAll(/^\s{2}(\w+): (\w+),/gm)) {
    const rel = fileOf.get(m[2]!);
    if (rel) out.set(m[1]!, { file: join(SERVER_SRC, "routers", rel.endsWith(".ts") ? rel : `${rel}.ts`), ident: m[2]! });
  }
  return out;
}

function quoted(list: string): string[] {
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** The body of `const <ident> = router({ ... })` (top-level members only are read from it). */
function routerBody(source: string, ident: string): string | null {
  const start = source.search(new RegExp(`(?:export )?const ${ident} = router\\(\\{`));
  if (start < 0) return null;
  const end = source.indexOf("\n});", start);
  return source.slice(start, end < 0 ? undefined : end);
}

/**
 * Actions a server procedure requires (any one is enough), or null when the procedure is not found or is not gated
 * by an action. Follows nested routers in the same file (`store.items.list`).
 */
export function procedureActions(path: string): string[] | null {
  const [top, ...rest] = path.split(".");
  const entry = routerFiles().get(top!);
  if (!entry || rest.length === 0) return null;
  const source = read(entry.file);
  let ident = entry.ident;
  for (let i = 0; i < rest.length; i++) {
    const body = routerBody(source, ident);
    if (!body) return null;
    const member = new RegExp(`^\\s{2}${rest[i]}: ([\\s\\S]*?)(?:\\n|$)`, "m").exec(body);
    if (!member) return null;
    const value = member[1]!.trim();
    if (i < rest.length - 1) {
      const nested = /^(\w+),?$/.exec(value);
      if (!nested) return null;
      ident = nested[1]!;
      continue;
    }
    return gateOf(source, value);
  }
  return null;
}

function gateOf(source: string, value: string): string[] | null {
  const direct = /^(actionProcedure|anyActionProcedure)\(([^)]*)\)/.exec(value);
  if (direct) return quoted(direct[2]!);
  // A named procedure in the same file: `const purchaseReader = anyActionProcedure(...)`.
  const named = /^(\w+)/.exec(value);
  if (!named) return null;
  const def = new RegExp(`const ${named[1]} = (actionProcedure|anyActionProcedure)\\(([^)]*)\\)`).exec(source);
  if (def) return quoted(def[2]!);
  // ...or one built from a list constant: `anyActionProcedure(...PURCHASE_READERS)`.
  const spread = new RegExp(`const ${named[1]} = anyActionProcedure\\(\\.\\.\\.(\\w+)\\)`).exec(source);
  if (spread) {
    const list = new RegExp(`const ${spread[1]}[^=]*= \\[([^\\]]*)\\]`).exec(source);
    if (list) return quoted(list[1]!);
  }
  return null;
}

/** The module the server gates a router's writes on, or null (lib/moduleGate.ts ROUTER_MODULE). */
export function routerModule(top: string): string | null {
  const source = read(join(SERVER_SRC, "lib/moduleGate.ts"));
  const block = /ROUTER_MODULE[^{]*\{([\s\S]*?)\};/.exec(source)?.[1] ?? "";
  return new RegExp(`^\\s*${top}: "([^"]+)"`, "m").exec(block)?.[1] ?? null;
}

/** Settings tabs and the actions each requires, read from features/settings/sections.tsx. */
export function settingsTabRequires(): Map<string, string[]> {
  const source = read(join(WEB_SRC, "features/settings/sections.tsx"));
  const out = new Map<string, string[]>();
  for (const m of source.matchAll(/\{ id: "([^"]+)",([^\n]*)render:/g)) {
    const requires = /requires: \[([^\]]*)\]/.exec(m[2]!);
    out.set(m[1]!, requires ? quoted(requires[1]!) : []);
  }
  return out;
}

/** Report cards and the module that hides each, read from features/reports/reports-index.tsx. */
export function reportCardModules(): Map<string, string | null> {
  const source = read(join(WEB_SRC, "features/reports/reports-index.tsx"));
  const out = new Map<string, string | null>();
  for (const m of source.matchAll(/\{ module: (null|"([^"]+)"), to: "([^"]+)"/g)) out.set(m[3]!, m[2] ?? null);
  return out;
}
