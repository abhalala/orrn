/**
 * Foundry depth (XE parity lane FOUNDRY): the pure rules behind homogenizing (#41), billet cutting
 * (#44), the casting plan (#46) and the charge-mix suggestion (#47). The server computes every figure
 * with these; screens only preview.
 */
import { soakCompliance, type AgeingReading, type SoakCompliance } from "./ageing";
import { SPECTRO_ELEMENTS, type SpectroElementKey } from "./foundry";

// ---------------------------------------------------------------------------
// #41 Homogenizing
// ---------------------------------------------------------------------------

/**
 * A homogenizing soak runs for hours, so one reading stands for at most 60 minutes (ageing's 15
 * minutes would ask for a reading every quarter hour through a night shift). A longer gap is unknown time.
 */
export const HOMOG_READING_HOLD_MAX_MIN = 60;
/** Above the band for longer than this counts as over-soaked. */
export const HOMOG_OVER_TEMP_GRACE_MIN = 30;

export type HomogRecipe = { targetTempX10: number; toleranceX10: number; soakMin: number };

/** Typical 6xxx recipe offered on a new batch: 580 °C ± 10 °C for 6 hours. */
export const HOMOG_DEFAULT_RECIPE: HomogRecipe = { targetTempX10: 5_800, toleranceX10: 100, soakMin: 360 };

export type HomogSoakVerdict = "ok" | "short" | "over" | "no_readings";

/** The soak of a homogenizing batch from its readings (ageing's compliance rule with the 60-minute hold). */
export function homogSoak(input: { readings: readonly AgeingReading[]; recipe: HomogRecipe; inAt: number; outAt: number | null; now: number }): SoakCompliance & {
  homogVerdict: HomogSoakVerdict;
} {
  const c = soakCompliance({
    readings: input.readings,
    snapshot: { ...input.recipe, maxSoakMin: null },
    inAt: input.inAt,
    outAt: input.outAt,
    now: input.now,
    holdMaxMin: HOMOG_READING_HOLD_MAX_MIN,
    overTempGraceMin: HOMOG_OVER_TEMP_GRACE_MIN,
  });
  const homogVerdict: HomogSoakVerdict = c.verdict === "ok" ? "ok" : c.verdict === "no_readings" ? "no_readings" : c.verdict === "over_aged" ? "over" : "short";
  return { ...c, homogVerdict };
}

/** Recipe limits the server accepts: 300-650 °C, band 1-50 °C, soak 10 minutes to 48 hours. */
export function homogRecipeError(r: HomogRecipe): "temp_range" | "band_range" | "soak_range" | null {
  if (!Number.isInteger(r.targetTempX10) || r.targetTempX10 < 3_000 || r.targetTempX10 > 6_500) return "temp_range";
  if (!Number.isInteger(r.toleranceX10) || r.toleranceX10 < 10 || r.toleranceX10 > 500) return "band_range";
  if (!Number.isInteger(r.soakMin) || r.soakMin < 10 || r.soakMin > 48 * 60) return "soak_range";
  return null;
}

/** 6xxx alloys (`6063`, `6061`, `6082`…) are the ones the plant setting asks to homogenize before cutting. */
export function alloyNeedsHomogenizing(alloyCode: string | null | undefined): boolean {
  return /^6\d{3}/.test((alloyCode ?? "").trim());
}

/**
 * With `requireHomogenizing` on, a 6xxx cast's logs may be cut only up to the pieces that came out of a
 * RELEASED homogenizing batch: released pieces − pieces already cut ≥ pieces asked. Returns the pieces
 * still allowed, or null when no gate applies.
 */
export function homogCutAllowance(input: {
  required: boolean;
  alloy: string | null;
  source: "melt" | "bought_in";
  releasedPcs: number;
  cutPcs: number;
}): number | null {
  if (!input.required || !alloyNeedsHomogenizing(input.alloy)) return null;
  return Math.max(0, input.releasedPcs - input.cutPcs);
}

// ---------------------------------------------------------------------------
// #44 Billet cutting
// ---------------------------------------------------------------------------

