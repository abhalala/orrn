/**
 * Foundry maths shared by server, web and native (spec P15, digest Stages 3-5). Integer grams in,
 * integer grams and basis points out, so the server check and the screen preview agree exactly.
 */

/** A melt whose loss (in − out) is above 3 % of its input warns (spec P15, §8.6 Cast). */
export const MELT_BALANCE_WARN_BP = 300;

/** A cast whose unexplained tail is above 1 % of its input needs a reason and a second person. */
export const CAST_TAIL_REASON_BP = 100;

/** Alloys the plant casts. 6063 and 6061 today; the rest are common extrusion grades. */
export const CAST_ALLOYS = ["6063", "6061", "6082", "6005", "6060", "6463", "1100", "3003"] as const;
export type CastAlloy = (typeof CAST_ALLOYS)[number];

export type MeltBalanceWarning = "loss_high" | "out_exceeds_in";

export type MeltBalance = {
  /** In − out, grams. Positive = metal lost (burn loss); negative = more came out than went in. */
  lossG: number;
  /** Loss as basis points of the input, rounded (display only; the warning compares grams). */
  lossBp: number;
  /** The part of the loss accepted as burn loss: 0 … 3 % of the input (floored), never more. */
  allowedBurnG: number;
  /** Loss beyond the 3 % allowance; the cast close-out counts it as unexplained. */
  excessBurnG: number;
  warning: MeltBalanceWarning | null;
};

function assertGrams(name: string, g: number, min: number) {
  if (!Number.isInteger(g) || g < min) throw new RangeError(`${name} must be whole grams >= ${min}, got ${g}`);
}

/**
 * Balance of one melt: kg in (lots + return streams) against kg out (logs + dross + Fe + returned
 * by-products). Up to 3 % of the input is burn loss; above that, or any excess of output over
 * input, warns. The warning never blocks the melt; the excess flows into the cast's tail.
 */
export function meltBalance(input: MeltCharge): MeltLockBalance;
/** @deprecated PL5 shape (in vs out, 3 % allowance); Wave 2 lock uses the `MeltCharge` shape. */
export function meltBalance(input: { inputG: number; outputG: number }): MeltBalance;
export function meltBalance(input: MeltCharge | { inputG: number; outputG: number }): MeltBalance | MeltLockBalance {
  if ("lotsG" in input) return meltLockBalance(input);
  const { inputG, outputG } = input;
  assertGrams("inputG", inputG, 1);
  assertGrams("outputG", outputG, 0);
  const lossG = inputG - outputG;
  const bandG = Math.floor((inputG * MELT_BALANCE_WARN_BP) / 10_000);
  const allowedBurnG = lossG <= 0 ? 0 : Math.min(lossG, bandG);
  const excessBurnG = lossG > bandG ? lossG - bandG : 0;
  const warning: MeltBalanceWarning | null =
    lossG < 0 ? "out_exceeds_in" : lossG * 10_000 > inputG * MELT_BALANCE_WARN_BP ? "loss_high" : null;
  return {
    lossG,
    lossBp: Math.round((lossG * 10_000) / inputG),
    allowedBurnG,
    excessBurnG,
    warning,
  };
}

export type CastTailInput = {
  /** Σ melt inputs (lots + return streams), grams. */
  inputG: number;
  /** Σ melt by-products put back into return streams (dross, Fe, reusable metal), grams. */
  byproductG: number;
  /** Σ per-melt burn allowance (each melt: loss capped at 3 % of its input), grams. */
  allowedBurnG: number;
  /** Bundles packed from the cast (not void), grams. */
  bundlesG: number;
  /** Discard, ends and rejects the press and QC returned for the cast, grams. */
  pressReturnsG: number;
  /** Billets of the cast still in stock (ledger), grams. */
  billetsOnHandG: number;
};

export type CastTail = {
  explainedG: number;
  /** Input − explained. Positive = metal nobody can account for; negative = more explained than went in. */
  tailG: number;
  /** Tail as basis points of the input (null when the cast had no input). */
  tailBp: number | null;
  /** |tail| above 1 % of the input (any non-zero tail when there was no input). */
  needsReason: boolean;
};

/**
 * Cast close-out (digest Stage 5, Review Focus 4): of what went into the furnace, how much is
 * neither a bundle, nor returned scrap, nor still a billet, nor accepted burn loss.
 */
