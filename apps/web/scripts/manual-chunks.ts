/**
 * Rollup `manualChunks` for apps/web (vite.config.ts).
 *
 * Only one named vendor group rides on every page: "tanstack", the router and
 * query family the shell needs anyway. Every other library goes where Rollup
 * puts it, with the screens that use it. No pdf/xlsx/react groups: a
 * name-based "react" rule also matched @react-pdf and dragged the 1.4 MB
 * renderer into every page's modulepreload list (export libs load via dynamic
 * import only). No "radix" or "form" group either: one group per library
 * family put every Radix primitive and TanStack Form in the modulepreload
 * list of every page, `/` included (`/` JS budget, scripts/check-route-budget.ts).
 *
 * Matching is by package name, taken from the module's last `node_modules/`
 * segment, never by a substring of the whole path: a checkout under
 * `/srv/platform/` or a router file named `transformer.js` must not change
 * which chunk a module lands in.
 */

/** Packages of the "tanstack" chunk: router, query, and the store and history they share. */
const TANSTACK_SHELL = new Set([
  "@tanstack/react-router",
  "@tanstack/router-core",
  "@tanstack/history",
  "@tanstack/react-query",
  "@tanstack/query-core",
  "@tanstack/store",
  "@tanstack/react-store",
]);

/** The npm package a module id belongs to ("@scope/name" or "name"); undefined for app code and virtual modules. */
export function packageOf(id: string): string | undefined {
  const path = id.replaceAll("\\", "/");
  const at = path.lastIndexOf("node_modules/");
  if (at < 0) return undefined;
  const [first, second] = path.slice(at + "node_modules/".length).split("/");
  if (!first) return undefined;
  if (!first.startsWith("@")) return first;
  return second ? `${first}/${second}` : undefined;
}

export function manualChunk(id: string): string | undefined {
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  if (TANSTACK_SHELL.has(pkg)) return "tanstack";
  if (pkg === "papaparse") return "csv-parser";
  return undefined;
}
