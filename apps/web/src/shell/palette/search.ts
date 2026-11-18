/**
 * Command palette matching (owner decision 2026-11-18): fuzzy find over everything matched in the browser
 * (pages, page sections, commands, recents). Remote groups keep server-side search and never pass through here.
 *
 * Every candidate string is folded (lower case, Latin accents stripped, punctuation to spaces), then matched in
 * tiers: exact > prefix > word-prefix > substring > subsequence > typo. Within a tier the label beats the English
 * label, which beats an alias, which beats a term. Ties break on the shorter label, then group order, then input
 * order. Folded forms are cached per item object, so a keystroke over a few hundred items allocates little.
 */

export type SearchGroup = "recent" | "commands" | "pages" | "sections";

export type Searchable = {
  id: string;
  group: SearchGroup;
  /** Label in the person's UI language. */
  label: string;
  /** English label, matched too when the UI is Hindi or Gujarati. */
  labelEn?: string;
  /** Keyword alternatives: plant words, Hindi and Gujarati words, abbreviations. */
  aliases?: readonly string[];
  /** Main words used inside the page or section. */
  terms?: readonly string[];
};

export type Match = {
  /** Higher is better. */
  score: number;
  /** The alias or term that matched, when the match was not the label itself. */
  matched?: string;
};

export type Ranked<T extends Searchable> = T & { match: Match };

/** Tie-break order when scores and label lengths are equal. */
export const GROUP_ORDER: Readonly<Record<SearchGroup, number>> = { recent: 0, commands: 1, pages: 2, sections: 3 };

/** Tier bases. Gaps (100, 50) are wider than any bonus, so a better tier always wins. */
export const TIER = {
  exact: 600,
  prefix: 500,
  wordPrefix: 400,
  substring: 300,
  subsequence: 200,
  typo: 100,
} as const;

const Kind = { Label: 0, LabelEn: 1, Alias: 2, Term: 3 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** Small bonus inside a tier: the label is the best evidence, a term the weakest. */
const KIND_BONUS = [30, 25, 20, 10] as const;

type Field = {
  kind: Kind;
  /** Original text, reported as `matched` for aliases and terms. */
  raw: string;
  /** Folded, single spaces. */
  text: string;
  /** Folded words. */
  words: readonly string[];
  /** Folded without spaces, for subsequence. */
  compact: string;
};

type Prepared = { fields: readonly Field[]; labelLength: number };

// Latin accents (U+0300..U+036F after NFD), and the Devanagari (U+093C) and Gujarati (U+0ABC) nukta: "मंज़ूरी" and
// "मंजूरी" are the same word as people type it. NFD splits the precomposed nukta letters (U+0958..U+095F) first.
const DROPPED_MARKS = /[\u0300-\u036f\u093c\u0abc]/g;
// Long and short vowels are written either way ("डाई" and "डाइ"), and candrabindu is often typed as anusvara: fold
// each long form to the short one. Vowel signs stay (they are marks, kept by SEPARATORS), only their length goes.
const INDIC_FOLD: Readonly<Record<string, string>> = {
  "\u0940": "\u093f", // ी -> ि
  "\u0942": "\u0941", // ू -> ु
  "\u0908": "\u0907", // ई -> इ
  "\u090a": "\u0909", // ऊ -> उ
  "\u0901": "\u0902", // ँ -> ं
  "\u0ac0": "\u0abf", // ી -> િ
  "\u0ac2": "\u0ac1", // ૂ -> ુ
  "\u0a88": "\u0a87", // ઈ -> ઇ
  "\u0a8a": "\u0a89", // ઊ -> ઉ
  "\u0a81": "\u0a82", // ઁ -> ં
};
const INDIC_LONG = /[\u0940\u0942\u0908\u090a\u0901\u0ac0\u0ac2\u0a88\u0a8a\u0a81]/g;
// Letters, digits and combining marks of any script stay; everything else separates words. Indic vowel signs are
// marks (Mn/Mc), so they are kept.
const SEPARATORS = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * Lower case, Latin accents and Indic nukta stripped, Indic long vowels folded to short, punctuation and spacing
 * collapsed to single spaces.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(DROPPED_MARKS, "")
    .replace(INDIC_LONG, (c) => INDIC_FOLD[c] ?? c)
    .normalize("NFC")
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .trim();
}

function makeField(kind: Kind, raw: string): Field | null {
  const text = fold(raw);
  if (!text) return null;
  const words = text.split(" ");
  return { kind, raw, text, words, compact: words.join("") };
}

const cache = new WeakMap<Searchable, Prepared>();

