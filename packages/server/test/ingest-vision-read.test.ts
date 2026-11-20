/**
 * Vision read, contract section 8: the signed read of a raw file or a page image. Tickets are not
 * interchangeable (a read ticket PUT is 403, an upload ticket GET is 403), they expire after 10 minutes,
 * and the route serves fixed headers: a raw file as an octet-stream attachment, a page as inline JPEG.
 * No D1 here; `ingest-vision-flow.test.ts` covers `vision.readUrl` and its company scope.
 */
import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import "./env-mock";

import { bandKey, bandTablesKey, handleIngestRead, handleIngestUpload, INGEST_TICKET_TTL_MS, issueReadTicket, issueTicket, pageKey, pageTextKey, rawKey, readIngestReadTicket, readIngestTicket, signIngestReadTicket, type IngestReadTicket } from "../src/lib/ingest/vault";

const SHA = createHash("sha256").update("synthetic file").digest("hex");
const CO = "co_read";
const NOW = Date.UTC(2026, 10, 20, 6, 0, 0);

class MemR2 {
  objects = new Map<string, { body: Uint8Array; type: string }>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.body.byteLength } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      key,
      size: o.body.byteLength,
      body: new Response(o.body).body,
      httpEtag: '"e"',
      // A raw file's stored type must never reach the response.
      writeHttpMetadata(h: Headers) {
        h.set("content-type", o.type);
      },
    };
  }
  async put(key: string, value: ReadableStream | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    const body = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { body, type: opts?.httpMetadata?.contentType ?? "" });
    return { key, size: body.byteLength };
  }
}

const bucket = () => {
  const b = new MemR2();
  b.objects.set(rawKey(CO, SHA), { body: new TextEncoder().encode("<html><script>alert(1)</script></html>"), type: "text/html" });
  b.objects.set(pageKey(CO, SHA, 2), { body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), type: "image/jpeg" });
  return b as unknown as R2Bucket;
};

const readFields = (over: Partial<IngestReadTicket> = {}) => ({
  companyId: CO,
  userId: "u_1",
  artifactId: "a_1",
  sha256: SHA,
  key: rawKey(CO, SHA),
  as: "raw" as const,
  ...over,
});

const ticketOf = (url: string) => new URL(url, "https://api.test").searchParams.get("ticket")!;
const get = (ticket: string) => new Request(`https://api.test/files/ingest/read?ticket=${encodeURIComponent(ticket)}`);

