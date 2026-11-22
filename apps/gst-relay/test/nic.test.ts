import { describe, expect, test } from "bun:test";
import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from "node:crypto";
import { nicStyleUpstream, type Cred } from "../src/upstream";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const cred: Cred = { gstin: "24ABCDE1234F1Z5", username: "user1", password: "pw1", clientId: "cid", clientSecret: "csec" };
const aes = (k: Buffer, b: Buffer) => { const c = createCipheriv("aes-256-ecb", k, null); return Buffer.concat([c.update(b), c.final()]); };
const unaes = (k: Buffer, b: Buffer) => { const d = createDecipheriv("aes-256-ecb", k, null); return Buffer.concat([d.update(b), d.final()]); };
// Node and Bun refuse RSA_PKCS1_PADDING for private decryption, so the fake server removes the
// PKCS#1 v1.5 padding (00 02 <nonzero random> 00 <message>) by hand after a raw RSA operation.
function pkcs1Decrypt(enc: Buffer): Buffer {
  const raw = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, enc);
  if (raw[0] !== 0 || raw[1] !== 2) throw new Error("bad PKCS1 padding");
  return raw.subarray(raw.indexOf(0, 2) + 1);
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function fakeNic(opts: { invoiceReply?: (payload: any) => Response } = {}) {
  const sek = randomBytes(32);
  const seen = { auth: 0, invoice: 0, authHeaders: {} as Record<string, string>, invoiceHeaders: {} as Record<string, string>, creds: null as any, urls: [] as string[] };
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    seen.urls.push(u.pathname + u.search);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    if (u.pathname === "/eivital/v1.04/auth") {
      seen.auth++;
      seen.authHeaders = headers;
      const innerB64 = pkcs1Decrypt(Buffer.from(body.Data, "base64")).toString();
      const inner = JSON.parse(Buffer.from(innerB64, "base64").toString());
      seen.creds = inner;
      const appKey = Buffer.from(inner.AppKey, "base64");
      return json({ Status: 1, Data: { AuthToken: "tok123", Sek: aes(appKey, sek).toString("base64"), TokenExpiry: "2099-01-01 00:00:00" } });
    }
    seen.invoice++;
    seen.invoiceHeaders = headers;
    const payload = body ? JSON.parse(unaes(sek, Buffer.from(body.Data, "base64")).toString()) : undefined;
    if (opts.invoiceReply) return opts.invoiceReply(payload);
    return json({ Status: 1, Data: aes(sek, Buffer.from(JSON.stringify({ Irn: "abc", echoed: payload }))).toString("base64") });
  }) as unknown as typeof fetch;
  return { fetchFn, seen, sek };
}

describe("nicStyleUpstream", () => {
  test("crypto round trip and token caching", async () => {
    const { fetchFn, seen } = fakeNic();
    const up = nicStyleUpstream({ baseUrl: "https://irp.test/", publicKeyPem: publicKey, fetch: fetchFn });
    const r1 = await up.generateIrn(cred, { DocDtls: { No: "1" } });
    expect(r1).toEqual({ ok: true, data: { Irn: "abc", echoed: { DocDtls: { No: "1" } } } });
    expect(seen.creds.UserName).toBe("user1");
    expect(seen.creds.Password).toBe("pw1");
    expect(seen.creds.ForceRefreshAccessToken).toBe(false);
    expect(seen.authHeaders.client_id).toBe("cid");
    expect(seen.authHeaders.client_secret).toBe("csec");
    expect(seen.authHeaders.gstin).toBe(cred.gstin);
    expect(seen.invoiceHeaders.authtoken).toBe("tok123");
    expect(seen.invoiceHeaders.user_name).toBe("user1");
    await up.generateIrn(cred, { DocDtls: { No: "2" } });
    expect(seen.auth).toBe(1);
    expect(seen.invoice).toBe(2);
  });

  test("re-authenticates when the token is near expiry", async () => {
    const { fetchFn, seen } = fakeNic();
    let t = Date.parse("2098-12-31T23:00:00+05:30");
    const up = nicStyleUpstream({ baseUrl: "https://irp.test", publicKeyPem: publicKey, fetch: fetchFn, now: () => t });
    await up.generateIrn(cred, {});
    t = Date.parse("2098-12-31T23:55:00+05:30"); // inside the 10 minute safety margin
    await up.generateIrn(cred, {});
    expect(seen.auth).toBe(2);
  });

  test("cancel, by-document and ewb paths", async () => {
    const { fetchFn, seen } = fakeNic();
    const up = nicStyleUpstream({ baseUrl: "https://irp.test", publicKeyPem: publicKey, fetch: fetchFn });
    const c = await up.cancelIrn(cred, { irn: "i", cnlRsn: "1", cnlRem: "r" });
    expect(c.ok && (c.data as any).echoed).toEqual({ Irn: "i", CnlRsn: "1", CnlRem: "r" });
    await up.irnByDocument(cred, { docType: "INV", docNo: "A/1", docDate: "01/01/2026" });
    await up.ewbByIrn(cred, { Irn: "i" });
    expect(seen.urls).toContain("/eicore/v1.03/Invoice/Cancel");
    expect(seen.urls).toContain("/eicore/v1.03/Invoice/irnbydocdetails?doctype=INV&docnum=A%2F1&docdate=01%2F01%2F2026");
    expect(seen.urls).toContain("/eiewb/v1.03/ewaybill");
  });

  test("NIC error body is normalised, 2150 keeps info", async () => {
    const info = [{ InfCd: "DUPIRN", Desc: { Irn: "z", AckNo: 1, AckDt: "2026-01-01 10:00:00" } }];
    const { fetchFn } = fakeNic({
      invoiceReply: () => json({ Status: 0, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }], InfoDtls: info }),
    });
    const up = nicStyleUpstream({ baseUrl: "https://irp.test", publicKeyPem: publicKey, fetch: fetchFn });
    expect(await up.generateIrn(cred, {})).toEqual({ ok: false, code: "2150", message: "Duplicate IRN", retryable: false, info });
  });

  test("5xx is retryable", async () => {
    const { fetchFn } = fakeNic({ invoiceReply: () => new Response("bad gateway", { status: 502 }) });
    const up = nicStyleUpstream({ baseUrl: "https://irp.test", publicKeyPem: publicKey, fetch: fetchFn });
    const r = await up.generateIrn(cred, {});
    expect(r).toMatchObject({ ok: false, code: "upstream_5xx", retryable: true });
  });

  test("network error is retryable", async () => {
    const up = nicStyleUpstream({
      baseUrl: "https://irp.test",
      publicKeyPem: publicKey,
      fetch: (async () => { throw new TypeError("connect refused"); }) as unknown as typeof fetch,
    });
    expect(await up.generateIrn(cred, {})).toMatchObject({ ok: false, code: "upstream_unreachable", retryable: true });
  });

  test("auth failure is normalised", async () => {
    const up = nicStyleUpstream({
      baseUrl: "https://irp.test",
      publicKeyPem: publicKey,
      fetch: (async () => json({ Status: 0, ErrorDetails: [{ ErrorCode: "3001", ErrorMessage: "bad password" }] })) as unknown as typeof fetch,
    });
    expect(await up.generateIrn(cred, {})).toMatchObject({ ok: false, code: "3001", retryable: false });
  });

  test("ewb cancel is not configured", async () => {
    const up = nicStyleUpstream({ baseUrl: "https://irp.test", publicKeyPem: publicKey });
    expect(await up.cancelEwb(cred, { ewbNo: "1", cancelRsnCode: "1", cancelRmrk: "r" })).toMatchObject({ ok: false, code: "not_configured" });
  });
});
