/**
 * Which model and which attempt comes next (plan B6, "Attempt" table).
 *
 * One call per `shape.make`. The history is every earlier run of the block in this hole
 * version. Model names are the ones that actually answered, so a fallback to another Sonnet
 * still counts as Sonnet.
 *
 * | Attempt | Model | Next                                                                   |
 * | 1       | start | invalid: attempt 2 same model with errors; sample failed or refusal: Sonnet |
 * | 2       | same  | still bad: Sonnet; if already Sonnet, manual                           |
 * | 3       | Sonnet| invalid: attempt 4 with errors; refusal: manual                        |
 * | 4       | Sonnet| anything but a valid recipe that passes: manual                        |
 *
 * Read as rules: Haiku gets two tries when the answer is invalid and goes to Sonnet on any
 * other failure or after the second try. Sonnet gets a second try only when its first answer
 * was invalid. Everything else is manual.
 *
 * Two additions the plan does not list:
 *  - `no_target` is a final answer: the person maps by hand.
 *  - A transport `error` repeats the same model without moving the table. Two in a row go manual.
 */
import { type BotRunHistoryRow, countCalls } from "./caps";
import { HAIKU, SONNET, type ShapeModelId } from "./client";

export type StartInput = {
  /** Blocks of the artifact that fit no known shape. */
  noFitBlocks: number;
  columnCount: number;
};

/** Sonnet when the artifact has at least 2 no-fit blocks or the block has more than 40 columns. */
export function startModel(input: StartInput): ShapeModelId {
  return input.noFitBlocks >= 2 || input.columnCount > 40 ? SONNET : HAIKU;
}

export type Next = "done" | "retry" | "escalate" | "manual";

export type Plan = {
  next: Next;
  /** The model for the next call. Null when `next` is `done` or `manual`. */
  model: ShapeModelId | null;
  /** The attempt number of the next call. */
  attempt: number;
  /** Whether the next call carries the last attempt's error codes. */
  carryErrors: boolean;
};

const isHaiku = (model: string) => model.startsWith("claude-haiku");

export function planNext(history: readonly BotRunHistoryRow[], start: ShapeModelId): Plan {
  const calls = history.filter((h) => h.outcome !== "capped");
  const attempt = countCalls(history) + 1;
  if (calls.length === 0) return { next: "retry", model: start, attempt, carryErrors: false };

  const last = calls[calls.length - 1]!;
  if (last.outcome === "recipe") return { next: "done", model: null, attempt, carryErrors: false };
  if (last.outcome === "no_target") return { next: "manual", model: null, attempt, carryErrors: false };

  const real = calls.filter((h) => h.outcome !== "error");

  if (last.outcome === "error") {
    let trailing = 0;
    for (let i = calls.length - 1; i >= 0 && calls[i]!.outcome === "error"; i--) trailing++;
    if (trailing >= 2) return { next: "manual", model: null, attempt, carryErrors: false };
    const prev = real[real.length - 1];
    const model: ShapeModelId = prev ? (isHaiku(prev.model) ? HAIKU : SONNET) : start;
    return { next: "retry", model, attempt, carryErrors: prev?.outcome === "invalid" };
  }

  const haikuCalls = real.filter((h) => isHaiku(h.model)).length;
  const sonnetCalls = real.length - haikuCalls;

  if (isHaiku(last.model)) {
    if (last.outcome === "invalid" && haikuCalls < 2) return { next: "retry", model: HAIKU, attempt, carryErrors: true };
    return { next: "escalate", model: SONNET, attempt, carryErrors: false };
  }

  if (last.outcome === "invalid" && sonnetCalls === 1) return { next: "retry", model: SONNET, attempt, carryErrors: true };
  return { next: "manual", model: null, attempt, carryErrors: false };
}

/** The error codes to carry into the next call: those of the last real attempt. */
export function carriedErrors(history: readonly BotRunHistoryRow[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.outcome === "capped" || h.outcome === "error") continue;
    return h.errorCodes ?? [];
  }
  return [];
}
