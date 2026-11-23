import { describe, expect, test } from "bun:test";
import { RELAY_PATHS, RELAY_REPLAY_WINDOW_MS, relayTenantKey, signRelayRequest } from "@orrn/domain";
import { createApp } from "../src/app";
import { memoryCredentialStore, parseTenantConfig } from "../src/credentials";
import { fakeUpstream } from "../src/upstream";

const MASTER = "s".repeat(40);
const TENANT = "plant-a";
const OTHER = "plant-b";
const SECRET = await relayTenantKey(MASTER, TENANT);
const OTHER_KEY = await relayTenantKey(MASTER, OTHER);
const GSTIN = "24ABCDE1234F1Z5";
const OTHER_GSTIN = "27ABCDE1234F1Z5";
const NOW = 1_800_000_000_000;
const cred = { username: "u", password: "p", clientId: "ci", clientSecret: "cs" };

function setup(script = {}) {
  const upstream = fakeUpstream(script);
  const app = createApp({
    upstream,
    credentials: memoryCredentialStore({ [TENANT]: { key: SECRET, gstins: { [GSTIN]: cred } }, [OTHER]: { key: OTHER_KEY, gstins: { [OTHER_GSTIN]: cred } } }),
    now: () => NOW,
    log: () => {},
  });
  return { app, upstream };
}

const invoice = { SellerDtls: { Gstin: GSTIN }, DocDtls: { Typ: "INV", No: "FC/1" } };