export function castTail(input: CastCloseTailInput): CastCloseTail;
/** @deprecated PL5 close-out shape (1 % of input); Wave 2 close uses `{ producedG, onHandG, creditedG }`. */
export function castTail(input: CastTailInput): CastTail;
export function castTail(input: CastTailInput | CastCloseTailInput): CastTail | CastCloseTail {
  if ("producedG" in input) return castCloseTail(input);
  const explainedG =
    input.byproductG + input.allowedBurnG + input.bundlesG + input.pressReturnsG + input.billetsOnHandG;
  const tailG = input.inputG - explainedG;
  return {
    explainedG,
    tailG,
    tailBp: input.inputG > 0 ? Math.round((tailG * 10_000) / input.inputG) : null,
    needsReason: Math.abs(tailG) * 10_000 > input.inputG * CAST_TAIL_REASON_BP,
  };
}

// ---------------------------------------------------------------------------
// Wave 2 (spec E4, FP-FD-08/10/13/14): lock balance, close tail, spectro verdict. Integer grams and
// ppm in; basis points out, rounded half away from zero.
// ---------------------------------------------------------------------------

/** |balance_bp| above this needs `balance_reason` (1–500) at lock (spec E4). */
export const MELT_BALANCE_REASON_BP = 300;
/** Tail above this share of produced needs `tail_reason` and a `cast_close` approval (spec E4). */
export const CAST_TAIL_APPROVAL_BP = 300;
/** Furnace chip turns amber above this share of capacity; above capacity the lock refuses. */
export const FURNACE_NEAR_BP = 9_500;
/** Caps (spec E4): one line ≤ 1e8 g, a reason ≤ 500 characters, a spectro file ≤ 1,000,000 base64 chars. */
export const FOUNDRY_LINE_MAX_G = 100_000_000;
export const FOUNDRY_REASON_MAX = 500;
export const SPECTRO_FILE_MAX_BASE64 = 1_000_000;

const roundBp = (num: number, den: number) => {
  const x = (num * 10_000) / den;
  return Math.sign(x) * Math.round(Math.abs(x));
};

/** What went into and came out of one melt, grams. `returnsG` = other charge streams returned (PL5 output kind). */
export type MeltCharge = { lotsG: number; streamsG: number; logsG: number; drossG: number; feG: number; returnsG?: number };

export type MeltLockBalance = {
  /** Σ lot kg + Σ stream kg. */
  metalInG: number;
  /** metal in − logs − dross − Fe (− returned streams). Negative = more out than in (warns). */
  burnG: number;
  /** burn ÷ metal in, bp; null when metal in is 0 (lock refused). */
  balanceBp: number | null;
  /** logs ÷ metal in, bp; null when metal in is 0. */
  yieldBp: number | null;
  /** |balance_bp| > 300: lock needs balance_reason. */
  needsReason: boolean;
  negativeBurn: boolean;
};

function meltLockBalance(c: MeltCharge): MeltLockBalance {
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined) assertGrams(k, v, 0);
  }
  const metalInG = c.lotsG + c.streamsG;
  const burnG = metalInG - c.logsG - c.drossG - c.feG - (c.returnsG ?? 0);
  if (metalInG === 0) return { metalInG, burnG, balanceBp: null, yieldBp: null, needsReason: false, negativeBurn: burnG < 0 };
  const balanceBp = roundBp(burnG, metalInG);
  return {
    metalInG,
    burnG,
    balanceBp,
    yieldBp: roundBp(c.logsG, metalInG),
    needsReason: Math.abs(balanceBp) > MELT_BALANCE_REASON_BP,
    negativeBurn: burnG < 0,
  };
}

/** Furnace capacity (FP-FD-01): over refuses the lock; near (> 95 %) shows an amber chip. */
export function furnaceLoad(metalInG: number, capacityG: number): "ok" | "near" | "over" {
  if (metalInG > capacityG) return "over";
  return metalInG * 10_000 > capacityG * FURNACE_NEAR_BP ? "near" : "ok";
}

export type CastCloseTailInput = {
  /** Σ locked log kg of the cast. */
  producedG: number;
  /** BILLET ledger on hand for the cast (item_kind billet, item_ref = cast id). */
  onHandG: number;
  /** −Σ non-melt negative billet rows (press closes and other draws), i.e. billets used. */
  creditedG: number;
};
export type CastCloseTail = { tailG: number; tailBp: number | null; needsApproval: boolean };

/**
 * Tail at cast close (spec E4): produced − on hand − credited. |tail| above 3 % of produced (any
 * non-zero tail when nothing was produced) needs `tail_reason` + approval `cast_close` (closing).
 */
function castCloseTail(input: CastCloseTailInput): CastCloseTail {
  const tailG = input.producedG - input.onHandG - input.creditedG;
  return {
    tailG,
    tailBp: input.producedG > 0 ? roundBp(tailG, input.producedG) : null,
    needsApproval: Math.abs(tailG) * 10_000 > input.producedG * CAST_TAIL_APPROVAL_BP,
  };
}

