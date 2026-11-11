/**
 * The scan behind `date-format-guard.test.ts` (units layer, slice b part 3): which web source files write a date or a time
 * with the browser's own formatter instead of the plant's `Fmt` (`useFmt()`: `date`, `time`, `day`, `longDate`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const SRC = join(import.meta.dir, "..", "src");

/** What a source file must not contain: the browser's own date and time formatters, and the helpers this layer replaced. */
export const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "toLocaleDateString", re: /\btoLocaleDateString\b/ },
  { name: "toLocaleTimeString", re: /\btoLocaleTimeString\b/ },
  { name: "Intl.DateTimeFormat", re: /\bIntl\.DateTimeFormat\b/ },
  // Date-formatting helpers this layer removed: a screen that calls one has not been switched.
  { name: "old date helper", re: /\b(dayMonth|ymdLabel|intlTag|instantDateText|formatWhen)\s*\(/ },
  // The paper's date helpers: only the packing list views and their own module may use them.
  { name: "paper date helper", re: /\b(formatShipDate|formatYmdDay)\s*\(/ },
  // A number grouped with a fixed locale: a plant on international grouping would still see Indian (or US) grouping.
  { name: "toLocaleString with a fixed locale", re: /\btoLocaleString\(\s*["'`][^"'`]+["'`]/ },
];

/** Paths (relative to `src`) the guard does not look at, each with the reason. */
export const ALLOWED: { path: RegExp; label: string; why: string; optional?: boolean }[] = [
  {
    path: /^shared\/lib\/plant-calendar\.ts$/,
    label: "shared/lib/plant-calendar.ts",
    why: "the plant's calendar day, wall clock and zone offset as numbers, for the production day, day filters and datetime-local boxes; nothing it returns is shown, and a display setting must never move it",
  },
  {
    path: /^features\/admin\//,
    label: "features/admin/",
    why: "platform staff screens: staff are not a plant, so no plant setting applies (decided in part 2)",
  },
  {
    path: /^routes\/_platform\//,
    label: "routes/_platform/",
    why: "platform staff screens, as above",
  },
  {
    path: /^features\/auth\/timezones\.ts$/,
    label: "features/auth/timezones.ts",
    why: "builds the time zone picker's labels (GMT+5:30) and reads the device zone; it shows no date",
  },
  {
    path: /ingest/i,
    label: "anything named ingest",
    why: "off limits for this work (the lead's rule); no web file carries the name today, the entry keeps it that way",
    optional: true,
  },
  {
    path: /^features\/dispatch\/packing-list-[^/]*\.tsx$/,
    label: "features/dispatch/packing-list-*.tsx",
    why: "the packing list views mirror the printed paper and keep today's date style through the paper helpers (lead's decision)",
  },
];

/**
 * Files that may group a number with a fixed locale, for this one rule only (the date rules still apply to them).
 * Counts, pieces, bundles and every other whole number on a web screen go through `countText(fmt, n)`.
 */
export const FIXED_LOCALE_NUMBER_OK: { path: RegExp; label: string; why: string }[] = [
  {
    path: /^features\/imports\//,
    label: "features/imports/",
    why: "the spreadsheet import is a staff and file screen: its row counts and file limits are not plant screens",
  },
  {
    path: /^features\/printing\//,
    label: "features/printing/",
    why: "label and print queue counts: prints, labels and the print queue stay on today's units for now",
  },
  {
    path: /^features\/settings\/backup-tab\.tsx$/,
    label: "features/settings/backup-tab.tsx",
    why: "a backup file size in megabytes: a file figure, not a plant quantity",
  },
  {
    path: /^features\/today\/today-model\.ts$/,
    label: "features/today/today-model.ts",
    why: "formatRupees writes a rupee amount (money, not a count); rates and money are outside the units layer and keep Indian grouping",
  },
];

export const FIXED_LOCALE_FINDING = "toLocaleString with a fixed locale";

/** Files whose only job is the paper's date text: the paper helpers may be defined and used here. */
export const PAPER_HELPER_HOMES = /^features\/dispatch\/(format|packing-list-[^/]*)\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Source text without comments and string literals' contents left alone, so a comment that names a formatter is not a use of it. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The forbidden things found in a text (comments ignored). */
export function findings(text: string): string[] {
  const code = stripComments(text);
  return FORBIDDEN.filter((f) => f.re.test(code)).map((f) => f.name);
}

export function webSourceFiles(): { rel: string; text: string }[] {
  return walk(SRC).map((p) => ({ rel: relative(SRC, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));
}

export function allowedBy(rel: string): (typeof ALLOWED)[number] | undefined {
  return ALLOWED.find((a) => a.path.test(rel));
}
