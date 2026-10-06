/**
 * Build guard: the JS a first visit to `/` (the marketing page) downloads
 * stays under 250 kB gzip, fonts excluded (C2 plan, Task 18). Measured from
 * `dist/` by `route-budget.ts`: entry + modulepreloads + the marketing route
 * chunk and their static imports.
 *
 * Most of that is the app entry every page shares, so a failure here is
 * usually not the marketing page: check the breakdown. Known traps:
 * `import z from "zod"` (default import) pulls every zod locale into the
 * entry (about 45 kB gzip); use `import { z } from "zod"`.
 *
 * Run after `vite build`: `bun scripts/check-route-budget.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MARKETING_BUDGET_GZIP, MARKETING_MARKER, measureRoute } from "./route-budget";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const result = measureRoute(dist, MARKETING_MARKER);
const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`;

const problems: string[] = [];
if (result.routeChunks.length === 0) {
  problems.push(`no chunk carries "${MARKETING_MARKER}": the marketing page root lost its marker, so / can't be measured`);
}
if (result.gzip > MARKETING_BUDGET_GZIP) {
  problems.push(`/ downloads ${kb(result.gzip)} of JS gzip (budget ${kb(MARKETING_BUDGET_GZIP)})`);
}
// Signature strings from zod's Polish and German locales.
const zodLocales = result.files.filter((f) => /Nieprawidłow|Ungültige Eingabe/.test(readFileSync(join(dist, f.file), "utf8")));
for (const f of zodLocales) {
  problems.push(`${f.file} carries every zod locale: replace \`import z from "zod"\` with \`import { z } from "zod"\``);
}

const table = result.files.map((f) => `  ${kb(f.gzip).padStart(9)}  ${f.file}`).join("\n");
if (problems.length > 0) {
  console.error(`check-route-budget: FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}\n${table}`);
  process.exit(1);
}
console.log(`check-route-budget: / JS ${kb(result.gzip)} gzip of ${kb(MARKETING_BUDGET_GZIP)} (${result.files.length} chunks)`);
