/**
 * Fit a block to a hole (plan B3). Pure; the browser and the server run the same code.
 *
 * Order: this plant's learned approved holes first (newest version first, as given), then the built-in holes.
 * A learned exact fit wins outright. Otherwise the best score wins, and two different targets within 50 points give
 * `none` so the person picks.
 */
import { kindsCompatible } from "./cells";
import { headerKey, normalizeHeaders } from "./fingerprint";
import type { BlockShape, CellKind, FitDiff, Recipe, RecipeField } from "./recipe";
import type { IngestTarget } from "./states";
import { BUILTIN_HOLES, analyzeBuiltin, builtinRef } from "./builtins";
import type { BuiltinHole } from "./builtins/types";
import { headerSimilarity } from "./similarity";
import { TARGETS } from "./targets";

/** A learned, approved hole version of this plant. */
export type LearnedHole = {
  holeId: string;
  holeVersionId: string;
  name: string;
  version: number;
  recipe: Recipe;
};

export const FIT_SCORES = { learnedExact: 1000, builtinExact: 950, nearMin: 600 } as const;
export const NEAR_LIMITS = { renamed: 2, extra: 3, missingOptional: 2, events: 4 } as const;
export const TARGET_TIE_POINTS = 50;
/** How far from its expected place a renamed column may sit. */
export const RENAME_WINDOW = 2;

export type FitCandidate = {
  fit: "exact" | "near";
  score: number;
  target: IngestTarget;
  holeRef: string;
  /** The recipe for this block: columns rebased to the block's own, match set to its headers. */
  recipe: Recipe;
  diff: FitDiff;
  name: string;
  learned: boolean;
};

export type FitResult = {
  fit: "exact" | "near" | "none";
  score: number;
  target: IngestTarget | null;
  holeRef: string | null;
  recipe: Recipe | null;
  diff: FitDiff | null;
  name: string | null;
  /** The other targets that fit, best first. Filled when the person has to pick (`none` because of a tie). */
  alternatives: { target: IngestTarget; score: number; holeRef: string; fit: "exact" | "near" }[];
  tie: boolean;
};

export const emptyDiff = (): FitDiff => ({ renamed: [], extra: [], missing: [], kindMismatch: [], unitless: [] });

export function nearScore(d: { renamed: number; extra: number; missing: number; kindMismatch: number; unitless?: number }): number {
  return 1000 - 120 * d.renamed - 60 * d.extra - 90 * d.missing - 40 * d.kindMismatch - 50 * (d.unitless ?? 0);
}

/** Does a near fit with these counts pass every limit of plan B3? */
export function nearAllowed(d: { renamed: number; extra: number; missing: number; kindMismatch: number; unitless?: number }): boolean {
  return (
    d.renamed <= NEAR_LIMITS.renamed &&
    d.extra <= NEAR_LIMITS.extra &&
    d.missing <= NEAR_LIMITS.missingOptional &&
    d.renamed + d.extra + d.missing <= NEAR_LIMITS.events &&
    nearScore(d) >= FIT_SCORES.nearMin
  );
}

// ---------------------------------------------------------------- recipes and columns

export function recipeColumns(recipe: Recipe): number[] {
  const cols = new Set<number>();
  for (const f of recipe.fields) if (f.source.kind === "columns") for (const c of f.source.cols) cols.add(c.col);
  for (const f of recipe.filters) cols.add(f.col.col);
  return [...cols].sort((a, b) => a - b);
}

/** What kind of cells a column must hold, as far as the recipe says: number steps want decimals, date steps dates. */
export function expectedKinds(recipe: Recipe): Map<number, CellKind> {
  const out = new Map<number, CellKind>();
  for (const f of recipe.fields) {
    if (f.source.kind !== "columns") continue;
    const want: CellKind | null = f.steps.some((s) => s.op === "number") ? "decimal" : f.steps.some((s) => s.op === "date") ? "date" : null;
    if (want === null) continue;
    for (const c of f.source.cols) out.set(c.col, want);
  }
  return out;
}