export type BilletCutError = "no_logs" | "no_billets" | "more_out_than_in" | "length_range";

/**
 * Logs in, billets out. End cuts (saw kerf, heads and tails) = log kg − billet kg and go to a return
 * stream, so the cast's tail stays closed. Yield = billet kg ÷ log kg, basis points (rounded down).
 */
export function billetCutFigures(input: { logPcs: number; logG: number; billetPcs: number; billetG: number; billetLengthMm: number }):
  | { ok: true; endG: number; yieldBp: number }
  | { ok: false; error: BilletCutError } {
  if (input.logPcs <= 0 || input.logG <= 0) return { ok: false, error: "no_logs" };
  if (input.billetPcs <= 0 || input.billetG <= 0) return { ok: false, error: "no_billets" };
  if (input.billetLengthMm < 100 || input.billetLengthMm > 2_000) return { ok: false, error: "length_range" };
  if (input.billetG > input.logG) return { ok: false, error: "more_out_than_in" };
  return { ok: true, endG: input.logG - input.billetG, yieldBp: Math.floor((input.billetG * 10_000) / input.logG) };
}

// ---------------------------------------------------------------------------
// #46 Casting plan
// ---------------------------------------------------------------------------

export type CastNeed = { day: string; alloy: string; billetKgG: number };

export type CastPlanRow = {
  day: string;
  alloy: string;
  /** Billet kg the press plans of that day need (grams). */
  needG: number;
  /** Covered by logs and billets in stock, or by plan lines already accepted (grams). */
  coveredG: number;
  /** Metal to cast for that day (grams) and the casts it takes at the furnace size. */
  castG: number;
  casts: number;
};

/**
 * The casting plan from the press plans' billet need (REG's `billetNeed`, summed per plan day and
 * alloy). Per alloy, days are taken in order and what is on hand (logs + billets) and what earlier
 * accepted plan lines will cast is spent first; the rest is metal to cast that day. `castSizeG` is the
 * melting furnace's capacity: the casts a day takes = ⌈cast kg ÷ size⌉. Rows with nothing to cast are
 * kept so the plant sees the need was looked at.
 */
export function castingPlan(input: {
  needs: readonly CastNeed[];
  stockByAlloy: ReadonlyMap<string, number>;
  acceptedByAlloy: ReadonlyMap<string, number>;
  castSizeG: number | null;
}): { rows: CastPlanRow[]; totals: { alloy: string; needG: number; coveredG: number; castG: number; casts: number }[] } {
  const merged = new Map<string, CastNeed>();
  for (const n of input.needs) {
    if (n.billetKgG <= 0) continue;
    const k = `${n.day}|${n.alloy}`;
    const m = merged.get(k) ?? { day: n.day, alloy: n.alloy, billetKgG: 0 };
    m.billetKgG += n.billetKgG;
    merged.set(k, m);
  }
  const ordered = [...merged.values()].sort((a, b) => (a.day === b.day ? a.alloy.localeCompare(b.alloy) : a.day.localeCompare(b.day)));
  const left = new Map<string, number>();
  for (const [a, g] of input.stockByAlloy) left.set(a, Math.max(0, g));
  for (const [a, g] of input.acceptedByAlloy) left.set(a, (left.get(a) ?? 0) + Math.max(0, g));
  const size = input.castSizeG && input.castSizeG > 0 ? input.castSizeG : null;
  const rows: CastPlanRow[] = ordered.map((n) => {
    const have = left.get(n.alloy) ?? 0;
    const coveredG = Math.min(have, n.billetKgG);
    left.set(n.alloy, have - coveredG);
    const castG = n.billetKgG - coveredG;
    return { day: n.day, alloy: n.alloy, needG: n.billetKgG, coveredG, castG, casts: castG <= 0 ? 0 : size ? Math.ceil(castG / size) : 1 };
  });
  const totals = new Map<string, { alloy: string; needG: number; coveredG: number; castG: number; casts: number }>();
  for (const r of rows) {
    const t = totals.get(r.alloy) ?? { alloy: r.alloy, needG: 0, coveredG: 0, castG: 0, casts: 0 };
    t.needG += r.needG;
    t.coveredG += r.coveredG;
    t.castG += r.castG;
    t.casts += r.casts;
    totals.set(r.alloy, t);
  }
  return { rows, totals: [...totals.values()] };
}

