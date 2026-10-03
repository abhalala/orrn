/**
 * Writes docs/superpowers/review/hindi-review.md: every Hindi string next to its
 * English source, grouped by namespace, then every guide. Run after changing
 * en.ts, hi.ts or the guides:  bun run --cwd packages/i18n export-review
 * src/review-sync.test.ts fails when the file is out of date.
 */
import { en } from "../src/en";
import { hi } from "../src/hi";
import { guidesEn } from "../src/guides/en";
import { guidesHi } from "../src/guides/hi";
import { GUIDE_SLUGS, type Guide } from "../src/guides/types";

export const REVIEW_PATH = new URL("../../../docs/superpowers/review/hindi-review.md", import.meta.url);

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : flatten(value, path);
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

/**
 * Strings we deliberately left as the English value for now, with the
 * question for Lalubhai. Shown as "(check)" in the table and listed under it.
 */
const FLAGGED: Record<string, string> = {
  "charts.unitThousand": "Chart axis short form for thousand. Kept as k for now. Should it be हज़ार or something shorter?",
  "charts.unitLakh": "Chart axis short form for lakh (1.5L). Kept as L for now. Should it be लाख?",
  "charts.unitCrore": "Chart axis short form for crore (1.2Cr). Kept as Cr for now. Should it be करोड़?",
};

function guideRows(g: Guide): [string, string][] {
  return [
    ["Title", g.title],
    ["When", g.when],
    ...g.steps.flatMap((s, i): [string, string][] => [
      [`Step ${i + 1}`, s.title],
      [`Step ${i + 1} text`, s.body],
    ]),
    ...g.problems.flatMap((p, i): [string, string][] => [
      [`Problem ${i + 1}`, p.title],
      [`Fix ${i + 1}`, p.fix],
    ]),
  ];
}

export function buildHindiReview(): string {
  const enFlat = new Map(flatten(en as Tree));
  const hiFlat = new Map(flatten(hi as Tree));
  const namespaces = Object.keys(en);
  const out: string[] = [];

  const messageCount = enFlat.size;
  const guideCount = GUIDE_SLUGS.reduce((n, s) => n + guideRows(guidesEn[s]).length, 0);

  out.push(
    "# Hindi review",
    "",
    "For Lalubhai. Every Hindi string in orrn, next to the English it comes from.",
    "",
    "This file is generated from `packages/i18n` by `bun run --cwd packages/i18n export-review`. Don't edit it by hand. Send corrections as \"key: new Hindi\" (for example `pack.new.saveBundle: Bundle सेव करो`) and we update `hi.ts` and regenerate.",
    "",
    "What to check:",
    "",
    "1. Would someone on the floor understand it on first read?",
    "2. Is it the word the plant actually uses? (for example ग्राहक or पार्टी, रद्द or कैंसल)",
    "3. Words kept in English on purpose: bundle, die, dispatch, PO, kg, kg/12ft, serial numbers, codes, numbers, orrn. Tell us if any of these should be Hindi, or if more words should stay English.",
    "",
    `Counts: ${messageCount} screen strings in ${namespaces.length} groups, ${GUIDE_SLUGS.length} guides with ${guideCount} strings.`,
    "",
    "## Screen strings",
    "",
  );

  for (const ns of namespaces) {
    const rows = [...enFlat].filter(([k]) => k === ns || k.startsWith(`${ns}.`));
    out.push(`### ${ns} (${rows.length})`, "", "| Key | English | हिंदी |", "|---|---|---|");
    for (const [key, enValue] of rows) {
      const flag = FLAGGED[key] ? " (check)" : "";
      out.push(`| \`${key.slice(ns.length + 1)}\` | ${cell(enValue)} | ${cell(hiFlat.get(key) ?? "MISSING")}${flag} |`);
    }
    out.push("");
    const flagged = rows.filter(([k]) => FLAGGED[k]);
    if (flagged.length > 0) {
      out.push("Please check, Lalubhai:", "");
      for (const [k] of flagged) out.push(`- \`${k.slice(ns.length + 1)}\`: ${FLAGGED[k]}`);
      out.push("");
    }
  }

  out.push("## Guides", "");
  for (const slug of GUIDE_SLUGS) {
    const enRows = guideRows(guidesEn[slug]);
    const hiRows = guideRows(guidesHi[slug]);
    out.push(`### ${guidesEn[slug].title} (\`${slug}\`)`, "", "| Part | English | हिंदी |", "|---|---|---|");
    enRows.forEach(([part, enValue], i) => {
      out.push(`| ${part} | ${cell(enValue)} | ${cell(hiRows[i]?.[1] ?? "MISSING")} |`);
    });
    out.push("");
  }

  return out.join("\n");
}

if (import.meta.main) {
  await Bun.write(REVIEW_PATH, buildHindiReview());
  console.log(`Wrote ${REVIEW_PATH.pathname}`);
}