async function post(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: string,
  opts: { at?: number; nonce?: string; signPath?: string; signBody?: string; headers?: Record<string, string>; tenant?: string; key?: string } = {},
) {
  const headers =
    opts.headers ??
    (await signRelayRequest(opts.key ?? SECRET, { method: "POST", path: opts.signPath ?? path, body: opts.signBody ?? body, tenant: opts.tenant ?? TENANT }, opts.at ?? NOW, opts.nonce ?? crypto.randomUUID()));
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

describe("relay app", () => {
  test("good request reaches upstream", async () => {
    const { app, upstream } = setup();
    const res = await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: GSTIN, payload: invoice }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.data.Irn).toHaveLength(64);
    expect(upstream.calls[0]?.method).toBe("generateIrn");
  });

  test("other routes dispatch", async () => {
    const { app, upstream } = setup();
    const bodies: [string, object][] = [
      [RELAY_PATHS.irnCancel, { gstin: GSTIN, irn: "x", reasonCode: "1", remark: "dup" }],
      [RELAY_PATHS.irnByDocument, { gstin: GSTIN, docType: "INV", docNo: "1", docDate: "01/01/2026" }],
      [RELAY_PATHS.ewbByIrn, { gstin: GSTIN, payload: { Irn: "x" } }],
      [RELAY_PATHS.ewbCancel, { gstin: GSTIN, ewbNo: "1", reasonCode: "1", remark: "r" }],
    ];
    for (const [p, b] of bodies) expect((await post(app, p, JSON.stringify(b))).status).toBe(200);
    expect(upstream.calls.map((c) => c.method)).toEqual(["cancelIrn", "irnByDocument", "ewbByIrn", "cancelEwb"]);
  });

  test("wrong body shape is 400", async () => {
    const { app } = setup();
    const res = await post(app, RELAY_PATHS.irnCancel, JSON.stringify({ gstin: GSTIN }));
    expect(res.status).toBe(400);
  });

  test("health is unsigned", async () => {
    const { app } = setup();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("missing headers -> 401", async () => {
    const { app, upstream } = setup();
    const res = await post(app, RELAY_PATHS.irnGenerate, "{}", { headers: {} });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).code).toBe("relay_unauthorised");
    expect(upstream.calls).toHaveLength(0);
  });

  test("bad signature -> 401", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    const h = await signRelayRequest("x".repeat(40), { method: "POST", path: RELAY_PATHS.irnGenerate, body, tenant: TENANT }, NOW);
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { headers: h })).status).toBe(401);
  });

  test("body tampered after signing -> 401", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    expect((await post(app, RELAY_PATHS.irnGenerate, body + " ", { signBody: body })).status).toBe(401);
  });

  test("path tampered -> 401", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, irn: "x", reasonCode: "1", remark: "r" });
    expect((await post(app, RELAY_PATHS.irnCancel, body, { signPath: RELAY_PATHS.irnGenerate })).status).toBe(401);
  });

  test("timestamp outside window -> 401 both ways", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { at: NOW - RELAY_REPLAY_WINDOW_MS - 1 })).status).toBe(401);
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { at: NOW + RELAY_REPLAY_WINDOW_MS + 1 })).status).toBe(401);
  });

  test("nonce replay -> second 401", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    const h = await signRelayRequest(SECRET, { method: "POST", path: RELAY_PATHS.irnGenerate, body, tenant: TENANT }, NOW, "nonce-0123456789abcdef");
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { headers: h })).status).toBe(200);
    const again = await post(app, RELAY_PATHS.irnGenerate, body, { headers: h });
    expect(again.status).toBe(401);
    expect(((await again.json()) as any).code).toBe("relay_unauthorised");
  });

  test("review S2: a GSTIN not bound to the signing tenant -> 403, never served (letterhead GSTIN is not authority)", async () => {
    const { app, upstream } = setup();
    // Plant B, correctly signed with its own key, names plant A's GSTIN (as if typed on its letterhead).
    const res = await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: GSTIN, payload: invoice }), { tenant: OTHER, key: OTHER_KEY });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("relay_gstin_not_bound");
    // An unbound GSTIN for the right tenant is refused the same way.
    expect((await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: "29ABCDE1234F1Z5", payload: invoice }))).status).toBe(403);
    expect(upstream.calls).toHaveLength(0);
  });

  test("review S2: one tenant's key cannot sign for another tenant; an unknown tenant is 401", async () => {
    const { app, upstream } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { tenant: TENANT, key: OTHER_KEY })).status).toBe(401);
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { tenant: "plant-z", key: await relayTenantKey(MASTER, "plant-z") })).status).toBe(401);
    const signed = await signRelayRequest(SECRET, { method: "POST", path: RELAY_PATHS.irnGenerate, body, tenant: TENANT }, NOW);
    expect((await post(app, RELAY_PATHS.irnGenerate, body, { headers: { ...signed, "x-orrn-tenant": OTHER } })).status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  test("review S2: the config refuses a GSTIN bound to two tenants and a malformed key", () => {
    const c = { username: "u", password: "p", clientId: "ci", clientSecret: "cs" };
    expect(() => parseTenantConfig({ tenants: { a: { key: SECRET, gstins: { [GSTIN]: c } }, b: { key: OTHER_KEY, gstins: { [GSTIN]: c } } } })).toThrow("two tenants");
    expect(() => parseTenantConfig({ tenants: { a: { key: "short", gstins: {} } } })).toThrow("key");
    expect(() => parseTenantConfig({ [GSTIN]: c })).toThrow("tenants");
    expect(Object.keys(parseTenantConfig({ tenants: { a: { key: SECRET, gstins: { [GSTIN]: c } } } }))).toEqual(["a"]);
  });

  test("malformed JSON -> 400", async () => {
    const { app } = setup();
    const res = await post(app, RELAY_PATHS.irnGenerate, "{not json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("relay_bad_request");
  });

  test("bad GSTIN format -> 400", async () => {
    const { app } = setup();
    expect((await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: "nope", payload: invoice }))).status).toBe(400);
  });

  test("oversized body -> 413", async () => {
    const { app } = setup();
    const res = await post(app, RELAY_PATHS.irnGenerate, "x".repeat(1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  test("duplicate generate returns 2150 with info", async () => {
    const { app } = setup();
    const body = JSON.stringify({ gstin: GSTIN, payload: invoice });
    const first = (await (await post(app, RELAY_PATHS.irnGenerate, body)).json()) as any;
    const second = (await (await post(app, RELAY_PATHS.irnGenerate, body)).json()) as any;
    expect(second.ok).toBe(false);
    expect(second.code).toBe("2150");
    expect(second.retryable).toBe(false);
    expect(second.info[0].Desc.Irn).toBe(first.data.Irn);
  });

  test("upstream failure surfaces as retryable 200", async () => {
    const { app } = setup({ generateIrn: () => ({ ok: false, code: "upstream_unreachable", message: "down", retryable: true }) });
    const res = await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: GSTIN, payload: invoice }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).retryable).toBe(true);
  });

  test("upstream throw is normalised", async () => {
    const { app } = setup({ generateIrn: () => { throw new Error("boom secret"); } });
    const res = await post(app, RELAY_PATHS.irnGenerate, JSON.stringify({ gstin: GSTIN, payload: invoice }));
    const j = (await res.json()) as any;
    expect(j.retryable).toBe(true);
    expect(JSON.stringify(j)).not.toContain("boom");
  });
});
