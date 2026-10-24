/**
 * Route JS budget, measured from build output (`dist/`).
 *
 * The JavaScript a first visit to a route downloads is: the entry scripts and
 * modulepreloads in `index.html`, plus the route's own chunk(s), plus every
 * chunk those statically import. Dynamic `import()` targets are lazy and not
 * counted. The route chunk is found by a marker string its code carries (for
 * the marketing page, the `data-orrn-marketing` attribute on its root), so
 * the check doesn't depend on hashed file names. Fonts and CSS are not JS and
 * are not counted. Sizes are gzip (zlib default level), like a CDN serves.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { gzipSync } from "node:zlib";

export type ChunkSize = { file: string; bytes: number; gzip: number };
export type RouteBudget = {
  /** Every counted chunk, dist-relative, biggest gzip first. */
  files: ChunkSize[];
  /** The chunks that carried the marker. Empty means the marker wasn't found. */
  routeChunks: string[];
  /** Sum of `files[].gzip`, in bytes. */
  gzip: number;
};

/** Static import and re-export specifiers in a built ES module. `import("…")` is excluded. */
export function staticImports(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)) out.add(m[1]!);
  return [...out];
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** dist-relative paths of the module entry scripts and modulepreloads in the HTML. */
export function htmlRoots(html: string): string[] {
  const roots: string[] = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(tag, "src");
    if (attr(tag, "type") === "module" && src) roots.push(src.replace(/^\//, ""));
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = attr(tag, "href");
    const rel = (attr(tag, "rel") ?? "").split(/\s+/);
    if (rel.includes("modulepreload") && href) roots.push(href.replace(/^\//, ""));
  }
  return roots;
}

function isLocal(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
}

function resolveFrom(file: string, spec: string): string {
  return spec.startsWith("/") ? spec.slice(1) : posix.normalize(posix.join(posix.dirname(file), spec));
}

/** dist-relative paths of the `assets/*.js` chunks whose code contains `marker`. */
export function chunksWithMarker(dist: string, marker: string): string[] {
  const dir = join(dist, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => `assets/${name}`)
    .filter((file) => readFileSync(join(dist, file), "utf8").includes(marker))
    .sort();
}

/** Static-import closure of `roots` (dist-relative), skipping files that don't exist. */
export function staticClosure(dist: string, roots: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(join(dist, file))) continue;
    seen.add(file);
    const code = readFileSync(join(dist, file), "utf8");
    for (const spec of staticImports(code)) {
      if (isLocal(spec) && spec.endsWith(".js")) queue.push(resolveFrom(file, spec));
    }
  }
  return [...seen];
}

/**
 * What a first visit to the route marked by `marker` downloads in JS. Route
 * layout chunks without the marker (for `/`, the 238 B `/_public` layout) are
 * not counted; they are a few hundred bytes.
 */
export function measureRoute(dist: string, marker: string): RouteBudget {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const routeChunks = chunksWithMarker(dist, marker);
  const files = staticClosure(dist, [...htmlRoots(html), ...routeChunks])
    .map((file) => {
      const buf = readFileSync(join(dist, file));
      return { file, bytes: buf.length, gzip: gzipSync(buf).length };
    })
    .sort((a, b) => b.gzip - a.gzip);
  return { files, routeChunks, gzip: files.reduce((sum, f) => sum + f.gzip, 0) };
}

/** Marker on the marketing page root (`src/routes/_public/index.tsx`). */
export const MARKETING_MARKER = "data-orrn-marketing";
/** `/` JS budget from the C2 plan, Task 18: under 250 kB gzip, fonts excluded. */
export const MARKETING_BUDGET_GZIP = 250_000;

type StringTree = { readonly [key: string]: string | StringTree };

function leaves(tree: StringTree): string[] {
  return Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : leaves(v)));
}

/**
 * A few strings that prove a dictionary is in a chunk: the longest value of
 * each top-level namespace, among those at least 24 characters long, free of
 * characters a bundler might escape (backtick, backslash, quotes, `${`), and
 * not in `allowed` (the strings the entry carries on purpose). Any one of
 * them in the `/` closure means the whole dictionary was imported statically.
 */
export function dictionarySignatures(tree: StringTree, allowed: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const ns of Object.values(tree)) {
    const candidates = (typeof ns === "string" ? [ns] : leaves(ns))
      .filter((s) => s.length >= 24 && !/[`\\"'$]/.test(s) && !allowed.has(s))
      .sort((a, b) => b.length - a.length);
    if (candidates[0]) out.push(candidates[0]);
  }
  return out;
}

/** The `[file, signature]` pairs where a counted chunk carries one of `signatures`. */
export function filesWithSignatures(dist: string, files: readonly string[], signatures: readonly string[]): [string, string][] {
  const hits: [string, string][] = [];
  for (const file of files) {
    const code = readFileSync(join(dist, file), "utf8");
    const hit = signatures.find((s) => code.includes(s));
    if (hit) hits.push([file, hit]);
  }
  return hits;
}