// --- Spectro ---------------------------------------------------------------

/** The eight required elements (ppm integers); Al is optional (remainder). */
export const SPECTRO_REQUIRED = ["si", "fe", "cu", "mn", "mg", "zn", "ti", "cr"] as const;
export const SPECTRO_ELEMENTS = [...SPECTRO_REQUIRED, "al"] as const;
export type SpectroElementKey = (typeof SPECTRO_ELEMENTS)[number];

/** A chemical symbol as printed ("si" → "Si", "FE" → "Fe"): final explore L10, spectro values read as symbols. */
export function elementSymbol(key: string): string {
  const k = key.trim();
  return k ? k[0]!.toUpperCase() + k.slice(1).toLowerCase() : k;
}
export const PPM_TOTAL = 1_000_000;

export type SpectroPpm = Partial<Record<SpectroElementKey, number | null>>;
export type SpectroLimit = { element: SpectroElementKey; minPpm: number | null; maxPpm: number | null };
export type SpectroVerdict = "pass" | "fail" | "incomplete";
export type SpectroReading = "pass" | "fail" | "no_limit" | "missing";

export type SpectroCheck = {
  verdict: SpectroVerdict;
  readings: Record<SpectroElementKey, SpectroReading>;
  /** Measured Al, else 1,000,000 − Σ eight (floor 0) when all eight are present, else null. */
  alPpm: number | null;
  alSource: "measured" | "balance" | null;
  sumEightPpm: number;
};

/** Thrown when Σ of the eight passes 1,000,000 ppm or a value is not a ppm integer (the attach is refused). */
export class SpectroRefusal extends RangeError {
  constructor(public readonly code: "over_million" | "invalid_ppm") {
    super(code === "over_million" ? "The eight elements add up to more than 100 %" : "Spectro values must be whole ppm from 0 to 1,000,000");
  }
}

function readingOf(ppm: number | null, limit: SpectroLimit | undefined): SpectroReading {
  if (ppm == null) return "missing";
  if (!limit || (limit.minPpm == null && limit.maxPpm == null)) return "no_limit";
  if (limit.minPpm != null && ppm < limit.minPpm) return "fail";
  if (limit.maxPpm != null && ppm > limit.maxPpm) return "fail";
  return "pass";
}

/**
 * Spectro readings and verdict against an alloy's limits (spec E4, FP-FD-10): any element outside
 * its limits ⇒ fail; else any of the eight missing ⇒ incomplete; else pass. Al: measured, or the
 * balance (1,000,000 − Σ eight, floor 0) once all eight are present; checked when it has a limit.
 */
export function spectroCheck(ppm: SpectroPpm, limits: readonly SpectroLimit[]): SpectroCheck {
  for (const el of SPECTRO_ELEMENTS) {
    const v = ppm[el];
    if (v != null && (!Number.isInteger(v) || v < 0 || v > PPM_TOTAL)) throw new SpectroRefusal("invalid_ppm");
  }
  const sumEightPpm = SPECTRO_REQUIRED.reduce((s, el) => s + (ppm[el] ?? 0), 0);
  if (sumEightPpm > PPM_TOTAL) throw new SpectroRefusal("over_million");
  const allEight = SPECTRO_REQUIRED.every((el) => ppm[el] != null);
  const measuredAl = ppm.al ?? null;
  const alPpm = measuredAl ?? (allEight ? Math.max(0, PPM_TOTAL - sumEightPpm) : null);
  const alSource = measuredAl != null ? "measured" : alPpm != null ? "balance" : null;
  const byEl = new Map(limits.map((l) => [l.element, l]));
  const readings = {} as Record<SpectroElementKey, SpectroReading>;
  for (const el of SPECTRO_REQUIRED) readings[el] = readingOf(ppm[el] ?? null, byEl.get(el));
  const alReading = readingOf(alPpm, byEl.get("al"));
  readings.al = alReading === "missing" ? "no_limit" : alReading;
  const anyFail = SPECTRO_ELEMENTS.some((el) => readings[el] === "fail");
  const verdict: SpectroVerdict = anyFail ? "fail" : allEight ? "pass" : "incomplete";
  return { verdict, readings, alPpm, alSource, sumEightPpm };
}

/** The verdict alone (`pass | fail | incomplete`); throws `SpectroRefusal` like `spectroCheck`. */
export function spectroVerdict(ppm: SpectroPpm, limits: readonly SpectroLimit[]): SpectroVerdict {
  return spectroCheck(ppm, limits).verdict;
}

