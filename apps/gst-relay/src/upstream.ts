import { createCipheriv, createDecipheriv, createHash, constants, publicEncrypt, randomBytes } from "node:crypto";
import type { RelayResponse } from "@orrn/domain";
import type { Credentials } from "./credentials";

export interface Upstream {
  generateIrn(cred: Credentials & { gstin: string }, payload: unknown): Promise<RelayResponse>;
  cancelIrn(cred: Credentials & { gstin: string }, req: { irn: string; cnlRsn: string; cnlRem: string }): Promise<RelayResponse>;
  irnByDocument(cred: Credentials & { gstin: string }, req: { docType: string; docNo: string; docDate: string }): Promise<RelayResponse>;
  ewbByIrn(cred: Credentials & { gstin: string }, payload: unknown): Promise<RelayResponse>;
  cancelEwb(cred: Credentials & { gstin: string }, req: { ewbNo: string; cancelRsnCode: string; cancelRmrk: string }): Promise<RelayResponse>;
}

export type Cred = Credentials & { gstin: string };

// ---------------------------------------------------------------------------------------------------
// Fake upstream (tests)
// ---------------------------------------------------------------------------------------------------

export type FakeScript = Partial<{
  [K in keyof Upstream]: (...args: Parameters<Upstream[K]>) => Promise<RelayResponse> | RelayResponse;
}>;

