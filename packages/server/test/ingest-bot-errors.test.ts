/**
 * What the helper does when the proxy path fails: a Cloudflare Access refusal (403, usually an HTML page,
 * not JSON), a login redirect, an HTML page with status 200, a gateway error, or a host that cannot be
 * reached. Each must become one of the existing error kinds, and nothing that leaves the helper (message,
 * stringified error, run row, console) may hold the key, the Access id or the Access secret.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { getShapeClient, runShapeAttempt, setShapeClientForTests, ShapeClientError, type ShapeRequest } from "../src/lib/ingest/bot";
import { baseArgs } from "./ingest-bot-fixture";

const KEY = "sk-cpa-key-111";
const ID = "access-id-222.access";
const SECRET = "access-secret-333";
const HOST = "models.orrn.in";
const ENV = { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: `https://${HOST}`, MODEL_ACCESS_CLIENT_ID: ID, MODEL_ACCESS_CLIENT_SECRET: SECRET };
const SECRETS = [KEY, ID, SECRET];

const req: ShapeRequest = {
  model: "claude-haiku-5-5",
  system: [{ text: "s", cache: false }],
  messages: [{ role: "user", content: "x" }],
  maxTokens: 100,
  purpose: "shape",
};

/** A page like the one Access sends, and one that even echoes the secrets back, to prove they never get through. */
const ACCESS_HTML = `<!DOCTYPE html><html><head><title>Forbidden</title></head><body><h1>Forbidden</h1>
<p>Access denied for ${HOST}. Sent: ${KEY} ${ID} ${SECRET}</p></body></html>`;

const html = (status: number, body = ACCESS_HTML) =>
  (async () => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;

function leakCheck(err: unknown) {
  const e = err as Error;
  const text = [e.message, String(e), JSON.stringify(e), JSON.stringify(Object.fromEntries(Object.getOwnPropertyNames(e).filter((k) => k !== "stack").map((k) => [k, (e as any)[k]])))].join("\n");
  for (const v of SECRETS) expect(text).not.toContain(v);
  expect(text).not.toContain("Access denied");
  expect((e as any).cause).toBeUndefined();
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

describe("Cloudflare Access and gateway failures map to the existing kinds", () => {
  for (const [name, status, kind] of [
    ["Access 403 with an HTML page", 403, "auth"],
    ["401 with an HTML page", 401, "auth"],
    ["302 to the Access login page", 302, "auth"],
    ["502 bad gateway page", 502, "server"],
    ["522 connection timed out page", 522, "server"],
    ["530 origin error page", 530, "server"],
  ] as const) {
    test(`${name} is ${kind}`, async () => {
      const client = getShapeClient(ENV, { fetch: html(status) })!;
      const err = await client.call(req).catch((e) => e);
      expect(err).toBeInstanceOf(ShapeClientError);
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
      leakCheck(err);
    });
  }

  test("a 403 with a JSON body is auth too, and the server's words stay out of the message", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: `denied ${SECRET}` } }), { status: 403, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const err = await getShapeClient(ENV, { fetch: f })!.call(req).catch((e) => e);
    expect(err.kind).toBe("auth");
    leakCheck(err);
  });

  test("a 200 text/html answer (a login page that followed a redirect) is not a model answer and not 'unknown'", async () => {
    const err = await getShapeClient(ENV, { fetch: html(200) })!.call(req).catch((e) => e);
    expect(err).toBeInstanceOf(ShapeClientError);
    expect(err.kind).toBe("server");
    leakCheck(err);
  });
});

describe("an unreachable host is a network error", () => {
  test("a thrown connection error", async () => {
    let calls = 0;
    const down = (async () => {
      calls += 1;
      throw new TypeError(`fetch failed: connect ECONNREFUSED ${HOST}:443 (${ID})`);
    }) as unknown as typeof fetch;
    const err = await getShapeClient(ENV, { fetch: down })!.call(req).catch((e) => e);
    expect(err).toBeInstanceOf(ShapeClientError);
    expect(err.kind).toBe("network");
    expect(err.status).toBeUndefined();
    // One retry is allowed, then it gives up.
    expect(calls).toBe(2);
    leakCheck(err);
    expect(err.message).not.toContain(HOST);
  });
});

describe("through runShapeAttempt: the run row and the console hold no secrets", () => {
  for (const [name, f, code] of [
    ["Access 403 HTML", html(403), "client:auth"],
    ["connection error", (async () => { throw new TypeError(`connect ECONNREFUSED ${HOST} ${KEY} ${SECRET}`); }) as unknown as typeof fetch, "client:network"],
    ["502 HTML", html(502), "client:server"],
  ] as const) {
    test(name, async () => {
      const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => spyOn(console, m).mockImplementation(() => {}));
      const args = baseArgs({ client: getShapeClient(ENV, { fetch: f })!, env: ENV });
      const r = await runShapeAttempt(args);
      expect(r).toMatchObject({ status: "ran", outcome: "error", errors: [code], recipe: null });
      expect(args.store.rows).toHaveLength(1);
      const row = JSON.stringify(args.store.rows[0]);
      const seenByConsole = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      for (const v of [...SECRETS, HOST]) {
        expect(row).not.toContain(v);
        expect(JSON.stringify(r)).not.toContain(v);
        expect(seenByConsole).not.toContain(v);
      }
      spies.forEach((s) => s.mockRestore());
    });
  }
});

describe("the proxy route does not follow redirects", () => {
  test("fetch is called with redirect manual on the proxy route and not on the direct route", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return new Response("{}", { status: 403, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    await getShapeClient(ENV, { fetch: f })!.call(req).catch(() => {});
    await getShapeClient({ ANTHROPIC_API_KEY: KEY }, { fetch: f })!.call(req).catch(() => {});
    expect(inits[0]?.redirect).toBe("manual");
    expect(inits[1]?.redirect).toBeUndefined();
  });
});