/** Percent text to ppm integer: "0.45" → 4500 (spec: ppm ints; 1 % = 10,000 ppm). Null when blank or not a number. */
export function percentToPpm(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 10_000 + Number((frac + "0000").slice(0, 4));
}

/**
 * Seeded limits (spec E4, Q-FD-1: owner to confirm). ppm; null = no bound. Al is the remainder
 * (no row). 6063: Si .20–.60, Fe ≤.35, Cu ≤.10, Mn ≤.10, Mg .45–.90, Zn ≤.10, Ti ≤.10, Cr ≤.10.
 * 6061: Si .40–.80, Fe ≤.70, Cu .15–.40, Mn ≤.15, Mg .80–1.20, Zn ≤.25, Ti ≤.15, Cr .04–.35.
 */
export const ALLOY_LIMIT_SEEDS: Readonly<Record<"6063" | "6061", readonly SpectroLimit[]>> = {
  "6063": [
    { element: "si", minPpm: 2_000, maxPpm: 6_000 },
    { element: "fe", minPpm: null, maxPpm: 3_500 },
    { element: "cu", minPpm: null, maxPpm: 1_000 },
    { element: "mn", minPpm: null, maxPpm: 1_000 },
    { element: "mg", minPpm: 4_500, maxPpm: 9_000 },
    { element: "zn", minPpm: null, maxPpm: 1_000 },
    { element: "ti", minPpm: null, maxPpm: 1_000 },
    { element: "cr", minPpm: null, maxPpm: 1_000 },
  ],
  "6061": [
    { element: "si", minPpm: 4_000, maxPpm: 8_000 },
    { element: "fe", minPpm: null, maxPpm: 7_000 },
    { element: "cu", minPpm: 1_500, maxPpm: 4_000 },
    { element: "mn", minPpm: null, maxPpm: 1_500 },
    { element: "mg", minPpm: 8_000, maxPpm: 12_000 },
    { element: "zn", minPpm: null, maxPpm: 2_500 },
    { element: "ti", minPpm: null, maxPpm: 1_500 },
    { element: "cr", minPpm: 400, maxPpm: 3_500 },
  ],
};

/** Seeded furnace (Q-FD-8): F1, 6 t, 127 mm (5 inch) billets. */
export const FURNACE_SEED = { code: "F1", name: "Furnace 1", capacityG: 6_000_000, billetDiaMm: 127 } as const;

/**
 * Melt lock gate (spec E4, C18): what stops a draft from locking. The server repeats the stock
 * checks (lot remaining, grade balance, stream active) inside the write.
 */
export type MeltLockError =
  | "not_draft"
  | "no_input"
  | "no_logs"
  | "no_charging_start"
  | "casting_before_charging"
  | "over_capacity"
  | "balance_reason_missing"
  | "spectro_reason_missing"
  | "alloy_reason_missing"
  | "line_too_large";

export function meltLockGates(input: {
  status: "draft" | "locked" | "cancelled";
  inputsG: readonly number[];
  logLinesG: readonly number[];
  chargingStartMs: number | null;
  castingEndMs: number | null;
  capacityG: number | null;
  balance: MeltLockBalance;
  balanceReason?: string | null;
  spectroVerdict: SpectroVerdict | null;
  spectroReason?: string | null;
  alloyDiffersFromCast?: boolean;
  /** Reason for a melt alloy other than the cast's (kept in notes). */
  alloyReason?: string | null;
}): MeltLockError[] {
  const errors: MeltLockError[] = [];
  const ok = (s: string | null | undefined) => typeof s === "string" && s.trim().length >= 1 && s.trim().length <= FOUNDRY_REASON_MAX;
  if (input.status !== "draft") errors.push("not_draft");
  if (input.inputsG.length === 0 || input.balance.metalInG <= 0) errors.push("no_input");
  if (input.logLinesG.length === 0) errors.push("no_logs");
  if ([...input.inputsG, ...input.logLinesG].some((g) => g > FOUNDRY_LINE_MAX_G)) errors.push("line_too_large");
  if (input.chargingStartMs == null) errors.push("no_charging_start");
  else if (input.castingEndMs == null || input.castingEndMs < input.chargingStartMs) errors.push("casting_before_charging");
  if (input.capacityG != null && furnaceLoad(input.balance.metalInG, input.capacityG) === "over") errors.push("over_capacity");
  if (input.balance.needsReason && !ok(input.balanceReason)) errors.push("balance_reason_missing");
  if (input.spectroVerdict !== "pass" && !ok(input.spectroReason)) errors.push("spectro_reason_missing");
  if (input.alloyDiffersFromCast && !ok(input.alloyReason)) errors.push("alloy_reason_missing");
  return errors;
}
