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
 * Strings we deliberately left as the English value for now, or wrote new and are not sure of, with the
 * question for Lalubhai. Shown as "(check)" in the table and listed under it.
 */
const FLAGGED: Record<string, string> = {
  "charts.unitThousand": "Chart axis short form for thousand. Kept as k for now. Should it be हज़ार or something shorter?",
  "charts.unitLakh": "Chart axis short form for lakh (1.5L). Kept as L for now. Should it be लाख?",
  "charts.unitCrore": "Chart axis short form for crore (1.2Cr). Kept as Cr for now. Should it be करोड़?",
  // Delta round (lane C2): Buddy card words written new, not taken from an existing screen.
  "buddy.field.balanceNote": "Buddy card label (Balance note): बैलेंस नोट. Is that the word the plant uses?",
  "buddy.field.discardG": "Buddy card label (Discard (g)): डिस्कार्ड (g). Is that the word the plant uses?",
  "buddy.field.drossBp": "Buddy card label for a raw stored number (Dross (hundredths of %)): ड्रॉस (% के सौवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.endsG": "Buddy card label (Ends (g)): एंड्स (g). Is that the word the plant uses?",
  "buddy.field.expectSeq": "Buddy card label (Version expected): अपेक्षित वर्ज़न. Is that the word the plant uses?",
  "buddy.field.expectedRecoveryBp": "Buddy card label for a raw stored number (Expected recovery (hundredths of %)): अनुमानित रिकवरी (% के सौवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.expectedServerSeq": "Buddy card label (Version expected): अपेक्षित वर्ज़न. Is that the word the plant uses?",
  "buddy.field.gasEndMilli": "Buddy card label for a raw stored number (Gas meter at end (thousandths)): आखिर में गैस मीटर (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.gasStartMilli": "Buddy card label for a raw stored number (Gas meter at start (thousandths)): शुरू में गैस मीटर (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.hardnessMaxX10": "Buddy card label for a raw stored number (Highest hardness (tenths)): सबसे ज़्यादा हार्डनेस (दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.hardnessMinX10": "Buddy card label for a raw stored number (Lowest hardness (tenths)): सबसे कम हार्डनेस (दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.kgPer12ftMilli": "Buddy card label for a raw stored number (kg/12ft (thousandths)): kg/12ft (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.kgToleranceBp": "Buddy card label for a raw stored number (Weight tolerance (hundredths of %)): वज़न की छूट (% के सौवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.ldoTenthIn": "Buddy card label for a raw stored number (LDO (tenths of an inch)): LDO (इंच के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.lift": "Buddy card label (Lift to another band): दूसरे बैंड में लिफ्ट. Is that the word the plant uses?",
  "buddy.field.maxTempX10": "Buddy card label for a raw stored number (Highest temperature (tenths of °C)): सबसे ज़्यादा तापमान (°C के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.qtyInMilli": "Buddy card label for a raw stored number (Quantity in (thousandths)): आई मात्रा (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.qtyMilli": "Buddy card label for a raw stored number (Quantity (thousandths)): मात्रा (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.qtyOutMilli": "Buddy card label for a raw stored number (Quantity out (thousandths)): गई मात्रा (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.readingsX10": "Buddy card label for a raw stored number (Readings (tenths)): रीडिंग (दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.refId": "Buddy card label (Reference): संदर्भ. Is that the word the plant uses?",
  "buddy.field.returns": "Buddy card label (Returns): वापसी. Is that the word the plant uses?",
  "buddy.field.serverSeq": "Buddy card label (Version expected): अपेक्षित वर्ज़न. Is that the word the plant uses?",
  "buddy.field.streamId": "Buddy card label (Return stream): वापसी का माल. Is that the word the plant uses?",
  "buddy.field.tappedAt": "Buddy card label (Tapped at): टैप करने का समय. Is that the word the plant uses?",
  "buddy.field.targetTempX10": "Buddy card label for a raw stored number (Target temperature (tenths of °C)): लक्ष्य तापमान (°C के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.tempCX10": "Buddy card label for a raw stored number (Temperature (tenths of °C)): तापमान (°C के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.to": "Buddy card label (To): किसमें. Is that the word the plant uses?",
  "buddy.field.toleranceX10": "Buddy card label for a raw stored number (Tolerance (tenths of °C)): छूट (°C के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.tonnageT": "Buddy card label (Tonnage (t)): टन क्षमता (t). Is that the word the plant uses?",
  "buddy.field.trialKgPer12ftMilli": "Buddy card label for a raw stored number (Trial kg/12ft (thousandths)): ट्रायल kg/12ft (हज़ारवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.valueX10": "Buddy card label for a raw stored number (Value (tenths)): मान (दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.values": "Buddy card label (Values): मान. Is that the word the plant uses?",
  "buddy.field.valuesPpm": "Buddy card label (Values (ppm)): मान (ppm). Is that the word the plant uses?",
  "buddy.field.wallTenthMm": "Buddy card label for a raw stored number (Wall (tenths of mm)): दीवार (mm के दसवें भाग में). Is that clear, or does the plant say it another way?",
  "buddy.field.windowEnd": "Buddy card label (Window end): समय सीमा का अंत. Is that the word the plant uses?",
  "buddy.field.windowStart": "Buddy card label (Window start): समय सीमा की शुरुआत. Is that the word the plant uses?",
  "buddy.draft.blocked.bidi": "Buddy: Confirm is off because a value holds hidden text-direction marks. Is छिपे निशान जो लिखावट का क्रम बदल देते हैं clear?",
  "buddy.draft.marked": "Buddy: the warning under a value with hidden text-direction marks. Is it clear?",
  "buddy.draft.drive.states.held": "Buddy: a sheet on hold after the row check (रोकी गई). Is that the word the import screens should use too?",
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