// ---------------------------------------------------------------------------
// #47 Charge-mix suggestion: a small linear program
// ---------------------------------------------------------------------------

export type LpRow = { a: readonly number[]; op: "<=" | ">=" | "="; b: number };
export type LpResult = { status: "optimal"; x: number[]; value: number } | { status: "infeasible" } | { status: "unbounded" };

const EPS = 1e-9;

/**
 * Minimise c·x subject to the rows and x ≥ 0 (two-phase simplex on a dense tableau, Bland's rule so it
 * never cycles). Sized for a charge mix: tens of variables, a few dozen rows.
 */
export function solveLp(c: readonly number[], rows: readonly LpRow[]): LpResult {
  const n = c.length;
  // Flip rows so every right-hand side is ≥ 0.
  const rs = rows.map((r) => (r.b < 0 ? { a: r.a.map((v) => -v), op: r.op === "<=" ? ">=" : r.op === ">=" ? "<=" : "=", b: -r.b } : r)) as LpRow[];
  const m = rs.length;
  const slackCount = rs.filter((r) => r.op !== "=").length;
  const artCount = rs.filter((r) => r.op !== "<=").length;
  const width = n + slackCount + artCount + 1; // last column = rhs
  const T: number[][] = [];
  const basis: number[] = [];
  let s = n;
  let art = n + slackCount;
  const artCols: number[] = [];
  for (let i = 0; i < m; i++) {
    const r = rs[i]!;
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) row[j] = r.a[j] ?? 0;
    row[width - 1] = r.b;
    if (r.op === "<=") {
      row[s] = 1;
      basis.push(s);
      s++;
    } else if (r.op === ">=") {
      row[s] = -1;
      s++;
      row[art] = 1;
      basis.push(art);
      artCols.push(art);
      art++;
    } else {
      row[art] = 1;
      basis.push(art);
      artCols.push(art);
      art++;
    }
    T.push(row);
  }
  const artSet = new Set(artCols);

  const pivot = (pr: number, pc: number) => {
    const p = T[pr]![pc]!;
    const prow = T[pr]!;
    for (let j = 0; j < width; j++) prow[j]! /= p;
    for (let i = 0; i < m; i++) {
      if (i === pr) continue;
      const f = T[i]![pc]!;
      if (Math.abs(f) < EPS) continue;
      const row = T[i]!;
      for (let j = 0; j < width; j++) row[j] = row[j]! - f * prow[j]!;
    }
    basis[pr] = pc;
  };

  /** Run the simplex for objective `obj` (length width-1) over allowed columns; false = unbounded. */
  const run = (obj: number[], allowed: (j: number) => boolean): boolean => {
    for (let iter = 0; iter < 5_000; iter++) {
      // Reduced costs: obj_j − Σ obj_basis × T_ij.
      let enter = -1;
      for (let j = 0; j < width - 1; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = obj[j]!;
        for (let i = 0; i < m; i++) rc -= obj[basis[i]!]! * T[i]![j]!;
        if (rc < -1e-10) {
          enter = j;
          break; // Bland: lowest index
        }
      }
      if (enter < 0) return true;
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i]![enter]!;
        if (a > EPS) {
          const ratio = T[i]![width - 1]! / a;
          if (ratio < best - 1e-12 || (Math.abs(ratio - best) <= 1e-12 && leave >= 0 && basis[i]! < basis[leave]!)) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave < 0) return false;
      pivot(leave, enter);
    }
    return true;
  };

  if (artCols.length > 0) {
    const phase1 = new Array<number>(width - 1).fill(0);
    for (const a of artCols) phase1[a] = 1;
    run(phase1, () => true);
    const infeas = basis.reduce((sum, b, i) => sum + (artSet.has(b) ? T[i]![width - 1]! : 0), 0);
    if (infeas > 1e-7) return { status: "infeasible" };
    // Drive any artificial still basic (at 0) out of the basis.
    for (let i = 0; i < m; i++) {
      if (!artSet.has(basis[i]!)) continue;
      const j = T[i]!.findIndex((v, col) => col < n + slackCount && Math.abs(v) > EPS);
      if (j >= 0) pivot(i, j);
    }
  }
  const phase2 = new Array<number>(width - 1).fill(0);
  for (let j = 0; j < n; j++) phase2[j] = c[j]!;
  if (!run(phase2, (j) => !artSet.has(j))) return { status: "unbounded" };
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i]! < n) x[basis[i]!] = T[i]![width - 1]!;
  return { status: "optimal", x, value: x.reduce((v, xi, j) => v + xi * c[j]!, 0) };
}

