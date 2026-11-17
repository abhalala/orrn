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
 *  - Haiku 5.5 and Sonnet 5.5 are the only models, and both take the same plain
 *    `client.messages` call. There is no server-side fallback: it could answer with another
 *    model, and the plant proxy would not honour it. Every call names one of the two ids exactly
 *    and an answer from any other model is refused (`bad_model`);
 *  - the route is the SDK default (Anthropic) or `ANTHROPIC_BASE_URL` (the plant proxy), with
 *    the Cloudflare Access pair as default headers, see `resolveShapeConfig`;
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
  purpose: ShapePurpose;
};

export type ShapeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ShapeResponse = {
  /** `end_turn`, `max_tokens`, `refusal`, or another value the API sent. */
  stopReason: string;
  /** The answer parsed as JSON, or null when there was no text or it was not JSON. */
  json: unknown | null;
  /**
   * The model that produced the answer. The client reports the canonical id when the server sent a
   * dated form of one of the two allowed ids, and the raw name otherwise. Callers refuse any name
   * `canonicalShapeModel` does not know.
   */
  modelUsed: string;
  usage: ShapeUsage;
  ms: number;
};

export interface ShapeModelClient {
  call(req: ShapeRequest): Promise<ShapeResponse>;
}

export type ShapeClientErrorKind = "timeout" | "network" | "rate_limit" | "auth" | "bad_request" | "server" | "bad_model" | "unknown";

/**
 * The allowed model id for a name the server sent back, or null. Exact ids pass, and so does an id
 * with an eight-digit date suffix (`claude-haiku-5-5-20261001`), which some servers send for an alias.
 * `claude-sonnet-5` and every other name are null.
 */
export function canonicalShapeModel(name: string): ShapeModelId | null {
  for (const id of [HAIKU, SONNET]) {
    if (name === id || (name.startsWith(`${id}-`) && /^\d{8}$/.test(name.slice(id.length + 1)))) return id;
  }
  return null;
}

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

export type AnthropicShapeClientOptions = {
  apiKey: string;
  /** The proxy origin (the SDK adds `/v1/messages`). Unset = the SDK default, Anthropic direct. */
  baseURL?: string;
  /** Extra headers on every request: the Access token pair, and `x-api-key` on the proxy route. */
  headers?: Record<string, string>;
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
    // A redirect is how Cloudflare Access sends a caller without a valid service token to its login page.
    if (status !== undefined && status >= 300 && status < 400) {
      return new ShapeClientError("auth", "The model route sent a redirect: the access token was not accepted.", status);
    }
    return new ShapeClientError(status !== undefined && status >= 500 ? "server" : "unknown", "The model call failed.", status);
  }
  // The SDK's own error for a 200 that was not a model stream (an HTML page from a gateway or a login page).
  if (err instanceof Anthropic.AnthropicError) return new ShapeClientError("server", "The model route did not return a model answer.");
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
      ...(opts.headers ? { defaultHeaders: opts.headers } : {}),
      // Never follow a redirect from a proxy: a login page is not an answer, and the 3xx maps to `auth`.
      ...(opts.baseURL ? { fetchOptions: { redirect: "manual" as const } } : {}),
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
        modelUsed: canonicalShapeModel(msg.model) ?? msg.model,
        usage: toUsage(msg.usage),
        ms: Date.now() - started,
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}

/**
 * The four names the helper reads. Only `ANTHROPIC_API_KEY` is needed for the direct route.
 * `ANTHROPIC_BASE_URL` points the SDK at a proxy (the plant's CLIProxyAPI behind Cloudflare Access)
 * and is an origin only, with no path. The two `MODEL_ACCESS_*` names are the Access service token:
 * both or neither.
 */
export type ShapeEnv = {
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_BASE_URL?: string | undefined;
  MODEL_ACCESS_CLIENT_ID?: string | undefined;
  MODEL_ACCESS_CLIENT_SECRET?: string | undefined;
};

export type ShapeOffReason = "not_configured" | "incomplete_access" | "no_key_with_route" | "access_without_base_url";

