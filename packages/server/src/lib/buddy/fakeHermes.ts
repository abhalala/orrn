/**
 * Fake Hermes (dev and tests only; the Worker never imports it). Started by `apps/server/scripts/fake-hermes.ts`.
 *
 * Fake Hermes for local runs, e2e and server tests (design 2026-11-18, §6, §13). It speaks the one
 * endpoint orrn's `/buddy/chat` proxy uses: `POST /v1/responses` (and `/p/<profile>/v1/responses`) with
 * `stream: true`, answering the same SSE frame sequence hermes-agent v0.23.1 writes
 * (`gateway/platforms/api_server_openai_routes.py`, `_ResponsesStreamWriter`): `response.created`, a
 * reasoning item, a `hermes.status` event, an orrn tool call (`function_call` added and done, then the
 * `function_call_output`), a commentary message item, the answer as `response.output_text.delta`
 * frames, `response.output_text.done`, `response.output_item.done` and `response.completed`. The proxy
 * must drop everything except the text, the orrn tool path and the end.
 *
 * Run (one worktree, its own port):
 *   bun apps/server/scripts/fake-hermes.ts            # port $FAKE_HERMES_PORT, default 4790
 *
 * Messages that steer it:
 *   "/fail ..."     -> response.failed
 *   "/slow ..."     -> 2 s between text frames
 *   "/offline ..."  -> HTTP 200 with an HTML page (what a bad Access token returns)
 *   "/call <path> <json>" or "/draft <path> <json>" -> a real orrn MCP `orrn_call` when an orrn token is set
 *     (env FAKE_HERMES_MCP_URL, default http://localhost:$E2E_API_PORT/mcp, and the token from env
 *     FAKE_HERMES_MCP_TOKEN or `POST /__fake/token {"token":"orrnb_..."}`). A mutation then leaves a real draft.
 *
 * Auth it checks, like the real gate: `Authorization: Bearer $FAKE_HERMES_KEY` (default "fake-hermes-key")
 * and both `CF-Access-Client-Id` / `CF-Access-Client-Secret` present. Anything else: 401.
 * `GET /__fake/last` returns the last request body, `{}` before any (tests check what orrn sent; it never holds a token);
 * it is also the readiness URL.
 */

export type FakeHermesOptions = {
  apiKey?: string;
  /** orrn MCP endpoint and grant token for "/call" and "/draft" messages. */
  mcpUrl?: string | null;
  mcpToken?: string | null;
  /** Milliseconds between text frames (default 0). */
  delayMs?: number;
  fetch?: typeof fetch;
};

type Frame = { event?: string; data: Record<string, unknown> };

const sse = (f: Frame): string => `${f.event ? `event: ${f.event}\n` : ""}data: ${JSON.stringify(f.data)}\n\n`;