export type ChargeSource = {
  key: string;
  kind: "lot" | "stream";
  label: string;
  availableG: number;
  /** Rate per kg in paise (a lot's purchase rate). Return streams are the plant's own metal: 0. */
  ratePaise: number;
  /** Typical chemistry, ppm. null = no chemistry entered: the source is left out of the suggestion. */
  ppm: Partial<Record<SpectroElementKey, number>> | null;
};

export type AlloyLimitPpm = { element: SpectroElementKey; minPpm: number | null; maxPpm: number | null };

export type ChargeMixResult = {
  status: "ok" | "outside_limits" | "short_metal" | "no_sources";
  lines: { key: string; kind: "lot" | "stream"; label: string; kgG: number }[];
  /** Expected chemistry of the mix (ppm) and how each limited element sits against the alloy. */
  predicted: { element: SpectroElementKey; ppm: number; minPpm: number | null; maxPpm: number | null; ok: boolean }[];
  costPaise: number;
  /** Sources left out, and why. */
  skipped: { key: string; label: string; reason: "no_chemistry" | "empty" }[];
  availableG: number;
};

/**
 * The cheapest mix of the sources that makes `targetG` of metal with every limited element inside the
 * alloy's limits, from the typical chemistry per scrap grade or stream (spectro is per melt, not per
 * lot). An element a source does not list counts as 0 ppm; `al` (the remainder) is never constrained.
 * When no mix meets the limits, the answer is the mix that comes closest (least total distance outside
 * the limits, in percent) with status `outside_limits`, so the foundry sees which element is out and by
 * how much. A suggestion only: nothing is ever applied to a melt.
 */
