/**
 * Turns `test-results/a11y-app/results.jsonl` (written by `tests/e2e/a11y-app.spec.ts`) into the grouped baseline:
 * a JSON file and a markdown summary, grouped by source folder (`shell`, `shared/components`, `features/<name>`)
 * with rule id, impact, count, an example selector and the file the violation traces to.
 *
 *   bun scripts/axe-app-report.ts <out-basename> [notes.md appended to the markdown]
 *   bun scripts/axe-app-report.ts /abs/path/axe-app-baseline        -> axe-app-baseline.json + axe-app-baseline.md
 *
 * Tracing is a heuristic (ancestor `data-slot`, the region a node sits in, and the route file's feature import).
 * "Count" is distinct (page, selector) pairs, so one bad component that renders on 20 pages counts 20 and shows up
 * as one row with its page list.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const webRoot = resolve(import.meta.dirname, "..");
const input = join(webRoot, "test-results/a11y-app/results.jsonl");
const outBase = process.argv[2];
const notesFile = process.argv[3];
if (!outBase) {
  console.error("usage: bun scripts/axe-app-report.ts <out-basename>");
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`missing ${input}; run tests/e2e/a11y-app.spec.ts first`);
  process.exit(2);
}

type Node = { target: string; html: string; summary: string; region: string; slots: string[]; tag: string; classes: string };
type Violation = { id: string; impact: string; help: string; helpUrl: string; nodeCount: number; nodes: Node[] };
type Row = {
  target: string;
  role: string;
  requested: string;
  viewport: string;
  width: number;
  locale: string;
  scheme: string;
  overlay: string | null;
  url: string;
  structure?: { mains: number; h1: number; headingSkips: string[]; unnamedNav: number; unnamedTables: number; tablesNoHeaders: number; imgsNoAlt: number; htmlLang: string; textLen: number } | null;
  violations: Violation[];
};

const rows: Row[] = readFileSync(input, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// ---- route file -> url pattern -> feature folder -------------------------------------------------------------
type RouteInfo = { re: RegExp; score: number; file: string; feature: string | null; page: string | null };
const routesDir = join(webRoot, "src/routes");
const routes: RouteInfo[] = [];
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}
for (const abs of walk(routesDir)) {
  const rel = abs.slice(routesDir.length + 1).replace(/\.tsx$/, "");
  const parts = rel.split("/").flatMap((p) => p.split("."));
  const segs = parts.filter((p) => !/^(_tenant|_platform|_portal|_public|_authed)$/.test(p) && p !== "index").map((p) => p.replace(/_$/, "")).filter((p) => !(p.startsWith("_") && p.length > 1 && !p.startsWith("$")));
  const src = readFileSync(abs, "utf8");
  const imp = /from "@\/features\/([a-z-]+)\/([^"]+)"/.exec(src) ?? /from "@\/features\/([a-z-]+)"/.exec(src);
  const feature = imp ? imp[1]! : null;
  const page = imp ? `src/features/${imp[1]}${imp[2] ? `/${imp[2]}` : ""}` : null;
  const pattern = `^/${segs.map((s) => (s.startsWith("$") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}/?$`;
  routes.push({
    re: new RegExp(pattern === "^//?$" ? "^/$" : pattern),
    score: segs.filter((s) => !s.startsWith("$")).length * 10 - segs.filter((s) => s.startsWith("$")).length,
    file: `src/routes/${rel}.tsx`,
    feature,
    page,
  });
}
function routeFor(pathname: string): RouteInfo | null {
  const hits = routes.filter((r) => r.re.test(pathname)).sort((a, b) => b.score - a.score);
  return hits[0] ?? null;
}

// ---- classification ------------------------------------------------------------------------------------------
const SHARED_SLOTS = new Set([
  "button", "status-block", "skeleton", "dialog-content", "dialog-overlay", "sheet", "sheet-overlay", "sheet-close", "select-trigger",
  "segmented-control", "stepper", "scan-field", "textarea", "truncate", "responsive-list", "data-tab",
]);
const SHELL_FILE: Record<string, string> = {
  "tab-bar": "apps/web/src/shell/tab-bar.tsx",
  "tab-more": "apps/web/src/shell/tab-bar.tsx",
  "side-nav": "apps/web/src/shell/side-nav.tsx",
  "app-shell": "apps/web/src/shell/app-shell.tsx",
  "command-dialog": "apps/web/src/shell/command-palette.tsx",
};
const SHARED_FILE: Record<string, string> = {
  button: "packages/ui/src/components/button.tsx",
  "status-block": "packages/ui/src/components/status-block.tsx",
  skeleton: "packages/ui/src/components/skeleton.tsx",
  "dialog-content": "packages/ui/src/components/dialog.tsx",
  "dialog-overlay": "packages/ui/src/components/dialog.tsx",
  sheet: "packages/ui/src/components/sheet.tsx",
  "sheet-overlay": "packages/ui/src/components/sheet.tsx",
  "sheet-close": "packages/ui/src/components/sheet.tsx",
  "select-trigger": "packages/ui/src/components/select.tsx",
  "segmented-control": "packages/ui/src/components/segmented-control.tsx",
  stepper: "packages/ui/src/components/stepper.tsx",
  "scan-field": "packages/ui/src/components/scan-field.tsx",
  textarea: "packages/ui/src/components/input.tsx",
  truncate: "packages/ui/src/components/truncate.tsx",
  "responsive-list": "packages/ui/src/components/responsive-list.tsx",
  "data-tab": "packages/ui/src/components/data-table.tsx",
};

function classify(row: Row, n: Node): { folder: string; file: string } {
  const route = routeFor(new URL(row.url, "http://x").pathname);
  const featureFolder = route?.feature ? `features/${route.feature}` : route ? `routes (${route.file.replace("src/routes/", "")})` : "unmapped";
  const featureFile = route?.page ? `apps/web/${route.page} (via ${route.file})` : route ? `apps/web/${route.file}` : "unknown";

  // aria-hidden on the whole app frame while a Radix menu or dialog is open.
  if (/^<div[^>]*data-slot="app-shell"/.test(n.html)) {
    return { folder: "shell", file: row.overlay === "palette" ? "apps/web/src/shell/command-palette.tsx" : row.overlay ? "apps/web/src/shell/more-menu.tsx" : "apps/web/src/shell/app-shell.tsx" };
  }
  if (n.region === "toast") return { folder: "shared/components", file: "packages/ui/src/components/sonner.tsx" };
  if (n.region === "shell" || n.slots.some((s) => s === "side-nav" || s === "tab-bar" || s === "tab-more")) {
    const slot = n.slots.find((s) => SHELL_FILE[s]);
    return { folder: "shell", file: slot ? SHELL_FILE[slot]! : "apps/web/src/shell (header or skip link)" };
  }
  if (n.region === "overlay") {
    if (row.overlay) {
      const file = row.overlay === "palette" ? "apps/web/src/shell/command-palette.tsx" : "apps/web/src/shell/more-menu.tsx";
      return { folder: "shell", file };
    }
    const slot = n.slots.find((s) => SHARED_FILE[s]);
    if (slot) return { folder: "shared/components", file: SHARED_FILE[slot]! };
    return { folder: featureFolder, file: featureFile };
  }
  if (n.slots.includes("page-header")) return { folder: "shared/components", file: "packages/ui/src/components/page-header.tsx" };
  // Shared only when the element itself is a shared component and no feature component sits between it and the
  // shell (a feature that restyles a shared Button owns the problem). The nearest slot being shared is not enough:
  // a link in a feature's cell is inside `responsive-list` but is the feature's link.
  const own = /^<[^>]*?\sdata-slot="([^"]+)"/.exec(n.html)?.[1];
  const featureSlot = n.slots.slice(own ? 1 : 0).some((s) => s !== "app-shell" && !SHARED_SLOTS.has(s));
  if (own && SHARED_SLOTS.has(own) && !featureSlot) return { folder: "shared/components", file: SHARED_FILE[own]! };
  if (route && /^src\/routes\/_(tenant|platform|portal|authed)\.tsx$/.test(route.file)) return { folder: "shell", file: `apps/web/${route.file}` };
  return { folder: featureFolder, file: featureFile };
}

// ---- aggregate -----------------------------------------------------------------------------------------------
type Agg = {
  folder: string;
  rule: string;
  impact: string;
  help: string;
  file: string;
  pairs: Set<string>;
  pages: Set<string>;
  contexts: Set<string>;
  example: { selector: string; html: string; summary: string; page: string; context: string };
};
const aggs = new Map<string, Agg>();
const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"];
for (const row of rows) {
  const page = new URL(row.url, "http://x").pathname;
  for (const v of row.violations) {
    for (const n of v.nodes) {
      const { folder, file } = classify(row, n);
      const key = `${folder}|${v.id}|${file}`;
      let a = aggs.get(key);
      if (!a) {
        a = {
          folder, rule: v.id, impact: v.impact, help: v.help, file, pairs: new Set(), pages: new Set(), contexts: new Set(),
          example: { selector: n.target, html: n.html, summary: n.summary, page, context: `${row.viewport} ${row.locale} ${row.scheme}${row.overlay ? ` +${row.overlay}` : ""}` },
        };
        aggs.set(key, a);
      }
      a.pairs.add(`${page}|${n.target}`);
      a.pages.add(page);
      a.contexts.add(`${row.viewport}/${row.locale}/${row.scheme}`);
    }
  }
}

const list = [...aggs.values()].sort(
  (a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) || b.pairs.size - a.pairs.size || a.rule.localeCompare(b.rule),
);
const folders = [...new Set(list.map((a) => a.folder))].sort((a, b) => folderRank(a) - folderRank(b) || a.localeCompare(b));
function folderRank(f: string) {
  return f === "shell" ? 0 : f === "shared/components" ? 1 : f.startsWith("features/") ? 2 : 3;
}


// ---- structure checks (not axe) ------------------------------------------------------------------------------
type StructureRow = { folder: string; page: string; context: string; problems: string[] };
const structureRows: StructureRow[] = [];
for (const row of rows) {
  const st = row.structure;
  if (!st) continue;
  const pathname = new URL(row.url, "http://x").pathname;
  const problems: string[] = [];
  if (st.mains !== 1) problems.push(`${st.mains} main landmarks`);
  if (st.h1 !== 1) problems.push(`${st.h1} h1`);
  if (st.headingSkips.length) problems.push(`heading skip ${[...new Set(st.headingSkips)].join(", ")}`);
  if (st.unnamedNav) problems.push(`${st.unnamedNav} unnamed nav`);
  if (st.unnamedTables) problems.push(`${st.unnamedTables} table(s) without a name`);
  if (st.tablesNoHeaders) problems.push(`${st.tablesNoHeaders} table(s) without th`);
  if (st.imgsNoAlt) problems.push(`${st.imgsNoAlt} img without alt`);
  if (st.htmlLang !== row.locale) problems.push(`html lang "${st.htmlLang}" but ${row.locale}`);
  if (st.textLen < 20) problems.push(`main has ${st.textLen} characters of text (empty or still loading?)`);
  if (!problems.length) continue;
  const route = routeFor(pathname);
  const folder = route?.feature ? `features/${route.feature}` : route?.file.includes("_platform") || route?.file.includes("_portal") ? "shell (layout route)" : "shell";
  structureRows.push({ folder, page: pathname, context: `${row.viewport} ${row.locale}${row.overlay ? ` +${row.overlay}` : ""}`, problems });
}

const contexts = new Set(rows.map((r) => `${r.viewport}/${r.locale}/${r.scheme}`));
const pagesSeen = new Set(rows.map((r) => `${r.role}:${r.url}`));
const totals: Record<string, number> = {};
for (const a of list) totals[a.impact] = (totals[a.impact] ?? 0) + a.pairs.size;

const json = {
  generated: new Date().toISOString(),
  runs: rows.length,
  pages: pagesSeen.size,
  contexts: [...contexts].sort(),
  totalsByImpact: totals,
  structureProblems: structureRows,
  folders: Object.fromEntries(
    folders.map((f) => [
      f,
      list
        .filter((a) => a.folder === f)
        .map((a) => ({
          rule: a.rule,
          impact: a.impact,
          help: a.help,
          count: a.pairs.size,
          pages: [...a.pages].sort(),
          contexts: [...a.contexts].sort(),
          exampleSelector: a.example.selector,
          exampleHtml: a.example.html,
          exampleSummary: a.example.summary,
          examplePage: a.example.page,
          exampleContext: a.example.context,
          file: a.file,
        })),
    ]),
  ),
};
writeFileSync(`${outBase}.json`, `${JSON.stringify(json, null, 2)}\n`);

const md: string[] = [];
md.push("# Signed-in axe sweep", "");
md.push(`Source: \`apps/web/tests/e2e/a11y-app.spec.ts\` (axe tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa). Generated ${json.generated}.`, "");
md.push(`${rows.length} page runs, ${pagesSeen.size} distinct page URLs, contexts: ${[...contexts].sort().join(", ")}.`, "");
md.push(
  `Violations by impact (distinct page + selector pairs): ${IMPACT_ORDER.map((i) => `${i} ${totals[i] ?? 0}`).join(", ")}.`,
  "",
  "Count is distinct (page, selector) pairs. The \"file\" column is a heuristic trace (ancestor `data-slot`, region of the page, the route file's feature import); the owner lane confirms it.",
  "",
);
for (const f of folders) {
  const items = list.filter((a) => a.folder === f);
  const n = items.reduce((s, a) => s + a.pairs.size, 0);
  md.push(`## ${f}`, "", `${items.length} rule rows, ${n} page and selector pairs.`, "");
  md.push("| Rule | Impact | Count | Pages | Example selector | File |", "|---|---|---:|---:|---|---|");
  for (const a of items) {
    const sel = a.example.selector.replace(/\|/g, "\\|").slice(0, 110);
    md.push(`| ${a.rule} | ${a.impact} | ${a.pairs.size} | ${a.pages.size} | \`${sel}\` on ${a.example.page} | ${a.file.replace(/\|/g, "\\|")} |`);
  }
  md.push("");
}
if (list.length === 0) md.push("No violations.", "");
if (structureRows.length) {
  md.push("## Structure checks (not axe)", "", "One main, one h1, heading order, named navs and tables, img alt, `<html lang>`, empty pages. Light theme, one row per page and context.", "");
  const byFolder = new Map<string, StructureRow[]>();
  for (const r of structureRows) byFolder.set(r.folder, [...(byFolder.get(r.folder) ?? []), r]);
  for (const f of [...byFolder.keys()].sort((a, b) => folderRank(a) - folderRank(b) || a.localeCompare(b))) {
    md.push(`### ${f}`, "", "| Page | Context | Problems |", "|---|---|---|");
    for (const r of byFolder.get(f)!) md.push(`| ${r.page} | ${r.context} | ${r.problems.join("; ")} |`);
    md.push("");
  }
} else if (rows.some((r) => r.structure)) {
  md.push("## Structure checks (not axe)", "", "No problems found.", "");
}
if (notesFile) md.push(readFileSync(notesFile, "utf8").trimEnd(), "");
writeFileSync(`${outBase}.md`, `${md.join("\n")}\n`);
console.log(`wrote ${outBase}.json and ${outBase}.md: ${list.length} rows, ${JSON.stringify(totals)}`);