function words(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

async function callOrrn(opts: FakeHermesOptions, path: string, input: unknown): Promise<unknown> {
  if (!opts.mcpUrl || !opts.mcpToken) return { status: "error", message: "fake hermes has no orrn token" };
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(opts.mcpUrl, {
    method: "POST",
    // Real Hermes names the platform of the session that called the tool; the buddy chat is `api_server`.
    headers: {
      authorization: `Bearer ${opts.mcpToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-hermes-platform": "api_server",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "orrn_call", arguments: { path, input } } }),
  });
  const body = (await res.json().catch(() => null)) as { result?: { structuredContent?: unknown } } | null;
  return body?.result?.structuredContent ?? { status: "error", message: `orrn answered ${res.status}` };
}

/** The frames for one turn, in Hermes's order. */
export async function* fakeHermesFrames(message: string, opts: FakeHermesOptions = {}): AsyncGenerator<Frame> {
  const id = `resp_fake${Math.random().toString(36).slice(2, 10)}`;
  const created = Math.floor(Date.now() / 1000);
  const env = (status: string, output: unknown[] = []) => ({ id, object: "response", status, created_at: created, model: "hermes-agent", output });
  let seq = 0;
  const f = (event: string, data: Record<string, unknown>): Frame => ({ event, data: { ...data, sequence_number: seq++ } });

  yield f("response.created", { type: "response.created", response: env("in_progress") });
  // Reasoning burst (dropped by orrn).
  const rs = { id: `${id}_rs0`, type: "reasoning", status: "in_progress", summary: [] };
  yield f("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: rs });
  yield f("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", item_id: rs.id, output_index: 0, summary_index: 0, delta: "thinking" });
  yield f("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { ...rs, status: "completed" } });
  // Lifecycle status (dropped by orrn).
  yield { event: "hermes.status", data: { kind: "provider_wait", message: "waiting" } };

  if (message.startsWith("/fail")) {
    yield f("response.failed", { type: "response.failed", response: { ...env("failed"), error: "fake failure" } });
    return;
  }

  let toolResult: unknown = null;
  const m = /^\/(call|draft)\s+(\S+)\s*([\s\S]*)$/.exec(message);
  const path = m ? m[2]! : "stock.summary";
  let input: unknown = undefined;
  if (m && m[3]?.trim()) {
    try {
      input = JSON.parse(m[3]);
    } catch {
      input = undefined;
    }
  }
  const callId = `call_${id.slice(5)}_1`;
  const args = JSON.stringify(input === undefined ? { path } : { path, input });
  const fc = { id: `${id}_fc_${callId}`, type: "function_call", status: "in_progress", name: "mcp__orrn__orrn_call", call_id: callId, arguments: args };
  yield f("response.output_item.added", { type: "response.output_item.added", output_index: 1, item: fc });
  if (m) toolResult = await callOrrn(opts, path, input);
  else toolResult = { status: "ok", data: { note: "fake result" } };
  yield f("response.output_item.done", { type: "response.output_item.done", output_index: 1, item: { ...fc, status: "completed" } });
  const out = { id: `${id}_fco_${callId}`, type: "function_call_output", call_id: callId, output: [{ type: "input_text", text: JSON.stringify(toolResult) }], status: "completed" };
  yield f("response.output_item.added", { type: "response.output_item.added", output_index: 2, item: out });
  yield f("response.output_item.done", { type: "response.output_item.done", output_index: 2, item: out });
  // Commentary item (dropped by orrn: it is not the answer).
  const cm = { id: `${id}_msgc`, type: "message", status: "completed", phase: "commentary", role: "assistant", content: [{ type: "output_text", text: "Looking it up." }] };
  yield f("response.output_item.added", { type: "response.output_item.added", output_index: 3, item: cm });
  yield f("response.output_item.done", { type: "response.output_item.done", output_index: 3, item: cm });

  const status = (toolResult as { status?: string } | null)?.status;
  const answer =
    status === "needs_confirm"
      ? "I made a draft. Check it in the card below and press Confirm."
      : `Fake Hermes heard: ${message.slice(0, 200)}`;
  const msgId = `${id}_msg`;
  yield f("response.output_item.added", { type: "response.output_item.added", output_index: 4, item: { id: msgId, type: "message", status: "in_progress", role: "assistant", content: [] } });
  for (const w of words(answer)) {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    yield f("response.output_text.delta", { type: "response.output_text.delta", item_id: msgId, output_index: 4, content_index: 0, delta: w, logprobs: [] });
  }
  yield f("response.output_text.done", { type: "response.output_text.done", item_id: msgId, output_index: 4, content_index: 0, text: answer });
  yield f("response.output_item.done", { type: "response.output_item.done", output_index: 4, item: { id: msgId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: answer }] } });
  yield f("response.completed", { type: "response.completed", response: env("completed") });
}

export type FakeHermes = {
  handle(request: Request): Promise<Response>;
  /** The last JSON body orrn sent (for tests). */
  last(): Record<string, unknown> | null;
  /** The path of the last chat request (`/p/<profile>/v1/responses`), for tests. */
  lastPath(): string | null;
  /** How many chat requests reached it (tests count turns that got past orrn's limit). */
  turns(): number;
  setToken(token: string | null): void;
};

export function createFakeHermes(opts: FakeHermesOptions = {}): FakeHermes {
  const apiKey = opts.apiKey ?? "fake-hermes-key";
  let lastBody: Record<string, unknown> | null = null;
  let lastPath: string | null = null;
  let turns = 0;
  let token = opts.mcpToken ?? null;
  return {
    last: () => lastBody,
    lastPath: () => lastPath,
    turns: () => turns,
    setToken: (t) => {
      token = t;
    },
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/__fake/last" && request.method === "GET") return Response.json(lastBody ?? {});
      if (url.pathname === "/__fake/token" && request.method === "POST") {
        const b = (await request.json().catch(() => null)) as { token?: unknown } | null;
        token = typeof b?.token === "string" ? b.token : null;
        return Response.json({ ok: true });
      }
      if (request.method !== "POST" || !/^(\/p\/[A-Za-z0-9_-]+)?\/v1\/responses$/.test(url.pathname)) {
        return new Response("not found", { status: 404 });
      }
      turns += 1;
      lastPath = url.pathname;
      if (request.headers.get("authorization") !== `Bearer ${apiKey}`) return new Response("unauthorized", { status: 401 });
      if (!request.headers.get("cf-access-client-id") || !request.headers.get("cf-access-client-secret")) {
        return new Response("unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.input !== "string" || body.stream !== true) return Response.json({ error: "bad request" }, { status: 400 });
      lastBody = body;
      const message = body.input;
      if (message.startsWith("/offline")) {
        return new Response("<html><body>Sign in with Cloudflare Access</body></html>", { status: 200, headers: { "content-type": "text/html" } });
      }
      const frames = fakeHermesFrames(message, {
        ...opts,
        mcpToken: token,
        delayMs: message.startsWith("/slow") ? 2000 : opts.delayMs,
      });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await frames.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(sse(next.value)));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },
  };
}

/** A `fetch` that answers from a fake Hermes in-process (tests: no network). */
export function fakeHermesFetch(fake: FakeHermes): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return fake.handle(request);
  }) as typeof fetch;
}
