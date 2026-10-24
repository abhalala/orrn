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
export function meltBalance(input: { inputG: number; outputG: number }): MeltBalance {
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
export function castTail(input: CastTailInput): CastTail {
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