describe("read tickets", () => {
  test("a read ticket is good for 10 minutes and names its own artifact's key", async () => {
    const { url, expiresAt } = await issueReadTicket({ request: new Request("https://api.test/trpc") }, readFields(), NOW);
    expect(url.startsWith("https://api.test/files/ingest/read?ticket=")).toBe(true);
    expect(expiresAt).toBe(NOW + INGEST_TICKET_TTL_MS);
    const t = ticketOf(url);
    expect(await readIngestReadTicket(t, NOW + INGEST_TICKET_TTL_MS - 1)).toMatchObject({ purpose: "ingest-read", key: rawKey(CO, SHA), as: "raw" });
    expect(await readIngestReadTicket(t, NOW + INGEST_TICKET_TTL_MS + 1)).toBeNull();
  });

  test("a key outside the artifact, with .., or of the wrong shape for its use is refused", async () => {
    const sign = (over: Partial<IngestReadTicket>) => signIngestReadTicket({ ...readFields(over), purpose: "ingest-read", v: 1, exp: NOW + 1000 });
    expect(await readIngestReadTicket(await sign({ key: rawKey("co_other", SHA) }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: `${rawKey(CO, SHA)}/../../x/raw` }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: pageKey(CO, SHA, 1), as: "raw" }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: rawKey(CO, SHA), as: "page" }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: `${rawKey(CO, SHA).replace("/raw", "")}/digest.json`, as: "page" }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: pageKey(CO, SHA, 3), as: "page" }), NOW)).toMatchObject({ as: "page" });
    // A band image of a page (section 11.3) is a page image too; its tables object and the page text are not.
    expect(await readIngestReadTicket(await sign({ key: bandKey(CO, SHA, 3, 2), as: "page" }), NOW)).toMatchObject({ as: "page" });
    expect(await readIngestReadTicket(await sign({ key: bandTablesKey(CO, SHA, 3, 2), as: "page" }), NOW)).toBeNull();
    expect(await readIngestReadTicket(await sign({ key: pageTextKey(CO, SHA, 3), as: "page" }), NOW)).toBeNull();
  });

  test("purpose pinning: a read ticket PUT to the upload route is 403", async () => {
    const t = ticketOf((await issueReadTicket({}, readFields(), Date.now())).url);
    expect(await readIngestTicket(t)).toBeNull();
    const res = await handleIngestUpload(
      new Request(`https://api.test/files/ingest/upload?ticket=${encodeURIComponent(t)}`, { method: "PUT", body: new Uint8Array([1, 2]), headers: { "content-length": "2" } }),
      { bucket: bucket() },
    );
    expect(res.status).toBe(403);
  });

  test("purpose pinning: an upload ticket of any purpose GET from the read route is 403", async () => {
    for (const purpose of ["ingest-raw", "ingest-canonical", "ingest-page"] as const) {
      const up = await issueTicket(
        {},
        { purpose, companyId: CO, userId: "u_1", artifactId: "a_1", sha256: SHA, key: purpose === "ingest-page" ? pageKey(CO, SHA, 2) : rawKey(CO, SHA), size: 10, exactSize: false, contentType: "image/jpeg", fileName: "x" },
      );
      expect(await readIngestReadTicket(up.ticket)).toBeNull();
      expect((await handleIngestRead(get(up.ticket), { bucket: bucket() })).status).toBe(403);
    }
  });

  test("a forged read ticket (signed with an upload key) is 403", async () => {
    const up = await issueTicket({}, { purpose: "ingest-raw", companyId: CO, userId: "u_1", artifactId: "a_1", sha256: SHA, key: rawKey(CO, SHA), size: 10, exactSize: true, contentType: "", fileName: "x" });
    // Same signature, payload rewritten to claim ingest-read: the signature no longer verifies.
    const [payload, sig] = up.ticket.split(".") as [string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    const forged = `${Buffer.from(JSON.stringify({ ...claims, purpose: "ingest-read", as: "raw" })).toString("base64url")}.${sig}`;
    expect((await handleIngestRead(get(forged), { bucket: bucket() })).status).toBe(403);
  });
});

describe("read route", () => {
  test("raw: octet-stream attachment with the fixed headers, never the stored type", async () => {
    const { url } = await issueReadTicket({}, readFields(), Date.now());
    const res = await handleIngestRead(get(ticketOf(url)), { bucket: bucket() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toContain("<script>");
  });

  test("page: inline JPEG with the same fixed headers", async () => {
    const { url } = await issueReadTicket({}, readFields({ key: pageKey(CO, SHA, 2), as: "page" }), Date.now());
    const res = await handleIngestRead(get(ticketOf(url)), { bucket: bucket() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  test("a missing object is 404, an expired ticket 403, no bucket 503", async () => {
    const missing = await issueReadTicket({}, readFields({ key: pageKey(CO, SHA, 9), as: "page" }), Date.now());
    expect((await handleIngestRead(get(ticketOf(missing.url)), { bucket: bucket() })).status).toBe(404);
    const old = await issueReadTicket({}, readFields(), Date.now() - INGEST_TICKET_TTL_MS - 1000);
    expect((await handleIngestRead(get(ticketOf(old.url)), { bucket: bucket() })).status).toBe(403);
    expect((await handleIngestRead(get("garbage"), { bucket: bucket() })).status).toBe(403);
    expect((await handleIngestRead(get(ticketOf(old.url)), { bucket: null })).status).toBe(503);
  });
});
