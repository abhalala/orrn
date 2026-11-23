/**
 * XE-BILL row 15: the IRP adapter. The Worker never calls a government endpoint; it calls the GST relay
 * (`apps/gst-relay`, an Indian static-IP host) with a signed request (`signRelayRequest` in @orrn/domain).
 *
 * - `relayIrpAdapter`: the real path, configured by `GST_RELAY_URL` + `GST_RELAY_SECRET` (env bindings the
 *   owner sets; absent = not configured, and an invoice that needs an IRN stays "Draft, IRN pending").
 * - `fakeIrpAdapter`: deterministic stand-in for tests (and a local demo), never used in production.
 */
import { env } from "@orrn/env/server";

import { RELAY_MIN_SECRET_LENGTH, RELAY_PATHS, relayTenantKey, signRelayRequest, type RelayResponse } from "@orrn/domain";

export type IrnData = {
  Irn: string;
  AckNo: string | number;
  AckDt: string;
  SignedInvoice: string;
  SignedQRCode: string;
};

export type EwbData = { EwbNo: string | number; EwbDt: string; EwbValidTill: string };

/**
 * Who a relay call is for (review S2). `companyId` is the authority: the request is signed with that tenant's
 * key and the relay serves only GSTINs bound to it. `gstin` (from the frozen snapshot, which came from the
 * editable letterhead) only picks among them; it is never authority.
 */
export type RelayTarget = { companyId: string; gstin: string };

export interface IrpAdapter {
  generateIrn(to: RelayTarget, payload: Record<string, unknown>): Promise<RelayResponse<IrnData>>;
  irnByDocument(to: RelayTarget, doc: { docType: "INV" | "CRN"; docNo: string; docDate: string }): Promise<RelayResponse<IrnData>>;
  cancelIrn(to: RelayTarget, input: { irn: string; reasonCode: string; remark: string }): Promise<RelayResponse<{ Irn: string; CancelDate: string }>>;
  ewbByIrn(to: RelayTarget, payload: Record<string, unknown>): Promise<RelayResponse<EwbData>>;
  cancelEwb(to: RelayTarget, input: { ewbNo: string; reasonCode: string; remark: string }): Promise<RelayResponse<{ ewayBillNo: string; cancelDate: string }>>;
}

const RELAY_TIMEOUT_MS = 15_000;

export function relayIrpAdapter(config: { url: string; secret: string; fetch?: typeof fetch }): IrpAdapter {
  const base = config.url.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  async function call<T>(path: string, to: RelayTarget, body: Record<string, unknown>): Promise<RelayResponse<T>> {
    const text = JSON.stringify({ gstin: to.gstin, ...body });
    const key = await relayTenantKey(config.secret, to.companyId);
    const headers = await signRelayRequest(key, { method: "POST", path, body: text, tenant: to.companyId });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RELAY_TIMEOUT_MS);
    try {
      const res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: text,
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => null)) as RelayResponse<T> | null;
      if (json && typeof json === "object" && "ok" in json) return json;
      return { ok: false, code: `relay_http_${res.status}`, message: "The GST relay gave no usable answer", retryable: res.status >= 500 };
    } catch {
      return { ok: false, code: "relay_unreachable", message: "The GST relay did not answer", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    generateIrn: (to, payload) => call(RELAY_PATHS.irnGenerate, to, { payload }),
    irnByDocument: (to, doc) => call(RELAY_PATHS.irnByDocument, to, { ...doc }),
    cancelIrn: (to, input) => call(RELAY_PATHS.irnCancel, to, { ...input }),
    ewbByIrn: (to, payload) => call(RELAY_PATHS.ewbByIrn, to, { payload }),
    cancelEwb: (to, input) => call(RELAY_PATHS.ewbCancel, to, { ...input }),
  };
}

export type RelayConfig = { url: string; secret: string } | null;

/** The relay config from the env bindings, or null when it is not set up (or set up wrong). */
export function relayConfig(bindings: Record<string, unknown> = env as unknown as Record<string, unknown>): RelayConfig {
  const url = typeof bindings.GST_RELAY_URL === "string" ? bindings.GST_RELAY_URL.trim() : "";
  const secret = typeof bindings.GST_RELAY_SECRET === "string" ? bindings.GST_RELAY_SECRET : "";
  if (!url || secret.length < RELAY_MIN_SECRET_LENGTH) return null;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && bindings.NODE_ENV !== "production")) return null;
  } catch {
    return null;
  }
  return { url, secret };
}