function fakeJwt(data: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ data: JSON.stringify(data) })}.sig`;
}

function ackDt(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Deterministic in-memory IRP. `script` overrides any method (to simulate failures). */
export function fakeUpstream(script: FakeScript = {}): Upstream & { calls: { method: string; args: unknown[] }[] } {
  const issued = new Map<string, { Irn: string; AckNo: number; AckDt: string }>();
  let ack = 100000000000;
  const calls: { method: string; args: unknown[] }[] = [];
  const rec = (method: string, args: unknown[]) => calls.push({ method, args });

  return {
    calls,
    async generateIrn(cred, payload) {
      rec("generateIrn", [cred, payload]);
      if (script.generateIrn) return script.generateIrn(cred, payload);
      const p = payload as { SellerDtls?: { Gstin?: string }; DocDtls?: { Typ?: string; No?: string } };
      const Irn = createHash("sha256").update(`${p.SellerDtls?.Gstin}|${p.DocDtls?.Typ}|${p.DocDtls?.No}|FY`).digest("hex");
      const prior = issued.get(Irn);
      if (prior) {
        return { ok: false, code: "2150", message: "Duplicate IRN", retryable: false, info: [{ InfCd: "DUPIRN", Desc: { ...prior } }] };
      }
      const rec2 = { Irn, AckNo: ++ack, AckDt: ackDt() };
      issued.set(Irn, rec2);
      return {
        ok: true,
        data: { ...rec2, SignedInvoice: fakeJwt({ ...rec2, DocNo: p.DocDtls?.No }), SignedQRCode: fakeJwt({ ...rec2, Qr: true }), Status: "ACT" },
      };
    },
    async cancelIrn(cred, req) {
      rec("cancelIrn", [cred, req]);
      if (script.cancelIrn) return script.cancelIrn(cred, req);
      return { ok: true, data: { Irn: req.irn, CancelDate: ackDt() } };
    },
    async irnByDocument(cred, req) {
      rec("irnByDocument", [cred, req]);
      if (script.irnByDocument) return script.irnByDocument(cred, req);
      return { ok: false, code: "2283", message: "IRN details not found", retryable: false };
    },
    async ewbByIrn(cred, payload) {
      rec("ewbByIrn", [cred, payload]);
      if (script.ewbByIrn) return script.ewbByIrn(cred, payload);
      return { ok: true, data: { EwbNo: 321000000001, EwbDt: ackDt(), EwbValidTill: ackDt() } };
    },
    async cancelEwb(cred, req) {
      rec("cancelEwb", [cred, req]);
      if (script.cancelEwb) return script.cancelEwb(cred, req);
      return { ok: true, data: { ewayBillNo: req.ewbNo, cancelDate: ackDt() } };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// NIC / IRP style upstream
//
// NOT RUN AGAINST THE IRIS SANDBOX. Written to the published GSTN e-invoice API spec (v1.03/1.04, which
// IRIS integrator APIs follow). The owner must register as an integrator and confirm paths, headers and
// the sandbox base URL before this is trusted. The unit tests prove only the crypto round trip against a
// fake server that implements the same published scheme.
// ---------------------------------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;
const TOKEN_SAFETY_MS = 10 * 60 * 1000;

interface Session {
  authToken: string;
  sek: Buffer;
  expiresAt: number;
}

function aesEcbEncrypt(key: Buffer, plain: Buffer): Buffer {
  const c = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(plain), c.final()]);
}
function aesEcbDecrypt(key: Buffer, enc: Buffer): Buffer {
  const d = createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([d.update(enc), d.final()]);
}

type NicEnvelope = {
  Status?: number | string;
  Data?: unknown;
  ErrorDetails?: { ErrorCode?: string; ErrorMessage?: string }[];
  InfoDtls?: unknown;
};

export function nicStyleUpstream(opts: { baseUrl: string; publicKeyPem: string; fetch?: typeof fetch; now?: () => number }): Upstream {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const sessions = new Map<string, Session>();

  const unreachable = (message: string): RelayResponse => ({ ok: false, code: "upstream_unreachable", message, retryable: true });

  async function http(method: "GET" | "POST", path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: NicEnvelope | null } | RelayResponse> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (res.status >= 500) return { ok: false, code: "upstream_5xx", message: `upstream HTTP ${res.status}`, retryable: true };
      let json: NicEnvelope | null = null;
      try {
        json = (await res.json()) as NicEnvelope;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      return unreachable(e instanceof Error && e.name === "AbortError" ? "upstream timeout" : "upstream network error");
    } finally {
      clearTimeout(timer);
    }
  }

  function isRelay(x: unknown): x is RelayResponse {
    return typeof x === "object" && x !== null && "ok" in x;
  }

  function nicError(env: NicEnvelope | null, status: number): RelayResponse {
    const first = env?.ErrorDetails?.[0];
    return {
      ok: false,
      code: first?.ErrorCode ? String(first.ErrorCode) : `upstream_http_${status}`,
      message: first?.ErrorMessage ?? "upstream rejected the request",
      retryable: false,
      ...(env?.InfoDtls !== undefined && env.InfoDtls !== null ? { info: env.InfoDtls } : {}),
    };
  }

  async function session(cred: Cred): Promise<Session | RelayResponse> {
    const cached = sessions.get(cred.gstin);
    if (cached && cached.expiresAt - TOKEN_SAFETY_MS > now()) return cached;
    const appKey = randomBytes(32);
    const inner = JSON.stringify({ UserName: cred.username, Password: cred.password, AppKey: appKey.toString("base64"), ForceRefreshAccessToken: false });
    const data = publicEncrypt(
      { key: opts.publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(Buffer.from(inner).toString("base64")),
    ).toString("base64");
    const r = await http("POST", "/eivital/v1.04/auth", { client_id: cred.clientId, client_secret: cred.clientSecret, Gstin: cred.gstin }, { Data: data });
    if (isRelay(r)) return r;
    const d = r.json?.Data as { AuthToken?: string; Sek?: string; TokenExpiry?: string } | undefined;
    if (!r.json || String(r.json.Status) !== "1" || !d?.AuthToken || !d.Sek) return nicError(r.json, r.status);
    let sek: Buffer;
    try {
      sek = aesEcbDecrypt(appKey, Buffer.from(d.Sek, "base64"));
    } catch {
      return { ok: false, code: "upstream_bad_response", message: "could not decrypt SEK", retryable: false };
    }
    // TokenExpiry is "YYYY-MM-DD HH:mm:ss" in IST (+05:30). Fall back to 6 h when absent or unparsable.
    let expiresAt = now() + 6 * 3600_000;
    if (d.TokenExpiry) {
      const t = Date.parse(d.TokenExpiry.replace(" ", "T") + "+05:30");
      if (!Number.isNaN(t)) expiresAt = t;
    }
    const s = { authToken: d.AuthToken, sek, expiresAt };
    sessions.set(cred.gstin, s);
    return s;
  }

  async function call(cred: Cred, method: "GET" | "POST", path: string, payload?: unknown): Promise<RelayResponse> {
    const s = await session(cred);
    if (isRelay(s)) return s;
    const headers = { client_id: cred.clientId, client_secret: cred.clientSecret, Gstin: cred.gstin, user_name: cred.username, AuthToken: s.authToken };
    const body = payload === undefined ? undefined : { Data: aesEcbEncrypt(s.sek, Buffer.from(JSON.stringify(payload))).toString("base64") };
    const r = await http(method, path, headers, body);
    if (isRelay(r)) return r;
    const env = r.json;
    if (env && String(env.Status) === "1" && typeof env.Data === "string") {
      try {
        return { ok: true, data: JSON.parse(aesEcbDecrypt(s.sek, Buffer.from(env.Data, "base64")).toString("utf8")) as Record<string, unknown> };
      } catch {
        return { ok: false, code: "upstream_bad_response", message: "could not decrypt response", retryable: false };
      }
    }
    if (env && String(env.Status) === "1" && env.Data && typeof env.Data === "object") return { ok: true, data: env.Data as Record<string, unknown> };
    // Token rejected: drop the cached session so the next call re-authenticates.
    if (env?.ErrorDetails?.some((e) => e.ErrorCode === "1005" || e.ErrorCode === "1006")) sessions.delete(cred.gstin);
    return nicError(env, r.status);
  }

  return {
    generateIrn: (cred, payload) => call(cred, "POST", "/eicore/v1.03/Invoice", payload),
    cancelIrn: (cred, req) => call(cred, "POST", "/eicore/v1.03/Invoice/Cancel", { Irn: req.irn, CnlRsn: req.cnlRsn, CnlRem: req.cnlRem }),
    irnByDocument: (cred, req) =>
      call(cred, "GET", `/eicore/v1.03/Invoice/irnbydocdetails?doctype=${encodeURIComponent(req.docType)}&docnum=${encodeURIComponent(req.docNo)}&docdate=${encodeURIComponent(req.docDate)}`),
    ewbByIrn: (cred, payload) => call(cred, "POST", "/eiewb/v1.03/ewaybill", payload),
    // E-way bill cancel is on the separate EWB API, which needs a GST Suvidha Provider (ASP) account the
    // owner does not have yet. Not implemented here.
    cancelEwb: async () => ({ ok: false, code: "not_configured", message: "e-way bill cancel needs an EWB API (ASP) account", retryable: false }),
  };
}
