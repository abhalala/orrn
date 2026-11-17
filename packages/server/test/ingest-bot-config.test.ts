/**
 * Where the model helper gets its route: the key, an optional proxy base URL, and an optional
 * Cloudflare Access service token. No test here reaches the network: the SDK's `fetch` is a stub.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  AnthropicShapeClient,
  botReady,
  getShapeClient,
  resetShapeConfigLogForTests,
  resolveShapeConfig,
  setShapeClientForTests,
  shapeBotReady,
} from "../src/lib/ingest/bot";
import { anthropicEnv } from "../src/lib/ingest/engines";

const KEY = "sk-cpa-key-111";
const ID = "access-id-222.access";
const SECRET = "access-secret-333";

type Seen = { url: string; headers: Headers };

function sse(): Response {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{}" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stub() {
  const seen: Seen[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return sse();
  }) as typeof fetch;
  return { seen, fetchStub };
}

const request = {
  model: "claude-haiku-5-5" as const,
  system: [{ text: "s", cache: false }],
  messages: [{ role: "user" as const, content: "x" }],
  maxTokens: 100,
  fallbacks: false,
  purpose: "shape" as const,
};

let savedBase: string | undefined;
beforeEach(() => {
  setShapeClientForTests(null);
  resetShapeConfigLogForTests();
  // The SDK reads this variable itself. A developer shell must not decide what a test sees.
  savedBase = process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
});
afterEach(() => {
  setShapeClientForTests(null);
  if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedBase;
});

describe("resolveShapeConfig", () => {
  test("nothing set: off, and no log line", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveShapeConfig({})).toEqual({ ok: false, reason: "not_configured" });
    expect(botReady({})).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("a key alone is the direct route", () => {
    expect(resolveShapeConfig({ ANTHROPIC_API_KEY: ` ${KEY} ` })).toEqual({ ok: true, apiKey: KEY, baseURL: null, accessHeaders: null, route: "direct" });
  });

  test("a key and a base URL is the proxy route, with no Access headers", () => {
    expect(resolveShapeConfig({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: " https://models.orrn.in " })).toEqual({
      ok: true,
      apiKey: KEY,
      baseURL: "https://models.orrn.in",
      accessHeaders: null,
      route: "base_url",
    });
  });

  test("both Access values give both headers", () => {
    const cfg = resolveShapeConfig({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in", MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET });
    expect(cfg).toMatchObject({ ok: true, accessHeaders: { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET } });
  });

  test("blank values count as unset", () => {
    expect(resolveShapeConfig({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "  ", MODEL_ACCESS_CLIENT_ID: "", MODEL_ACCESS_CLIENT_SECRET: " " })).toMatchObject({ ok: true, baseURL: null, accessHeaders: null, route: "direct" });
  });

  for (const [name, env] of [
    ["id without secret", { MODEL_ACCESS_CLIENT_ID: ID }],
    ["secret without id", { MODEL_ACCESS_CLIENT_SECRET: SECRET }],
  ] as const) {
    test(`${name}: helper off, one clear log line, no values in it`, () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      const full = { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in", ...env };
      expect(resolveShapeConfig(full)).toEqual({ ok: false, reason: "incomplete_access" });
      expect(botReady(full)).toBe(false);
      expect(shapeBotReady(full)).toBe(false);
      expect(getShapeClient(full)).toBeNull();
      // Asked many times, logged once.
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain("MODEL_ACCESS_CLIENT_ID");
      expect(line).toContain("MODEL_ACCESS_CLIENT_SECRET");
      for (const v of [KEY, ID, SECRET, "models.orrn.in"]) expect(line).not.toContain(v);
      warn.mockRestore();
    });
  }

  test("a base URL or Access pair without a key: helper off, logged once", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const env = { ANTHROPIC_BASE_URL: "https://models.orrn.in", MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET };
    expect(resolveShapeConfig(env)).toEqual({ ok: false, reason: "no_key_with_route" });
    expect(botReady(env)).toBe(false);
    expect(botReady(env)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain("ANTHROPIC_API_KEY");
    for (const v of [ID, SECRET, "models.orrn.in"]) expect(line).not.toContain(v);
    warn.mockRestore();
  });

  test("a test client still wins over a broken config", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    setShapeClientForTests({ call: async () => { throw new Error("unused"); } });
    expect(shapeBotReady({ MODEL_ACCESS_CLIENT_ID: ID })).toBe(true);
    warn.mockRestore();
  });
});

describe("the engine reads all four names", () => {
  test("anthropicEnv passes the four names through and drops unset ones", async () => {
    const mod = await import("cloudflare:workers");
    const e = mod.env as unknown as Record<string, unknown>;
    const saved = { ...e };
    try {
      for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MODEL_ACCESS_CLIENT_ID", "MODEL_ACCESS_CLIENT_SECRET"]) delete e[k];
      expect(anthropicEnv()).toEqual({});
      e.ANTHROPIC_API_KEY = KEY;
      e.ANTHROPIC_BASE_URL = "https://models.orrn.in";
      e.MODEL_ACCESS_CLIENT_ID = ID;
      e.MODEL_ACCESS_CLIENT_SECRET = SECRET;
      expect(anthropicEnv()).toEqual({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in", MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET });
    } finally {
      for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MODEL_ACCESS_CLIENT_ID", "MODEL_ACCESS_CLIENT_SECRET"]) {
        if (k in saved) e[k] = saved[k];
        else delete e[k];
      }
    }
  });
});

describe("the client built from the config", () => {
  test("direct route: Anthropic URL, key header, no Access headers", async () => {
    const { seen, fetchStub } = stub();
    const client = getShapeClient({ ANTHROPIC_API_KEY: KEY }, { fetch: fetchStub })!;
    await client.call(request);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.headers.get("x-api-key")).toBeNull();
    expect(seen[0]!.headers.get("cf-access-client-id")).toBeNull();
    expect(seen[0]!.headers.get("cf-access-client-secret")).toBeNull();
  });

  test("base URL without Access values: proxy URL, key in both headers, no Access headers", async () => {
    const { seen, fetchStub } = stub();
    const client = getShapeClient({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in" }, { fetch: fetchStub })!;
    await client.call(request);
    expect(seen[0]!.url).toBe("https://models.orrn.in/v1/messages");
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.headers.get("x-api-key")).toBe(KEY);
    expect(seen[0]!.headers.get("cf-access-client-id")).toBeNull();
    expect(seen[0]!.headers.get("cf-access-client-secret")).toBeNull();
  });

  test("base URL with both Access values: every request carries both headers", async () => {
    const { seen, fetchStub } = stub();
    const client = getShapeClient(
      { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in", MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET },
      { fetch: fetchStub },
    )!;
    await client.call(request);
    await client.call(request);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.url).toBe("https://models.orrn.in/v1/messages");
      expect(s.headers.get("authorization")).toBe(`Bearer ${KEY}`);
      expect(s.headers.get("x-api-key")).toBe(KEY);
      expect(s.headers.get("cf-access-client-id")).toBe(ID);
      expect(s.headers.get("cf-access-client-secret")).toBe(SECRET);
    }
  });

  test("the constructor takes the headers directly too", async () => {
    const { seen, fetchStub } = stub();
    const client = new AnthropicShapeClient({ apiKey: KEY, baseURL: "https://models.orrn.in", headers: { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET }, fetch: fetchStub });
    await client.call(request);
    expect(seen[0]!.headers.get("cf-access-client-id")).toBe(ID);
  });
});