let testAdapter: IrpAdapter | null | undefined;

/** Test hook: force an adapter (or `null` = not configured); `undefined` goes back to the env bindings. */
export function setIrpAdapterForTests(adapter: IrpAdapter | null | undefined): void {
  testAdapter = adapter;
}

/** The adapter to use now, or null when the relay is not configured. */
export function currentIrpAdapter(): IrpAdapter | null {
  if (testAdapter !== undefined) return testAdapter;
  const config = relayConfig();
  return config ? relayIrpAdapter(config) : null;
}

// ---------------------------------------------------------------------------
// Fake adapter (tests)
// ---------------------------------------------------------------------------

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type FakeIrpScript = {
  /** Answer the next N generate calls with this failure. */
  failGenerate?: { times: number; response: Extract<RelayResponse, { ok: false }> };
  calls: { op: string; body: unknown }[];
};

/**
 * A deterministic IRP: Irn = sha256(seller|type|number), AckNo counts up, AckDt is the given clock. A second
 * generate for the same document answers 2150 (duplicate) like the real IRP; by-document then returns it.
 */
export function fakeIrpAdapter(clock: () => Date = () => new Date(), script: FakeIrpScript = { calls: [] }): IrpAdapter & { script: FakeIrpScript } {
  const issued = new Map<string, IrnData>();
  const ewbs = new Map<string, EwbData>();
  let ack = 112_610_000_000_000;
  const ackDt = () => {
    const ist = new Date(clock().getTime() + 330 * 60_000).toISOString();
    return `${ist.slice(0, 10)} ${ist.slice(11, 19)}`;
  };
  return {
    script,
    async generateIrn({ gstin }, payload) {
      script.calls.push({ op: "generate", body: payload });
      if (script.failGenerate && script.failGenerate.times > 0) {
        script.failGenerate.times -= 1;
        return script.failGenerate.response;
      }
      const doc = payload.DocDtls as { Typ: string; No: string; Dt: string };
      const key = `${gstin}|${doc.Typ}|${doc.No}`;
      const existing = issued.get(key);
      if (existing) {
        return { ok: false, code: "2150", message: "Duplicate IRN", retryable: false, info: [{ InfCd: "DUPIRN", Desc: { Irn: existing.Irn, AckNo: existing.AckNo, AckDt: existing.AckDt } }] };
      }
      const irn = await sha256Hex(key);
      ack += 1;
      const AckDt = ackDt();
      const data = JSON.stringify({ ...payload, Irn: irn, AckNo: ack, AckDt });
      const signed = `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify({ data, iss: "FAKE IRP" }))}.fake-signature`;
      const qr = `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify({ data: JSON.stringify({ SellerGstin: gstin, DocNo: doc.No, Irn: irn }) }))}.fake-signature`;
      const out: IrnData = { Irn: irn, AckNo: ack, AckDt, SignedInvoice: signed, SignedQRCode: qr };
      issued.set(key, out);
      return { ok: true, data: out };
    },
    async irnByDocument({ gstin }, doc) {
      script.calls.push({ op: "byDocument", body: doc });
      const found = issued.get(`${gstin}|${doc.docType}|${doc.docNo}`);
      return found ? { ok: true, data: found } : { ok: false, code: "2283", message: "IRN details not found", retryable: false };
    },
    async cancelIrn(_gstin, input) {
      script.calls.push({ op: "cancel", body: input });
      return { ok: true, data: { Irn: input.irn, CancelDate: ackDt() } };
    },
    async ewbByIrn(_gstin, payload) {
      script.calls.push({ op: "ewb", body: payload });
      const irn = String(payload.Irn);
      const out: EwbData = { EwbNo: 181_000_000_000 + ewbs.size + 1, EwbDt: ackDt(), EwbValidTill: "" };
      ewbs.set(irn, out);
      return { ok: true, data: out };
    },
    async cancelEwb(_gstin, input) {
      script.calls.push({ op: "ewbCancel", body: input });
      return { ok: true, data: { ewayBillNo: input.ewbNo, cancelDate: ackDt() } };
    },
  };
}
