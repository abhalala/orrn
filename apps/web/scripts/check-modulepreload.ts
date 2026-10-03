/**
 * Build guard (W3): the entry HTML must never modulepreload the export
 * libraries (@react-pdf, xlsx) or any single chunk over 700 kB. Those load via
 * `await import()` on click only (see src/shared/lib/exports.ts).
 *
 * Run after `vite build`: `bun scripts/check-modulepreload.ts`.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const html = readFileSync(join(dist, "index.html"), "utf8");
const hrefs = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);

const FORBIDDEN_NAME = /pdf|xlsx|packing-list|react-pdf/i;
const MAX_BYTES = 700_000;

const problems: string[] = [];
for (const href of hrefs) {
  const size = statSync(join(dist, href)).size;
  if (FORBIDDEN_NAME.test(href)) problems.push(`${href} is an export library chunk`);
  if (size > MAX_BYTES) problems.push(`${href} is ${(size / 1000).toFixed(0)} kB (limit ${MAX_BYTES / 1000} kB)`);
}

if (problems.length > 0) {
  console.error(`modulepreload check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`modulepreload check passed (${hrefs.length} preloaded chunks, none heavy).`);