function prepare(item: Searchable): Prepared {
  const hit = cache.get(item);
  if (hit) return hit;
  const fields: Field[] = [];
  const push = (kind: Kind, raw: string | undefined) => {
    if (!raw) return;
    const f = makeField(kind, raw);
    if (f) fields.push(f);
  };
  push(Kind.Label, item.label);
  if (item.labelEn && item.labelEn !== item.label) push(Kind.LabelEn, item.labelEn);
  for (const a of item.aliases ?? []) push(Kind.Alias, a);
  for (const t of item.terms ?? []) push(Kind.Term, t);
  const prepared = { fields, labelLength: item.label.length };
  cache.set(item, prepared);
  return prepared;
}

type Query = { text: string; tokens: readonly string[]; compact: string };

function prepareQuery(query: string): Query | null {
  const text = fold(query);
  if (!text) return null;
  const tokens = text.split(" ");
  return { text, tokens, compact: tokens.join("") };
}

/** Allowed edits for a query word: none under 4 letters, one for 4+, two for 8+. */
export function allowedEdits(length: number): number {
  return length >= 8 ? 2 : length >= 4 ? 1 : 0;
}

// Reused rows for the bounded edit distance; words longer than this are cut (palette words are short).
const MAX_LEN = 48;
let rowPrev2 = new Int32Array(MAX_LEN + 1);
let rowPrev = new Int32Array(MAX_LEN + 1);
let rowCur = new Int32Array(MAX_LEN + 1);

/**
 * Optimal string alignment distance (an adjacent swap counts as one edit), or `max + 1` once it is certain to
 * exceed `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  const n = Math.min(a.length, MAX_LEN);
  const m = Math.min(b.length, MAX_LEN);
  if (Math.abs(n - m) > max) return max + 1;
  for (let j = 0; j <= m; j++) rowPrev[j] = j;
  for (let i = 1; i <= n; i++) {
    rowCur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min((rowPrev[j] as number) + 1, (rowCur[j - 1] as number) + 1, (rowPrev[j - 1] as number) + (ca === cb ? 0 : 1));
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, (rowPrev2[j - 2] as number) + 1);
      }
      rowCur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = rowPrev2;
    rowPrev2 = rowPrev;
    rowPrev = rowCur;
    rowCur = t;
  }
  return rowPrev[m] as number;
}

const MARKS = /\p{M}/gu;

/** Words up to this many letters get the strict typo rule below. */
const SHORT_WORD = 5;

/** Letters, not code units: an Indic vowel sign or virama belongs to the letter before it. */
function letterCount(word: string): number {
  return word.replace(MARKS, "").length;
}

/**
 * A query word within its edit allowance of a whole field word, or of a word's start (the person is still typing).
 *
 * The first letter must always match. A 4 or 5 letter word gets only the two slips that are clearly typos: its last
 * two letters swapped ("stokc"), or its last letter wrong while the word is still being typed ("dispq" for
 * dispa-tch). Any other single change to a short word usually spells a different word ("cast" and "cust"-omers,
 * "stock" and "stick"-er, "data" and "date"). Longer words take their allowance anywhere. The start of a word is
 * never shorter than what was typed: an unfinished word is longer, so "dies" never matches "dis"-patch.
 * "स्टॉक" counts as 3 letters, so like "dix" it gets no allowance.
 */
function typoMatchesWord(token: string, word: string): boolean {
  const letters = letterCount(token);
  const max = allowedEdits(letters);
  if (max === 0 || token.charCodeAt(0) !== word.charCodeAt(0)) return false;
  const n = token.length;
  if (letters <= SHORT_WORD) {
    if (word.length < n || word.slice(0, n - 2) !== token.slice(0, n - 2)) return false;
    const swapped = word[n - 2] === token[n - 1] && word[n - 1] === token[n - 2];
    const lastWrongWhileTyping = word.length > n && word[n - 2] === token[n - 2];
    return swapped || lastWrongWhileTyping;
  }
  if (editDistance(token, word, max) <= max) return true;
  // Still typing: compare against the start of the word, never shorter than what was typed.
  for (let len = n; len <= n + max; len++) {
    if (len >= word.length) continue;
    if (editDistance(token, word.slice(0, len), max) <= max) return true;
  }
  return false;
}

function anyWordStartsWith(words: readonly string[], token: string): boolean {
  for (const w of words) if (w.startsWith(token)) return true;
  return false;
}

/** Every query word starts some field word. */
function wordPrefixAll(tokens: readonly string[], words: readonly string[]): boolean {
  for (const t of tokens) if (!anyWordStartsWith(words, t)) return false;
  return true;
}