export type ShapeConfig =
  | {
      ok: true;
      apiKey: string;
      /** Null = the SDK default (Anthropic direct). */
      baseURL: string | null;
      /** Null unless both Access values are set. */
      accessHeaders: { "CF-Access-Client-Id": string; "CF-Access-Client-Secret": string } | null;
      route: "direct" | "base_url";
    }
  | { ok: false; reason: ShapeOffReason };

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/**
 * One place that reads the environment. Off means: nothing set, one Access value without the
 * other, a base URL or Access pair with no key, or an Access pair with no base URL. Nothing here ever returns or logs a value
 * in an error: `reportShapeConfig` names variables, never what they hold.
 */
export function resolveShapeConfig(env: ShapeEnv): ShapeConfig {
  const apiKey = clean(env.ANTHROPIC_API_KEY);
  const baseURL = clean(env.ANTHROPIC_BASE_URL);
  const id = clean(env.MODEL_ACCESS_CLIENT_ID);
  const secret = clean(env.MODEL_ACCESS_CLIENT_SECRET);
  if ((id === "") !== (secret === "")) return { ok: false, reason: "incomplete_access" };
  if (apiKey === "") {
    return { ok: false, reason: baseURL !== "" || id !== "" ? "no_key_with_route" : "not_configured" };
  }
  // The Access pair belongs to the proxy. Never send it to the default (Anthropic) host.
  if (id !== "" && baseURL === "") return { ok: false, reason: "access_without_base_url" };
  return {
    ok: true,
    apiKey,
    baseURL: baseURL === "" ? null : baseURL,
    accessHeaders: id !== "" ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : null,
    route: baseURL === "" ? "direct" : "base_url",
  };
}

const OFF_LINES: Record<Exclude<ShapeOffReason, "not_configured">, string> = {
  incomplete_access:
    "ingest model helper is off: set both MODEL_ACCESS_CLIENT_ID and MODEL_ACCESS_CLIENT_SECRET, or neither.",
  no_key_with_route:
    "ingest model helper is off: ANTHROPIC_BASE_URL or MODEL_ACCESS_CLIENT_ID is set but ANTHROPIC_API_KEY is not.",
  access_without_base_url:
    "ingest model helper is off: MODEL_ACCESS_CLIENT_ID and MODEL_ACCESS_CLIENT_SECRET are set but ANTHROPIC_BASE_URL is not.",
};

const logged = new Set<string>();

/** For tests: forget which off lines were already printed. */
export function resetShapeConfigLogForTests(): void {
  logged.clear();
}

/** Prints the reason once per isolate per reason. Variable names only, never values. */
function reportShapeConfig(cfg: ShapeConfig): void {
  if (cfg.ok || cfg.reason === "not_configured" || logged.has(cfg.reason)) return;
  logged.add(cfg.reason);
  console.warn(OFF_LINES[cfg.reason]);
}

/** True when the environment holds a usable route to the model. Lane A's `status.botReady` is this. */
export function botReady(env: ShapeEnv): boolean {
  const cfg = resolveShapeConfig(env);
  reportShapeConfig(cfg);
  return cfg.ok;
}

let testClient: ShapeModelClient | null = null;

/** Tests and the e2e seed set a fake here. Pass null to clear it. */
export function setShapeClientForTests(client: ShapeModelClient | null): void {
  testClient = client;
}

/**
 * The client for this environment. A test client wins, so the fake works with no key.
 * Returns null when there is neither a test client nor a usable config. `opts.fetch` is for tests.
 */
export function getShapeClient(env: ShapeEnv, opts: { fetch?: typeof fetch } = {}): ShapeModelClient | null {
  if (testClient) return testClient;
  const cfg = resolveShapeConfig(env);
  reportShapeConfig(cfg);
  if (!cfg.ok) return null;
  // This SDK sends the key as `Authorization: Bearer`. A proxy (CLIProxyAPI) is probed and known to
  // accept `x-api-key`, so on the proxy route the key goes out in that header as well.
  const headers = { ...(cfg.accessHeaders ?? {}), ...(cfg.baseURL ? { "x-api-key": cfg.apiKey } : {}) };
  return new AnthropicShapeClient({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

/** Whether the bot can run: a test client is set, or the config is usable. */
export function shapeBotReady(env: ShapeEnv): boolean {
  return testClient !== null || botReady(env);
}