/** Moves every column reference to the block's own columns and sets `match` to the block's headers. */
export function rebaseRecipe(recipe: Recipe, colMap: ReadonlyMap<number, number>, block: BlockShape): Recipe {
  const headers = block.headers;
  const ref = (c: { col: number; header: string }) => {
    const col = colMap.get(c.col) ?? c.col;
    return { col, header: headers[col] ?? c.header };
  };
  const normalized = normalizeHeaders(headers, block.columnCount);
  const fields: RecipeField[] = recipe.fields.map((f) =>
    f.source.kind === "columns" ? { ...f, source: { kind: "columns", cols: f.source.cols.map(ref) } } : f,
  );
  return {
    ...recipe,
    headerRow: block.headerRow ?? recipe.headerRow,
    headerRows: block.headerRows ?? recipe.headerRows,
    match: { headerKey: block.headerKey || headerKey(normalized), headers: normalized },
    fields,
    filters: recipe.filters.map((f) => ({ ...f, col: ref(f.col) })),
  };
}

// ---------------------------------------------------------------- learned holes

function requiredCols(recipe: Recipe): Set<number> {
  const out = new Set<number>();
  const required = new Set(TARGETS[recipe.target].fields.filter((f) => f.required).map((f) => f.name));
  for (const f of recipe.fields) {
    if (!required.has(f.field) || f.source.kind !== "columns") continue;
    for (const c of f.source.cols) out.add(c.col);
  }
  for (const f of recipe.filters) out.add(f.col.col);
  return out;
}

export function fitLearned(block: BlockShape, hole: LearnedHole): FitCandidate | null {
  const recipe = hole.recipe;
  const holeHeaders = recipe.match.headers;
  const blockHeaders = normalizeHeaders(block.headers, block.columnCount);
  const expected = expectedKinds(recipe);
  const kindOf = (c: number): CellKind => block.kinds[c] ?? "empty";
  const holeRef = `learned:${hole.holeVersionId}`;

  const kindsOk = [...expected].every(([c, k]) => c < block.columnCount && kindsCompatible(k, kindOf(c)));
  if (block.headerKey === recipe.match.headerKey && kindsOk) {
    const identity = new Map(holeHeaders.map((_, i) => [i, i] as const));
    return {
      fit: "exact",
      score: FIT_SCORES.learnedExact,
      target: recipe.target,
      holeRef,
      recipe: rebaseRecipe(recipe, identity, block),
      diff: emptyDiff(),
      name: hole.name,
      learned: true,
    };
  }

  const used = new Set(recipeColumns(recipe));
  const required = requiredCols(recipe);
  const colMap = new Map<number, number>();
  const claimed = new Set<number>();
  const renamed: FitDiff["renamed"] = [];

  // Equal normalized header at any position: nearest to the expected place wins.
  for (let h = 0; h < holeHeaders.length; h++) {
    let best = -1;
    for (let b = 0; b < blockHeaders.length; b++) {
      if (claimed.has(b) || blockHeaders[b] !== holeHeaders[h]) continue;
      if (best === -1 || Math.abs(b - h) < Math.abs(best - h)) best = b;
    }
    if (best !== -1) {
      colMap.set(h, best);
      claimed.add(best);
    }
  }
  // Renamed: only for columns the recipe uses.
  type Cand = { h: number; b: number; score: number };
  const cands: Cand[] = [];
  for (const h of used) {
    if (colMap.has(h)) continue;
    for (let b = 0; b < blockHeaders.length; b++) {
      if (claimed.has(b) || Math.abs(b - h) > RENAME_WINDOW) continue;
      const k = expected.get(h);
      if (k && !kindsCompatible(k, kindOf(b))) continue;
      const s = headerSimilarity(blockHeaders[b]!, holeHeaders[h] ?? "");
      if (s > 0) cands.push({ h, b, score: s });
    }
  }
  cands.sort((x, y) => y.score - x.score || x.h - y.h);
  for (const c of cands) {
    if (colMap.has(c.h) || claimed.has(c.b)) continue;
    colMap.set(c.h, c.b);
    claimed.add(c.b);
    renamed.push({ col: c.b, from: holeHeaders[c.h] ?? "", to: block.headers[c.b] ?? "" });
  }

  const missing: FitDiff["missing"] = [];
  for (const h of used) {
    if (colMap.has(h)) continue;
    if (required.has(h)) return null;
    missing.push({ field: fieldOfColumn(recipe, h), header: holeHeaders[h] ?? "" });
  }
  const extra: FitDiff["extra"] = [];
  for (let b = 0; b < block.columnCount; b++) if (!claimed.has(b)) extra.push({ col: b, header: block.headers[b] ?? "" });
  const kindMismatch: FitDiff["kindMismatch"] = [];
  for (const [h, b] of colMap) {
    const k = expected.get(h);
    if (k && !kindsCompatible(k, kindOf(b))) kindMismatch.push({ col: b, header: block.headers[b] ?? "", expected: k, found: kindOf(b) });
  }
  const counts = { renamed: renamed.length, extra: extra.length, missing: missing.length, kindMismatch: kindMismatch.length };
  if (!nearAllowed(counts)) return null;
  return {
    fit: "near",
    score: nearScore(counts),
    target: recipe.target,
    holeRef,
    recipe: rebaseRecipe(recipe, colMap, block),
    diff: { renamed, extra, missing, kindMismatch, unitless: [] },
    name: hole.name,
    learned: true,
  };
}

