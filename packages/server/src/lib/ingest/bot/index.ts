/**
 * The bot entry lane A calls from `ingest.shape.make` (plan B6).
 *
 * One call to `runShapeAttempt` makes at most one model call. It never writes a row of the
 * file and never lets a model number reach the database: the model's answer is a recipe, the
 * recipe is validated by lane C's `validateRecipe`, and it is applied to a sample by lane A's
 * dry run, both passed in as functions.
 */
import { type BotOutcome, type BotRunStore, checkCaps } from "./caps";
import { costOfResponse, estimateTokens } from "./cost";
import { carriedErrors, type Next, planNext, startModel } from "./escalate";
import { getShapeClient, type ShapeClientError, type ShapeModelClient, type ShapeModelId, type ShapeResponse } from "./client";
import { buildSystem, buildUserContent, type CatalogueTarget, newNonce, requestChars } from "./prompt";
import { buildSample, MAX_COLUMNS, type Sample } from "./sample";
import { botOutput, type NoTargetReason, type Recipe, schemaErrorCodes } from "./schema";

export * from "./caps";
export * from "./cost";
export * from "./escalate";
export * from "./client";
export * from "./fake";
export * from "./prompt";
export * from "./sample";
export * from "./schema";

/** Above this estimated input size the bot refuses, which keeps Haiku under its 100K price step. */
export const MAX_INPUT_TOKENS = 60_000;
export const MAX_TOKENS: Record<ShapeModelId, number> = { "claude-haiku-5-5": 8_000, "claude-sonnet-5-5": 16_000 };

/** Counts from applying a recipe to the sample rows in memory and classifying them. Lane A makes these. */
export type SampleStats = {
  rows: number;
  refused: number;
  ambiguous: number;
  conflict: number;
  /** Rows where a required field came out blank. */
  requiredBlank: number;
};

/** Plan B6, "Sample check": fails above 20% refused, 40% ambiguous plus conflict, or 30% required blank. */
export function evaluateSampleStats(s: SampleStats): { ok: boolean; codes: string[] } {
  if (s.rows <= 0) return { ok: false, codes: ["sample:no_rows"] };
  const codes: string[] = [];
  if (s.refused * 100 > s.rows * 20) codes.push("sample:refused_over_20");
  if ((s.ambiguous + s.conflict) * 100 > s.rows * 40) codes.push("sample:ambiguous_over_40");
  if (s.requiredBlank * 100 > s.rows * 30) codes.push("sample:required_blank_over_30");
  return { ok: codes.length === 0, codes };
}

export type BotBlock = {
  id: string;
  sheetName: string | null;
  title: string | null;
  headerKey: string;
  headerRow: number;
  headerRows: number;
  headers: string[];
  kinds: string[];
  columnCount: number;
};

export type RunShapeArgs = {
  /** Only `ANTHROPIC_API_KEY` is read. */
  env: { ANTHROPIC_API_KEY?: string | undefined };
  /** Lane A's store over `ingest_bot_run`. */
  store: BotRunStore;
  companyId: string;
  userId: string | null;
  candidateId: string | null;
  block: BotBlock;
  /** Raw rows of the block, as text cells. The sample is drawn from these. */
  rows: string[][];
  /** Blocks of this artifact that fit no known shape. Picks the start model. */
  noFitBlocks: number;
  /** What the target catalogue lists, from lane C. */
  catalogue: CatalogueTarget[];
  /** The person's note. At most 500 characters are sent. */
  note?: string | null;
  /** Lane C's `validateRecipe(recipe, block, "bot")`, returned as error codes. Empty means valid. */
  validate: (recipe: Recipe) => string[];
  /** Applies the recipe to the sample and up to 200 staged rows and counts the results, with no writes. */
  sampleCheck: (recipe: Recipe) => Promise<SampleStats>;
  /** When the current hole version began. Earlier runs do not count toward the block cap. */
  holeVersionSinceMs?: number;
  /** Error codes of the previous attempt, if the store did not keep them. */
  previousErrors?: string[];
  /** Overrides the client. Tests use this; `setShapeClientForTests` also works. */
  client?: ShapeModelClient;
  nowMs?: () => number;
};

export type SkipReason = "no_key" | "too_many_columns" | "sample_too_large" | "input_too_large" | "already_done" | "attempts_exhausted";

export type ShapeAttemptResult =
  /** No call was made and no run row was written. The screen opens the manual editor. */
  | { status: "skipped"; reason: SkipReason; next: "manual" | "done" }
  | {
      status: "ran";
      outcome: BotOutcome;
      attempt: number;
      /** The model that answered, or the one that would have, for a capped call. */
      model: string;
      next: Next;
      /** The valid recipe, when `outcome` is `recipe`. */
      recipe: Recipe | null;
      noTargetReason: NoTargetReason | null;
      /** Error codes of a failed attempt. Never free model text. */
      errors: string[];
      costMicroUsd: number;
      runId: string;
      capReason?: "block_calls" | "day_calls" | "day_cost";
    };

type Evaluated = {
  outcome: BotOutcome;
  recipe: Recipe | null;
  noTargetReason: NoTargetReason | null;
  errors: string[];
};

