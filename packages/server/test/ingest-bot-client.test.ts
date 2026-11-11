/**
 * The SDK client against a stub fetch. No test here reaches the network: the SDK's `fetch`
 * option is replaced, so the request is built, serialised and parsed by the real SDK and
 * answered by this file.
 */
import { describe, expect, test } from "bun:test";

import { AnthropicShapeClient, ShapeClientError, type ShapeRequest } from "../src/lib/ingest/bot";

type Seen = { url: string; headers: Headers; body: Record<string, any> };

function sse(events: [string, unknown][]): Response {
  const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stubStream(text: string, over: { stop?: string; model?: string; usage?: Record<string, unknown>; iterations?: unknown[] } = {}) {
  const seen: Seen[] = [];
  const model = over.model ?? "claude-haiku-5-5";
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const startUsage = { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 };
    return sse([
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: startUsage } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: over.stop ?? "end_turn", stop_sequence: null }, usage: { output_tokens: 25, ...over.usage, ...(over.iterations ? { iterations: over.iterations } : {}) } }],
      ["message_stop", { type: "message_stop" }],
    ]);
  }) as typeof fetch;
  return { seen, fetchStub };
}

const req = (over: Partial<ShapeRequest> = {}): ShapeRequest => ({
  model: "claude-haiku-5-5",
  system: [
    { text: "instructions", cache: false },
    { text: "catalogue", cache: true },
  ],
  messages: [{ role: "user", content: [{ type: "text", text: "<file_data_x>{}</file_data_x>" }] }],
  maxTokens: 8_000,
  fallbacks: false,
  purpose: "shape",
  ...over,
});

describe("AnthropicShapeClient call shape", () => {
  test("Haiku: streamed, structured output, cache breakpoint, no thinking, no forced tool, no fallbacks", async () => {
    const { seen, fetchStub } = stubStream(JSON.stringify({ result: { kind: "no_target", reason: "not_a_table" } }));
    const client = new AnthropicShapeClient({ apiKey: "sk-test-123", fetch: fetchStub, baseURL: "https://stub.invalid" });
    const res = await client.call(req());

    expect(seen).toHaveLength(1);
    const { url, headers, body } = seen[0]!;
    expect(url).toBe("https://stub.invalid/v1/messages");
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.max_tokens).toBe(8_000);
    expect(body.stream).toBe(true);
    expect(body.thinking).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
    expect(headers.get("anthropic-beta")).toBeNull();
    // Structured output.
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.type).toBe("object");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    // Only the last system block carries the cache breakpoint.
    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
    // The key is sent as a credential header and is not in the body.
    expect(JSON.stringify(body)).not.toContain("sk-test-123");
    expect(headers.get("authorization") ?? headers.get("x-api-key")).toContain("sk-test-123");

    expect(res.json).toEqual({ result: { kind: "no_target", reason: "not_a_table" } });
    expect(res.stopReason).toBe("end_turn");
    expect(res.modelUsed).toBe("claude-haiku-5-5");
    expect(res.usage).toEqual({ input: 100, output: 25, cacheRead: 40, cacheWrite: 0 });
    expect(res.iterations).toBeUndefined();
  });

  test("Sonnet: beta fallbacks with the default mode, same output config, still streamed", async () => {
    const { seen, fetchStub } = stubStream("{}", { model: "claude-sonnet-5-5" });
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    await client.call(req({ model: "claude-sonnet-5-5", maxTokens: 16_000, fallbacks: true }));
    const { headers, body } = seen[0]!;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(16_000);
    expect(body.stream).toBe(true);
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.output_config.format.type).toBe("json_schema");
  });

  test("vision purpose sends the vision schema", async () => {
    const { seen, fetchStub } = stubStream("{}");
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    await client.call(req({ purpose: "vision" }));
    expect(Object.keys(seen[0]!.body.output_config.format.schema.properties)).toEqual(["tables"]);
  });

  test("a refusal carries no JSON even when text arrived", async () => {
    const { fetchStub } = stubStream(JSON.stringify({ result: { kind: "no_target", reason: "unreadable" } }), { stop: "refusal" });
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    const res = await client.call(req());
    expect(res.stopReason).toBe("refusal");
    expect(res.json).toBeNull();
  });

  test("text that is not JSON gives json null, not a throw", async () => {
    const { fetchStub } = stubStream("this is not json");
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    expect((await client.call(req())).json).toBeNull();
  });

  test("valid JSON that fails the schema comes back as json, not as a thrown error", async () => {
    const { fetchStub } = stubStream(JSON.stringify({ result: { kind: "recipe" } }));
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    expect((await client.call(req())).json).toEqual({ result: { kind: "recipe" } });
  });

  test("a fallback run lists one usage entry per attempt and reports the model that answered", async () => {
    const entry = (type: string, model: string, input: number, output: number) => ({ type, model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null });
    const { fetchStub } = stubStream("{}", {
      model: "claude-sonnet-5",
      iterations: [entry("message", "claude-sonnet-5-5", 900, 0), entry("fallback_message", "claude-sonnet-5", 900, 300)],
    });
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: fetchStub, baseURL: "https://stub.invalid" });
    const res = await client.call(req({ model: "claude-sonnet-5-5", fallbacks: true }));
    expect(res.modelUsed).toBe("claude-sonnet-5");
    expect(res.iterations).toEqual([
      { model: "claude-sonnet-5-5", usage: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { model: "claude-sonnet-5", usage: { input: 900, output: 300, cacheRead: 0, cacheWrite: 0 } },
    ]);
  });
});

describe("AnthropicShapeClient errors", () => {
  const failing = (status: number) =>
    (async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "SECRET-DETAIL sk-leak" } }), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  for (const [status, kind] of [[400, "bad_request"], [401, "auth"], [403, "auth"]] as const) {
    test(`HTTP ${status} becomes ${kind}, and the message holds no server text`, async () => {
      const client = new AnthropicShapeClient({ apiKey: "sk", fetch: failing(status), baseURL: "https://stub.invalid" });
      const err = await client.call(req()).catch((e) => e);
      expect(err).toBeInstanceOf(ShapeClientError);
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
      expect(err.message).not.toContain("SECRET-DETAIL");
    });
  }

  test("a dropped connection becomes a network error", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const client = new AnthropicShapeClient({ apiKey: "sk", fetch: down, baseURL: "https://stub.invalid", timeoutMs: 1_000 });
    const err = await client.call(req()).catch((e) => e);
    expect(err).toBeInstanceOf(ShapeClientError);
    expect(["network", "timeout"]).toContain(err.kind);
  });
});
