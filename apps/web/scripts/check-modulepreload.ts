/**
 * Build guard (W3): the entry script and everything the entry HTML
 * modulepreloads must stay free of the export libraries (@react-pdf, xlsx) and
 * under 700 kB per chunk. Those load via `await import()` on click only (see
 * src/shared/lib/exports.ts). A static import of the PDF module from shared
 * code would fold @react-pdf into the entry chunk, so the entry's content is
 * scanned too, not just chunk names.
 *
 * Run after `vite build`: `bun scripts/check-modulepreload.ts`.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const html = readFileSync(join(dist, "index.html"), "utf8");

/** Parses `name="value"`, `name='value'` and bare `name=value` attributes in any order. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function tags(name: "script" | "link"): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => attrs(m[1]!));
}

const entries = tags("script")
  .filter((a) => a.type === "module" && a.src)
  .map((a) => a.src!);
const preloads = tags("link")
  .filter((a) => (a.rel ?? "").split(/\s+/).includes("modulepreload") && a.href)
  .map((a) => a.href!);

const FORBIDDEN_NAME = /pdf|xlsx|packing-list/i;
// Present in the renderer's own strings, absent from app code ("@react-pdf" alone is not enough:
// bundlers strip package specifiers, but the renderer keeps its producer/stylesheet strings).
const FORBIDDEN_CONTENT = /react-pdf/;
const MAX_BYTES = 700_000;

const problems: string[] = [];
if (entries.length === 0) problems.push("no <script type=\"module\" src> entry found in dist/index.html");

for (const [kind, hrefs] of [["entry", entries], ["modulepreload", preloads]] as const) {
  for (const href of hrefs) {
    const file = join(dist, href.replace(/^\//, ""));
    let size: number;
    let content: string;
    try {
      size = statSync(file).size;
      content = readFileSync(file, "utf8");
    } catch {
      problems.push(`${kind} ${href} not found in dist`);
      continue;
    }
    if (FORBIDDEN_NAME.test(href)) problems.push(`${kind} ${href} is an export library chunk`);
    if (size > MAX_BYTES) problems.push(`${kind} ${href} is ${(size / 1000).toFixed(0)} kB (limit ${MAX_BYTES / 1000} kB)`);
    if (FORBIDDEN_CONTENT.test(content)) problems.push(`${kind} ${href} contains @react-pdf code`);
  }
}

if (problems.length > 0) {
  console.error(`modulepreload check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `modulepreload check passed (${entries.length} entry, ${preloads.length} preloaded chunks, none heavy or containing @react-pdf).`,
);
