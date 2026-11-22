import { Hono } from "hono";
import { RELAY_PATHS, verifyRelaySignature, type RelayResponse } from "@orrn/domain";
import type { CredentialStore } from "./credentials";
import { memoryNonceStore, type NonceStore } from "./nonce";
import type { Upstream } from "./upstream";

export const MAX_BODY_BYTES = 1024 * 1024;

export interface AppDeps {
  secret: string;
  upstream: Upstream;
  credentials: CredentialStore;
  now?: () => number;
  nonceStore?: NonceStore;
  /** Log sink. Receives method, path, status, ms and GSTIN only. */
  log?: (line: string) => void;
}

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;

const fail = (code: string, message: string): RelayResponse => ({ ok: false, code, message, retryable: false });
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Handler = (cred: Parameters<Upstream["cancelIrn"]>[0], b: Record<string, unknown>, up: Upstream) => Promise<RelayResponse> | null;

const handlers: Record<string, Handler> = {
  [RELAY_PATHS.irnGenerate]: (c, b, up) => (obj(b.payload) ? up.generateIrn(c, b.payload) : null),
  [RELAY_PATHS.irnCancel]: (c, b, up) => (str(b.irn) && str(b.reasonCode) && str(b.remark) ? up.cancelIrn(c, { irn: b.irn, cnlRsn: b.reasonCode, cnlRem: b.remark }) : null),
  [RELAY_PATHS.irnByDocument]: (c, b, up) =>
    str(b.docType) && str(b.docNo) && str(b.docDate) ? up.irnByDocument(c, { docType: b.docType, docNo: b.docNo, docDate: b.docDate }) : null,
  [RELAY_PATHS.ewbByIrn]: (c, b, up) => (obj(b.payload) ? up.ewbByIrn(c, b.payload) : null),
  [RELAY_PATHS.ewbCancel]: (c, b, up) =>
    str(b.ewbNo) && str(b.reasonCode) && str(b.remark) ? up.cancelEwb(c, { ewbNo: b.ewbNo, cancelRsnCode: b.reasonCode, cancelRmrk: b.remark }) : null,
};

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const nonces = deps.nonceStore ?? memoryNonceStore();
  const log = deps.log ?? ((l: string) => console.log(l));
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  for (const path of Object.keys(handlers)) {
    app.post(path, async (c) => {
      const t0 = Date.now();
      let gstin = "-";
      const done = (status: number, body: RelayResponse) => {
        log(`${c.req.method} ${path} ${status} ${Date.now() - t0}ms gstin=${gstin}`);
        return c.json(body, status as 200);
      };
      const unauth = (reason: string) => {
        log(`auth refused: ${reason}`);
        return done(401, fail("relay_unauthorised", "request not authorised"));
      };

      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_BODY_BYTES) return done(413, fail("relay_too_large", "body too large"));
      const body = await c.req.text();
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return done(413, fail("relay_too_large", "body too large"));

      const t = now();
      const verdict = await verifyRelaySignature(
        deps.secret,
        { method: c.req.method, path: new URL(c.req.url).pathname, body, headers: c.req.raw.headers },
        t,
      );
      if (!verdict.ok) return unauth(verdict.reason);
      if (!nonces.claim(verdict.nonce, t)) return unauth("nonce replay or store full");

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return done(400, fail("relay_bad_request", "body is not valid JSON"));
      }
      if (!obj(parsed) || !str(parsed.gstin) || !GSTIN_RE.test(parsed.gstin)) return done(400, fail("relay_bad_request", "gstin missing or malformed"));
      gstin = parsed.gstin;
      const cred = deps.credentials.get(gstin);
      if (!cred) return done(404, fail("relay_unknown_gstin", "no credentials for this GSTIN"));

      const pending = handlers[path]!({ ...cred, gstin }, parsed, deps.upstream);
      if (!pending) return done(400, fail("relay_bad_request", "body shape is wrong for this endpoint"));
      let result: RelayResponse;
      try {
        result = await pending;
      } catch {
        result = { ok: false, code: "upstream_error", message: "unexpected relay error", retryable: true };
      }
      return done(200, result);
    });
  }

  app.notFound((c) => c.json(fail("relay_not_found", "not found"), 404));
  return app;
}