async function evaluate(res: ShapeResponse, args: RunShapeArgs): Promise<Evaluated> {
  const fail = (outcome: BotOutcome, errors: string[]): Evaluated => ({ outcome, recipe: null, noTargetReason: null, errors });
  if (res.stopReason === "refusal") return fail("refused", ["output:refusal"]);
  if (res.stopReason === "max_tokens") return fail("invalid", ["output:truncated"]);
  if (res.json === null || res.json === undefined) return fail("invalid", ["output:not_json"]);

  const parsed = botOutput.safeParse(res.json);
  if (!parsed.success) return fail("invalid", schemaErrorCodes(parsed.error));
  const result = parsed.data.result;
  if (result.kind === "no_target") return { outcome: "no_target", recipe: null, noTargetReason: result.reason, errors: [] };

  const recipe = result.recipe;
  const problems = args.validate(recipe);
  if (problems.length > 0) return fail("invalid", problems);

  let stats: SampleStats;
  try {
    stats = await args.sampleCheck(recipe);
  } catch {
    return fail("error", ["sample:check_failed"]);
  }
  const check = evaluateSampleStats(stats);
  if (!check.ok) return fail("sample_failed", check.codes);
  return { outcome: "recipe", recipe, noTargetReason: null, errors: [] };
}

export async function runShapeAttempt(args: RunShapeArgs): Promise<ShapeAttemptResult> {
  const now = args.nowMs ?? Date.now;
  const client = args.client ?? getShapeClient(args.env);
  if (!client) return { status: "skipped", reason: "no_key", next: "manual" };
  if (args.block.columnCount > MAX_COLUMNS || args.block.headers.length > MAX_COLUMNS) {
    return { status: "skipped", reason: "too_many_columns", next: "manual" };
  }

  const history = await args.store.listBlockRuns({
    companyId: args.companyId,
    blockId: args.block.id,
    purpose: "shape",
    sinceMs: args.holeVersionSinceMs,
  });
  const start = startModel({ noFitBlocks: args.noFitBlocks, columnCount: args.block.columnCount });
  const plan = planNext(history.filter((h) => h.outcome !== "capped").length === 0 ? [] : history, start);
  if (plan.next === "done") return { status: "skipped", reason: "already_done", next: "done" };
  if (plan.next === "manual" || plan.model === null) return { status: "skipped", reason: "attempts_exhausted", next: "manual" };
  const model = plan.model;

  const sample: Sample | { refused: string } = buildSample(args.block, args.rows);
  if ("refused" in sample) return { status: "skipped", reason: sample.refused as SkipReason, next: "manual" };

  const errors = plan.carryErrors ? (args.previousErrors ?? carriedErrors(history)) : [];
  const system = buildSystem(args.catalogue);
  const content = buildUserContent({
    nonce: newNonce(),
    sheet: args.block.sheetName,
    title: args.block.title,
    headerKey: args.block.headerKey,
    headerRow: args.block.headerRow,
    headerRows: args.block.headerRows,
    sample,
    note: args.note ?? null,
    errors,
  });
  if (estimateTokens(requestChars(system, content)) > MAX_INPUT_TOKENS) {
    return { status: "skipped", reason: "input_too_large", next: "manual" };
  }

  const base = {
    companyId: args.companyId,
    blockId: args.block.id,
    candidateId: args.candidateId,
    purpose: "shape" as const,
    attempt: plan.attempt,
    createdBy: args.userId,
  };

  const capReason = await checkCaps({ store: args.store, companyId: args.companyId, history, nowMs: now() });
  if (capReason) {
    const runId = await args.store.insertRun({
      ...base,
      model,
      outcome: "capped",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicroUsd: 0,
      durationMs: 0,
      createdAtMs: now(),
      errorCodes: [`cap:${capReason}`],
    });
    return { status: "ran", outcome: "capped", attempt: plan.attempt, model, next: "manual", recipe: null, noTargetReason: null, errors: [`cap:${capReason}`], costMicroUsd: 0, runId, capReason };
  }

  const started = now();
  let res: ShapeResponse | null = null;
  let clientError: ShapeClientError | null = null;
  try {
    res = await client.call({
      model,
      system,
      messages: [{ role: "user", content }],
      maxTokens: MAX_TOKENS[model],
      fallbacks: model === "claude-sonnet-5-5",
      purpose: "shape",
    });
  } catch (err) {
    clientError = err as ShapeClientError;
  }

  let evaluated: Evaluated;
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let usedModel: string = model;
  let cost = 0;
  let ms = now() - started;
  if (res) {
    evaluated = await evaluate(res, args);
    usage = res.usage;
    usedModel = res.modelUsed;
    cost = costOfResponse(res);
    ms = res.ms;
  } else {
    const kind = typeof clientError?.kind === "string" ? clientError.kind : "unknown";
    evaluated = { outcome: "error", recipe: null, noTargetReason: null, errors: [`client:${kind}`] };
  }

  const runId = await args.store.insertRun({
    ...base,
    model: usedModel,
    outcome: evaluated.outcome,
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costMicroUsd: cost,
    durationMs: ms,
    createdAtMs: now(),
    errorCodes: evaluated.errors.length > 0 ? evaluated.errors : null,
  });

  const after = planNext(
    [...history, { attempt: plan.attempt, model: usedModel, outcome: evaluated.outcome, errorCodes: evaluated.errors }],
    start,
  );
  return {
    status: "ran",
    outcome: evaluated.outcome,
    attempt: plan.attempt,
    model: usedModel,
    next: after.next,
    recipe: evaluated.recipe,
    noTargetReason: evaluated.noTargetReason,
    errors: evaluated.errors,
    costMicroUsd: cost,
    runId,
  };
}