function fieldOfColumn(recipe: Recipe, col: number): string {
  for (const f of recipe.fields) if (f.source.kind === "columns" && f.source.cols.some((c) => c.col === col)) return f.field;
  return "";
}

// ---------------------------------------------------------------- built-in holes

export function fitBuiltin(block: BlockShape, hole: BuiltinHole): FitCandidate | null {
  const pos = { headerRow: block.headerRow ?? 0, headerRows: block.headerRows ?? 1 };
  const blockHeaders = block.headers.slice(0, block.columnCount);
  const exact = analyzeBuiltin(hole, blockHeaders, { ...pos, kinds: block.kinds });
  const holeRef = builtinRef(hole);

  // A built-in names only columns it knows, so a sheet that mostly holds other columns is not an exact fit.
  if (exact.missingRequired.length === 0 && exact.unitless.length === 0 && exact.extra.length <= exact.mapped.length) {
    return {
      fit: "exact",
      score: FIT_SCORES.builtinExact,
      target: hole.target,
      holeRef,
      recipe: exact.recipe,
      diff: { ...emptyDiff(), extra: exact.extra, missing: exact.missingOptional },
      name: hole.id,
      learned: false,
    };
  }

  const near = analyzeBuiltin(hole, blockHeaders, { ...pos, kinds: block.kinds, fuzzy: true });
  if (near.missingRequired.length > 0) return null;
  // Optional columns a built-in does not find are normal: only renamed, extra, kind and unit problems count.
  const counts = {
    renamed: near.renamed.length,
    extra: near.extra.length,
    missing: 0,
    kindMismatch: near.kindMismatch.length,
    unitless: near.unitless.length,
  };
  if (!nearAllowed(counts)) return null;
  return {
    fit: "near",
    score: nearScore(counts),
    target: hole.target,
    holeRef,
    recipe: near.recipe,
    diff: {
      renamed: near.renamed,
      extra: near.extra,
      missing: near.missingOptional,
      kindMismatch: near.kindMismatch,
      unitless: near.unitless,
    },
    name: hole.id,
    learned: false,
  };
}

// ---------------------------------------------------------------- choosing

export function candidatesFor(block: BlockShape, learned: readonly LearnedHole[], builtins: readonly BuiltinHole[] = BUILTIN_HOLES): FitCandidate[] {
  const out: FitCandidate[] = [];
  for (const h of learned) {
    const c = fitLearned(block, h);
    if (c) out.push(c);
  }
  for (const h of builtins) {
    const c = fitBuiltin(block, h);
    if (c) out.push(c);
  }
  return out;
}

const NONE: FitResult = { fit: "none", score: 0, target: null, holeRef: null, recipe: null, diff: null, name: null, alternatives: [], tie: false };

export function fitBlock(block: BlockShape, learned: readonly LearnedHole[] = [], builtins: readonly BuiltinHole[] = BUILTIN_HOLES): FitResult {
  const all = candidatesFor(block, learned, builtins);
  if (all.length === 0) return NONE;
  // First in list order wins a tie of score within one target (learned newest first, then built-ins).
  const bestPerTarget = new Map<IngestTarget, FitCandidate>();
  for (const c of all) {
    const cur = bestPerTarget.get(c.target);
    if (!cur || c.score > cur.score) bestPerTarget.set(c.target, c);
  }
  const ranked = [...bestPerTarget.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0]!;
  const alternatives = ranked.slice(1).map((c) => ({ target: c.target, score: c.score, holeRef: c.holeRef, fit: c.fit }));
  const second = ranked[1];
  const learnedExact = top.learned && top.fit === "exact";
  if (second && !learnedExact && top.score - second.score <= TARGET_TIE_POINTS) {
    return {
      ...NONE,
      alternatives: ranked.map((c) => ({ target: c.target, score: c.score, holeRef: c.holeRef, fit: c.fit })),
      tie: true,
    };
  }
  return { fit: top.fit, score: top.score, target: top.target, holeRef: top.holeRef, recipe: top.recipe, diff: top.diff, name: top.name, alternatives, tie: false };
}