export function suggestChargeMix(input: { targetG: number; limits: readonly AlloyLimitPpm[]; sources: readonly ChargeSource[] }): ChargeMixResult {
  const skipped: ChargeMixResult["skipped"] = [];
  const usable = input.sources.filter((s) => {
    if (s.availableG <= 0) {
      skipped.push({ key: s.key, label: s.label, reason: "empty" });
      return false;
    }
    if (!s.ppm) {
      skipped.push({ key: s.key, label: s.label, reason: "no_chemistry" });
      return false;
    }
    return true;
  });
  const availableG = usable.reduce((t, s) => t + s.availableG, 0);
  const limits = input.limits.filter((l) => l.element !== "al" && (l.minPpm != null || l.maxPpm != null));
  const empty = (status: ChargeMixResult["status"]): ChargeMixResult => ({ status, lines: [], predicted: [], costPaise: 0, skipped, availableG });
  if (usable.length === 0 || input.targetG <= 0) return empty("no_sources");
  if (availableG < input.targetG) return empty("short_metal");

  const T = input.targetG;
  const n = usable.length;
  // Fractions of the charge; chemistry in percent (ppm / 10,000); cost in rupees per kg.
  const pct = (s: ChargeSource, e: SpectroElementKey) => (s.ppm?.[e] ?? 0) / 10_000;
  const boundRows: LpRow[] = [];
  usable.forEach((s, j) => {
    const cap = s.availableG / T;
    if (cap < 1) boundRows.push({ a: usable.map((_, k) => (k === j ? 1 : 0)), op: "<=", b: cap });
  });
  const sumRow: LpRow = { a: usable.map(() => 1), op: "=", b: 1 };
  const elementRows = (withSlack: boolean): LpRow[] => {
    const rows: LpRow[] = [];
    const extra = withSlack ? limits.length * 2 : 0;
    limits.forEach((l, li) => {
      const coef = usable.map((s) => pct(s, l.element));
      const pad = (over: number, under: number) => {
        const a = [...coef, ...new Array<number>(extra).fill(0)];
        if (withSlack) {
          a[n + li * 2] = over;
          a[n + li * 2 + 1] = under;
        }
        return a;
      };
      if (l.maxPpm != null) rows.push({ a: pad(-1, 0), op: "<=", b: l.maxPpm / 10_000 });
      if (l.minPpm != null) rows.push({ a: pad(0, 1), op: ">=", b: l.minPpm / 10_000 });
    });
    return rows;
  };
  const widen = (r: LpRow, extra: number): LpRow => ({ ...r, a: [...r.a, ...new Array<number>(extra).fill(0)] });

  let x: number[] | null = null;
  let status: ChargeMixResult["status"] = "ok";
  const cost = usable.map((s) => s.ratePaise / 100);
  const strict = solveLp(cost, [...boundRows, sumRow, ...elementRows(false)]);
  if (strict.status === "optimal") x = strict.x;
  else {
    // Closest mix: minimise the distance outside the limits, then (tiny weight) the cost.
    const extra = limits.length * 2;
    const maxRate = Math.max(1, ...cost);
    const obj = [...cost.map((c) => (c / maxRate) * 1e-6), ...new Array<number>(extra).fill(1)];
    const near = solveLp(obj, [...boundRows.map((r) => widen(r, extra)), widen(sumRow, extra), ...elementRows(true)]);
    if (near.status !== "optimal") return empty("outside_limits");
    x = near.x.slice(0, n);
    status = "outside_limits";
  }

  // Grams: round down, then give the remainder to the largest lines so the mix adds up to the target.
  const raw = x.map((f, j) => Math.max(0, Math.min(usable[j]!.availableG, f * T)));
  const grams = raw.map((g) => Math.floor(g));
  let rest = T - grams.reduce((t, g) => t + g, 0);
  const order = raw.map((g, j) => ({ j, frac: g - Math.floor(g) })).sort((a, b) => b.frac - a.frac);
  for (const { j } of order) {
    if (rest <= 0) break;
    const room = usable[j]!.availableG - grams[j]!;
    const add = Math.min(room, rest);
    grams[j]! += add;
    rest -= add;
  }
  const lines = usable
    .map((s, j) => ({ key: s.key, kind: s.kind, label: s.label, kgG: grams[j]! }))
    .filter((l) => l.kgG >= 1_000)
    .sort((a, b) => b.kgG - a.kgG);
  const used = lines.reduce((t, l) => t + l.kgG, 0) || 1;
  const byKey = new Map(usable.map((s) => [s.key, s]));
  const predicted = limits.map((l) => {
    const ppm = Math.round(lines.reduce((t, ln) => t + (byKey.get(ln.key)!.ppm?.[l.element] ?? 0) * ln.kgG, 0) / used);
    // ±1 ppm of rounding never fails a line the optimiser placed on the limit.
    const ok = (l.minPpm == null || ppm >= l.minPpm - 1) && (l.maxPpm == null || ppm <= l.maxPpm + 1);
    return { element: l.element, ppm, minPpm: l.minPpm, maxPpm: l.maxPpm, ok };
  });
  const costPaise = Math.round(lines.reduce((t, ln) => t + (byKey.get(ln.key)!.ratePaise * ln.kgG) / 1_000, 0));
  return { status, lines, predicted, costPaise, skipped, availableG };
}

/** The elements a typical chemistry may list (the spectro elements, `al` included). */
export const CHARGE_CHEMISTRY_ELEMENTS: readonly SpectroElementKey[] = SPECTRO_ELEMENTS;
