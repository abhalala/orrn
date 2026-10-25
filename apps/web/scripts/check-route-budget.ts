/**
 * Build guard: the JS a first visit to `/` (the marketing page) downloads
 * stays under 250 kB gzip, fonts excluded (C2 plan, Task 18). Measured from
 * `dist/` by `route-budget.ts`: entry + modulepreloads + the marketing route
 * chunk and their static imports.
 *
 * Most of that is the app entry every page shares, so a failure here is
 * usually not the marketing page: check the breakdown. Known traps:
 * `import z from "zod"` (default import) pulls every zod locale into the
 * entry (about 45 kB gzip); use `import { z } from "zod"`. A route file whose
 * `validateSearch` imports a helper from a page component module drags that
 * page into the entry (autoCodeSplitting only splits the component): keep
 * search helpers in pure modules.
 *
 * Dictionaries: `/` may carry only the English in @orrn/i18n's
 * en-public.gen.ts. The full English (the app namespaces), Hindi (and later
 * locales) and the guide books are lazy chunks; this fails when any of their
 * strings shows up in the `/` closure (a static import of `@orrn/i18n/en`,
 * `@orrn/i18n/hi`, a locale file or the guides from code on the `/` path).
 *
 * Run after `vite build`: `bun scripts/check-route-budget.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { listGuides } from "@orrn/i18n/guides";
import { en } from "@orrn/i18n/en";
import { enPublic } from "@orrn/i18n/en-public";
import { hi } from "@orrn/i18n/hi";

import {
  dictionarySignatures,
  filesWithSignatures,
  MARKETING_BUDGET_GZIP,
  MARKETING_MARKER,
  measureRoute,
} from "./route-budget";

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

// Lazy dictionaries and guide books must not be in the `/` closure.
const publicStrings = new Set(Object.values(enPublic).flatMap(function all(v: unknown): string[] {
  return typeof v === "string" ? [v] : Object.values(v as object).flatMap(all);
}));
const lazyText: [string, string[]][] = [
  ["the Hindi dictionary (hi.ts)", dictionarySignatures(hi)],
  ["the full English dictionary (en.ts)", dictionarySignatures(en, publicStrings)],
  [
    "the guide books",
    dictionarySignatures(
      Object.fromEntries(
        [...listGuides("en"), ...listGuides("hi")].map((g, i) => [i, Object.fromEntries(g.steps.map((step, j) => [j, step.body]))]),
      ),
    ),
  ],
];
for (const [what, signatures] of lazyText) {
  for (const [file, hit] of filesWithSignatures(dist, result.files.map((f) => f.file), signatures)) {
    problems.push(
      `${file} carries ${what} ("${hit.slice(0, 40)}…"): dictionaries load on demand (loadMessages); ` +
        `never import @orrn/i18n/en, @orrn/i18n/hi, a locale file or @orrn/i18n/guides from code on the / path`,
    );
  }
}

// Module refusal tables (W3-AG-S review I3): each registers from its own module, imported by that
// module's screens (`@orrn/i18n/refusal-ageing`); the `/` closure carries none of them.
const moduleRefusals: [string, RegExp][] = [["the ageing refusal table (@orrn/i18n/refusal-ageing)", /ageing\.refusal\.|already has a batch in it/]];
for (const [what, re] of moduleRefusals) {
  for (const f of result.files) {
    if (re.test(readFileSync(join(dist, f.file), "utf8"))) problems.push(`${f.file} carries ${what}: import it from the ageing screens, never from code on the / path`);
  }
}

const table = result.files.map((f) => `  ${kb(f.gzip).padStart(9)}  ${f.file}`).join("\n");
if (problems.length > 0) {
  console.error(`check-route-budget: FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}\n${table}`);
  process.exit(1);
}
console.log(`check-route-budget: / JS ${kb(result.gzip)} gzip of ${kb(MARKETING_BUDGET_GZIP)} (${result.files.length} chunks)`);
