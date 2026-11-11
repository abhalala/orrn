/**
 * The model client behind one small interface (plan B6, "Fake client").
 *
 * `AnthropicShapeClient` wraps `@anthropic-ai/sdk`. It runs in the Worker runtime: proven in
 * Miniflare (workerd) with a stub outbound service, see the lane D report. Everything else in
 * `bot/` talks to `ShapeModelClient`, so tests use `FakeShapeClient` and never the network.
 *
 * Call shape, chosen from the claude-api skill:
 *  - streaming with `.finalMessage()`, so a long answer never hits a request timeout;
 *  - structured output through `output_config.format` built by `zodOutputFormat`;
 *  - thinking and effort left at the model defaults. `thinking: disabled` is a 400 on
 *    Sonnet 5.5 and a forced `tool_choice` is a 400 too, so neither is ever sent;
 *  - Haiku 5.5 has no server-side fallback, so Haiku calls carry no `fallbacks`;
 *  - Sonnet 5.5 calls go through `client.beta.messages` with the beta
 *    `server-side-fallback-2026-07-01` and `fallbacks: "default"`;
 *  - the last system block carries `cache_control: { type: "ephemeral" }`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { botOutput, visionOutput } from "./schema";

export const HAIKU = "claude-haiku-5-5" as const;
export const SONNET = "claude-sonnet-5-5" as const;
export type ShapeModelId = typeof HAIKU | typeof SONNET;

export type ShapePurpose = "shape" | "vision";

export type ShapeRequest = {
  model: ShapeModelId;
  system: { text: string; cache: boolean }[];
  messages: { role: "user" | "assistant"; content: unknown }[];
  maxTokens: number;
  fallbacks: boolean;
  purpose: ShapePurpose;
};

export type ShapeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ShapeResponse = {
  /** `end_turn`, `max_tokens`, `refusal`, or another value the API sent. */
  stopReason: string;
  /** The answer parsed as JSON, or null when there was no text or it was not JSON. */
  json: unknown | null;
  /** The model that produced the answer. Fallbacks may change it. */
  modelUsed: string;
  usage: ShapeUsage;
  ms: number;
  /**
   * One entry per model attempt when the server ran a fallback. Cost is summed over these,
   * each at its own model's prices. Absent when one model answered.
   */
  iterations?: { model: string; usage: ShapeUsage }[];
};

export interface ShapeModelClient {
  call(req: ShapeRequest): Promise<ShapeResponse>;
}

export type ShapeClientErrorKind = "timeout" | "network" | "rate_limit" | "auth" | "bad_request" | "server" | "unknown";

/** Thrown by a client when no answer came back. The message never contains the key. */
export class ShapeClientError extends Error {
  constructor(
    readonly kind: ShapeClientErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShapeClientError";
  }
}

/** Output token caps per model (plan B6). Thinking counts toward these. */
export const MAX_TOKENS: Record<ShapeModelId, number> = { "claude-haiku-5-5": 8_000, "claude-sonnet-5-5": 16_000 };

export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_RETRIES = 1;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type AnthropicShapeClientOptions = {
  apiKey: string;
  /** Tests point this at a stub. Production leaves it unset. */
  baseURL?: string;
  /** Tests inject a stub fetch. Production leaves it unset. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function toUsage(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ShapeUsage {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

function mapError(err: unknown): ShapeClientError {
  if (err instanceof ShapeClientError) return err;
  // Order matters: the timeout class extends the connection class.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ShapeClientError("timeout", "The model call timed out.");
  if (err instanceof Anthropic.APIConnectionError) return new ShapeClientError("network", "The model could not be reached.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ShapeClientError("auth", "The model key was refused.", err.status);
  }
  if (err instanceof Anthropic.RateLimitError) return new ShapeClientError("rate_limit", "The model is rate limited.", err.status);
  if (err instanceof Anthropic.BadRequestError) return new ShapeClientError("bad_request", "The model refused the request shape.", err.status);
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return new ShapeClientError(status !== undefined && status >= 500 ? "server" : "unknown", "The model call failed.", status);
  }
  return new ShapeClientError("unknown", "The model call failed.");
}

/**
 * The JSON schema the API is given for a purpose. `zodOutputFormat` also returns a `parse`
 * function, and the SDK calls it inside `finalMessage()` and throws when the answer does not
 * fit. We want the raw answer instead: an answer that fails the schema is an `invalid` run that
 * can retry with error codes, not a transport error. So only `type` and `schema` are sent
 * on, and `index.ts` validates the JSON itself.
 */
const formats = new Map<ShapePurpose, { type: "json_schema"; schema: Record<string, unknown> }>();
function outputFormat(purpose: ShapePurpose) {
  let f = formats.get(purpose);
  if (!f) {
    const full = zodOutputFormat(purpose === "vision" ? visionOutput : botOutput);
    f = { type: "json_schema", schema: full.schema as Record<string, unknown> };
    formats.set(purpose, f);
  }
  return f;
}

function parseJson(text: string): unknown | null {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class AnthropicShapeClient implements ShapeModelClient {
  private readonly sdk: Anthropic;

  constructor(opts: AnthropicShapeClientOptions) {
    this.sdk = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async call(req: ShapeRequest): Promise<ShapeResponse> {
    const started = Date.now();
    const format = outputFormat(req.purpose);
    const system = req.system.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    const messages = req.messages as Anthropic.MessageParam[];
    try {
      if (req.fallbacks) {
        const msg = await this.sdk.beta.messages
          .stream({
            model: req.model,
            max_tokens: req.maxTokens,
            system,
            messages: messages as never,
            output_config: { format },
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          })
          .finalMessage();
        const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const iterations = (msg.usage.iterations ?? []).flatMap((it) =>
          it.type === "message" || it.type === "fallback_message"
            ? [{ model: it.model ?? msg.model, usage: toUsage(it) }]
            : [],
        );
        return {
          stopReason: msg.stop_reason ?? "unknown",
          json: msg.stop_reason === "refusal" ? null : parseJson(text),
          modelUsed: msg.model,
          usage: toUsage(msg.usage),
          ms: Date.now() - started,
          ...(iterations.length > 0 ? { iterations } : {}),
        };
      }
      const msg = await this.sdk.messages
        .stream({
          model: req.model,
          max_tokens: req.maxTokens,
          system,
          messages,
          output_config: { format },
        })
        .finalMessage();
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return {
        stopReason: msg.stop_reason ?? "unknown",
        json: msg.stop_reason === "refusal" ? null : parseJson(text),
        modelUsed: msg.model,
        usage: toUsage(msg.usage),
        ms: Date.now() - started,
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}

/** True when the environment holds a model key. Lane A's `status.botReady` is this. */
export function botReady(env: { ANTHROPIC_API_KEY?: string | undefined }): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.trim() !== "";
}

let testClient: ShapeModelClient | null = null;

/** Tests and the e2e seed set a fake here. Pass null to clear it. */
export function setShapeClientForTests(client: ShapeModelClient | null): void {
  testClient = client;
}

/**
 * The client for this environment. A test client wins, so the fake works with no key.
 * Returns null when there is neither a test client nor a key.
 */
export function getShapeClient(env: { ANTHROPIC_API_KEY?: string | undefined }): ShapeModelClient | null {
  if (testClient) return testClient;
  if (!botReady(env)) return null;
  return new AnthropicShapeClient({ apiKey: env.ANTHROPIC_API_KEY!.trim() });
}

/** Whether the bot can run: a test client is set, or a key exists. */
export function shapeBotReady(env: { ANTHROPIC_API_KEY?: string | undefined }): boolean {
  return testClient !== null || botReady(env);
}
