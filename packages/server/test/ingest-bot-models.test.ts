/**
 * Only Haiku 5.5 or Sonnet 5.5, nothing else, through a stub fetch. The real SDK builds and parses
 * every request here, so what the stub sees is what would go to the proxy. No test reaches the network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getShapeClient, runShapeAttempt, setShapeClientForTests } from "../src/lib/ingest/bot";
import { baseArgs, recipeAnswer } from "./ingest-bot-fixture";

const KEY = "sk-cpa-key-111";
const ID = "access-id-222.access";
const SECRET = "access-secret-333";
const PROXY_ENV = { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://models.orrn.in", MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET };

type Seen = { url: string; headers: Headers; body: Record<string, any> };

/** Answers every call with the given JSON, from the model the request asked for unless told otherwise. */
function stub(json: unknown, answerAs?: string) {
  const seen: Seen[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seen.push({ url: String(input), headers: new Headers(init?.headers), body });
    const model = answerAs ?? body.model;
    const events: [string, unknown][] = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(json) } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 200 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { seen, fetchStub };
}

let savedBase: string | undefined;
beforeEach(() => {
  setShapeClientForTests(null);
  savedBase = process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
});
afterEach(() => {
  if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedBase;
});

function expectOnlyThisModel(s: Seen, model: string) {
  expect(s.body.model).toBe(model);
  expect("fallbacks" in s.body).toBe(false);
  expect(JSON.stringify(s.body)).not.toContain("fallback");
  expect(s.headers.get("anthropic-beta")).toBeNull();
  expect(s.url).not.toContain("beta");
}

describe("the request that leaves the helper", () => {
  for (const [name, noFitBlocks, model] of [
    ["Haiku (the default start)", 0, "claude-haiku-5-5"],
    ["Sonnet (2 unknown sheets)", 2, "claude-sonnet-5-5"],
  ] as const) {
    test(`${name}: exact model id, no fallbacks, no beta header, Access headers when configured`, async () => {
      const { seen, fetchStub } = stub(recipeAnswer());
      const client = getShapeClient(PROXY_ENV, { fetch: fetchStub })!;
      const args = baseArgs({ client, noFitBlocks, env: PROXY_ENV });
      const r = await runShapeAttempt(args);
      expect(r).toMatchObject({ status: "ran", outcome: "recipe", model });
      expect(seen).toHaveLength(1);
      expectOnlyThisModel(seen[0]!, model);
      expect(seen[0]!.url).toBe("https://models.orrn.in/v1/messages");
      expect(seen[0]!.headers.get("cf-access-client-id")).toBe(ID);
      expect(seen[0]!.headers.get("cf-access-client-secret")).toBe(SECRET);
    });

    test(`${name}: no Access headers when none are configured`, async () => {
      const env = { ANTHROPIC_API_KEY: KEY };
      const { seen, fetchStub } = stub(recipeAnswer());
      const client = getShapeClient(env, { fetch: fetchStub })!;
      await runShapeAttempt(baseArgs({ client, noFitBlocks, env }));
      expectOnlyThisModel(seen[0]!, model);
      expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
      expect(seen[0]!.headers.get("cf-access-client-id")).toBeNull();
      expect(seen[0]!.headers.get("cf-access-client-secret")).toBeNull();
    });
  }

  test("a whole escalation (Haiku, Haiku again, Sonnet) names only the two ids", async () => {
    const { seen, fetchStub } = stub({ result: { kind: "recipe" } }); // valid JSON that fails the schema: invalid
    const client = getShapeClient(PROXY_ENV, { fetch: fetchStub })!;
    const args = baseArgs({ client, env: PROXY_ENV });
    for (let i = 0; i < 4; i += 1) await runShapeAttempt(args);
    expect(seen.map((s) => s.body.model)).toEqual(["claude-haiku-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5"]);
    for (const s of seen) expectOnlyThisModel(s, s.body.model);
  });
});

describe("an answer from another model is never stored", () => {
  for (const answered of ["claude-sonnet-5", "claude-opus-5-5", "gpt-5", ""]) {
    test(`answered by "${answered}"`, async () => {
      const { fetchStub } = stub(recipeAnswer(), answered);
      const client = getShapeClient(PROXY_ENV, { fetch: fetchStub })!;
      const args = baseArgs({ client, noFitBlocks: 2, env: PROXY_ENV });
      const r = await runShapeAttempt(args);
      expect(r).toMatchObject({ status: "ran", outcome: "error", errors: ["client:bad_model"], recipe: null, model: "claude-sonnet-5-5" });
      expect(args.store.rows).toHaveLength(1);
      expect(args.store.rows[0]).toMatchObject({ outcome: "error", model: "claude-sonnet-5-5", errorCodes: ["client:bad_model"] });
    });
  }

  test("a dated id of the asked model is fine", async () => {
    const { fetchStub } = stub(recipeAnswer(), "claude-haiku-5-5-20261001");
    const client = getShapeClient(PROXY_ENV, { fetch: fetchStub })!;
    const r = await runShapeAttempt(baseArgs({ client, env: PROXY_ENV }));
    expect(r).toMatchObject({ status: "ran", outcome: "recipe", model: "claude-haiku-5-5" });
  });
});
