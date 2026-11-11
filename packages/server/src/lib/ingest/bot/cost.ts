/**
 * Cost of a model call, in micro-USD (1 USD = 1,000,000).
 *
 * Prices are list prices per million tokens, from the claude-api skill (cached 2026-11-03).
 * They are held as micro-USD per million tokens, so 1 token costs exactly `rate / 1e6`
 * micro-USD per micro-USD-per-MTok unit and every product below is an integer.
 *
 *   Haiku 5.5   in 0.10  out 0.50   (above 100K prompt tokens: in 0.50  out 2.50)
 *               cache read 0.10x of in, cache write 1.25x of in
 *   Sonnet 5.5  in 2.00  out 10.00  cache read 0.10 USD (0.05x of in), cache write 1.25x of in
 *
 * Plan B6 says cache reads are 0.1x for both. The skill says Sonnet 5.5 reads are 0.05x
 * ($0.10 per MTok), so Sonnet follows the skill.
 */
import type { ShapeResponse, ShapeUsage } from "./client";

type Price = {
  /** micro-USD per million input tokens, for prompts of 100K tokens or fewer */
  inMicro: number;
  outMicro: number;
  cacheReadMicro: number;
  cacheWriteMicro: number;
  /** Optional second card for prompts above `longPromptTokens`. */
  long?: { inMicro: number; outMicro: number; cacheReadMicro: number; cacheWriteMicro: number };
};

export const LONG_PROMPT_TOKENS = 100_000;

const HAIKU_55: Price = {
  inMicro: 100_000,
  outMicro: 500_000,
  cacheReadMicro: 10_000,
  cacheWriteMicro: 125_000,
  long: { inMicro: 500_000, outMicro: 2_500_000, cacheReadMicro: 50_000, cacheWriteMicro: 625_000 },
};
const SONNET_55: Price = { inMicro: 2_000_000, outMicro: 10_000_000, cacheReadMicro: 100_000, cacheWriteMicro: 2_500_000 };
/** The server-side fallback for Sonnet 5.5 is Sonnet 5: same list prices, cache reads at 0.1x. */
const SONNET_5: Price = { inMicro: 2_000_000, outMicro: 10_000_000, cacheReadMicro: 200_000, cacheWriteMicro: 2_500_000 };

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": HAIKU_55,
  "claude-sonnet-5-5": SONNET_55,
  "claude-sonnet-5": SONNET_5,
};

/** Unknown models are billed at the Sonnet 5.5 card, so a surprise model never reads as free. */
export function priceFor(model: string): Price {
  return PRICES[model] ?? SONNET_55;
}

/** Half-up rounding of `tokens * rateMicroPerMTok / 1e6`. */
function part(tokens: number, rate: number): number {
  return Math.floor((tokens * rate + 500_000) / 1_000_000);
}

export function costOfUsage(model: string, usage: ShapeUsage): number {
  const price = priceFor(model);
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  const card = price.long && promptTokens > LONG_PROMPT_TOKENS ? price.long : price;
  return (
    part(usage.input, card.inMicro) +
    part(usage.output, card.outMicro) +
    part(usage.cacheRead, card.cacheReadMicro) +
    part(usage.cacheWrite, card.cacheWriteMicro)
  );
}

/**
 * Cost of one response. When the server ran a fallback model the response lists one entry per
 * attempt, and each is billed at its own model's card. Otherwise the single usage is billed at
 * `modelUsed`.
 */
export function costOfResponse(res: Pick<ShapeResponse, "usage" | "modelUsed" | "iterations">): number {
  if (res.iterations && res.iterations.length > 0) {
    return res.iterations.reduce((sum, it) => sum + costOfUsage(it.model, it.usage), 0);
  }
  return costOfUsage(res.modelUsed, res.usage);
}

/**
 * Cheap input size estimate used before a call. Three characters per token is deliberately
 * high for JSON text and covers the newer tokenizer of Haiku 5.5, which counts about 30%
 * more tokens than older models for the same text.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}