/** Query letters in order inside the field; the first letter must start a word. Returns tightness 0..1, or -1. */
function subsequence(q: string, f: Field): number {
  if (q.length < 2 || q.length > f.compact.length) return -1;
  const first = q.charCodeAt(0);
  let best = -1;
  // Try each word start that carries the first letter.
  let offset = 0;
  for (const w of f.words) {
    if (w.charCodeAt(0) === first) {
      let qi = 1;
      let end = offset;
      for (let ci = offset + 1; ci < f.compact.length && qi < q.length; ci++) {
        if (f.compact.charCodeAt(ci) === q.charCodeAt(qi)) {
          qi++;
          end = ci;
        }
      }
      if (qi === q.length) {
        const tight = q.length / (end - offset + 1);
        if (tight > best) best = tight;
      }
    }
    offset += w.length;
  }
  return best;
}

/** Each query word typo-matches some field word; words under 4 letters must word-prefix match exactly. */
function typoAll(tokens: readonly string[], words: readonly string[]): boolean {
  let usedTypo = false;
  for (const t of tokens) {
    if (anyWordStartsWith(words, t)) continue;
    let ok = false;
    for (const w of words) {
      if (typoMatchesWord(t, w)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
    usedTypo = true;
  }
  return usedTypo;
}

/** Best tier score of the query against one field (without the kind bonus), or -1. */
function scoreField(q: Query, f: Field): number {
  if (f.text === q.text) return TIER.exact;
  if (f.text.startsWith(q.text)) return TIER.prefix;
  if (wordPrefixAll(q.tokens, f.words)) return TIER.wordPrefix;
  if (f.text.includes(q.text)) return TIER.substring;
  const tight = subsequence(q.compact, f);
  if (tight >= 0) return TIER.subsequence + Math.round(tight * 40);
  // A term is the weakest evidence: a short word's slip against one names a word the person never meant.
  if (f.kind === Kind.Term && q.tokens.some((t) => letterCount(t) <= SHORT_WORD)) return -1;
  if (typoAll(q.tokens, f.words)) return TIER.typo;
  return -1;
}

function matchPrepared(q: Query, p: Prepared): Match | null {
  let bestScore = -1;
  let bestField: Field | null = null;
  for (const f of p.fields) {
    const s = scoreField(q, f);
    if (s < 0) continue;
    const total = s + KIND_BONUS[f.kind];
    if (total > bestScore) {
      bestScore = total;
      bestField = f;
    }
  }
  // Several query words spread over the label and its words ("dies makers"): each word starts a word somewhere.
  if (q.tokens.length > 1) {
    const crossScore = TIER.wordPrefix - 40;
    if (crossScore > bestScore) {
      let via: Field | null = null;
      let all = true;
      for (const t of q.tokens) {
        let hit: Field | null = null;
        for (const f of p.fields) {
          if (anyWordStartsWith(f.words, t)) {
            hit = f;
            break;
          }
        }
        if (!hit) {
          all = false;
          break;
        }
        if (!via && hit.kind >= Kind.Alias) via = hit;
      }
      if (all) return via ? { score: crossScore, matched: via.raw } : { score: crossScore };
    }
  }
  if (!bestField) return null;
  return bestField.kind >= Kind.Alias ? { score: bestScore, matched: bestField.raw } : { score: bestScore };
}

/**
 * One item against a query; null when it does not match. An empty query matches everything with score 0; a query of
 * only punctuation ("-", "#") matches nothing.
 */
export function matchItem(query: string, item: Searchable): Match | null {
  const q = prepareQuery(query);
  if (!q) return query.trim() ? null : { score: 0 };
  return matchPrepared(q, prepare(item));
}

/**
 * Matching items, best first: score, then shorter label, then group order, then input order. An empty query keeps
 * every item in input order; a query of only punctuation keeps none.
 */
export function rankItems<T extends Searchable>(query: string, items: readonly T[]): Ranked<T>[] {
  const q = prepareQuery(query);
  if (!q) return query.trim() ? [] : items.map((item) => ({ ...item, match: { score: 0 } }));
  const hits: { item: T; i: number; match: Match; len: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const p = prepare(item);
    const match = matchPrepared(q, p);
    if (match) hits.push({ item, i, match, len: p.labelLength });
  }
  hits.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      a.len - b.len ||
      GROUP_ORDER[a.item.group] - GROUP_ORDER[b.item.group] ||
      a.i - b.i,
  );
  return hits.map(({ item, match }) => ({ ...item, match }));
}
