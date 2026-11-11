/**
 * Infinity Portal lane A: upload tickets, the upload route and the nameKey parity. No D1 here; the
 * route runs against an in-memory bucket that checks the SHA-256 the way R2 does (code 10037).
 */
import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { workersEnv } from "./env-mock";

import { nameKey as engineNameKey } from "@orrn/ingest";

import { nameKey as serverNameKey } from "../src/lib/purchase";
import { handleIngestUpload, issueTicket, rawKey, readIngestTicket, signIngestTicket, type IngestTicket } from "../src/lib/ingest/vault";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Stand-in for R2: keeps bytes, refuses a put whose `sha256` option does not match, like R2 does. */
class DigestR2 {
  objects = new Map<string, Uint8Array>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.byteLength } : null;
  }
  async put(key: string, value: ReadableStream | Uint8Array, opts?: { sha256?: string }) {
    const body = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    if (opts?.sha256 && sha(body) !== opts.sha256) throw new Error("put: The SHA-256 checksum you specified did not match what we received. (10037)");
    this.objects.set(key, body);
    return { key, size: body.byteLength };
  }
}

const COMPANY = "co_1";

function ticketFields(bytes: Uint8Array, over: Partial<IngestTicket> = {}): Omit<IngestTicket, "v" | "exp"> {
  const digest = sha(bytes);
  return {
    purpose: "ingest-raw",
    companyId: COMPANY,
    userId: "u_1",
    artifactId: "a_1",
    sha256: digest,
    key: rawKey(COMPANY, digest),
    size: bytes.byteLength,
    exactSize: true,
    contentType: "text/csv",
    fileName: "parties.csv",
    ...over,
  };
}

function put(ticket: string, body: Uint8Array, length = body.byteLength) {
  return new Request(`https://api.test/files/ingest/upload?ticket=${encodeURIComponent(ticket)}`, {
    method: "PUT",
    body,
    headers: { "content-length": String(length) },
  });
}

describe("upload tickets", () => {
  const bytes = new TextEncoder().encode("Name,City\nAcme,Surat\n");

  test("a signed ticket reads back", async () => {
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes), 1_000);
    const t = await readIngestTicket(ticket, 2_000);
    expect(t).toMatchObject({ purpose: "ingest-raw", companyId: COMPANY, sha256: sha(bytes) });
  });

  test("a tampered payload or signature is refused", async () => {
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes), 1_000);
    const [payload, sig] = ticket.split(".") as [string, string];
    const other = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IngestTicket;
    other.size = 999_999;
    const forged = `${Buffer.from(JSON.stringify(other)).toString("base64url")}.${sig}`;
    expect(await readIngestTicket(forged, 2_000)).toBeNull();
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(await readIngestTicket(flipped, 2_000)).toBeNull();
    expect(await readIngestTicket("not a ticket", 2_000)).toBeNull();
  });

  test("a ticket signed for one purpose does not pass as another", async () => {
    const t = { ...ticketFields(bytes), v: 1 as const, exp: 10_000 };
    const signed = await signIngestTicket(t);
    const [payload, sig] = signed.split(".") as [string, string];
    const swapped = { ...t, purpose: "ingest-canonical" as const };
    const relabeled = `${Buffer.from(JSON.stringify(swapped)).toString("base64url")}.${sig}`;
    expect(await readIngestTicket(`${payload}.${sig}`, 2_000)).not.toBeNull();
    expect(await readIngestTicket(relabeled, 2_000)).toBeNull();
  });

  test("an expired ticket is refused", async () => {
    const { ticket, expiresAt } = await issueTicket({ request: null }, ticketFields(bytes), 1_000);
    expect(await readIngestTicket(ticket, expiresAt)).not.toBeNull();
    expect(await readIngestTicket(ticket, expiresAt + 1)).toBeNull();
  });

  test("a key outside the artifact's own folder is refused, even when signed", async () => {
    const t = { ...ticketFields(bytes, { key: `tenants/other/artifacts/${sha(bytes)}/raw` }), v: 1 as const, exp: 10_000 };
    expect(await readIngestTicket(await signIngestTicket(t), 2_000)).toBeNull();
    const dots = { ...ticketFields(bytes, { key: `${rawKey(COMPANY, sha(bytes))}/../../x` }), v: 1 as const, exp: 10_000 };
    expect(await readIngestTicket(await signIngestTicket(dots), 2_000)).toBeNull();
  });
});

describe("upload route", () => {
  const bytes = new TextEncoder().encode("Name,City\nAcme,Surat\n");

  test("stores the raw bytes once; a second put is a conflict", async () => {
    const bucket = new DigestR2();
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes));
    const first = await handleIngestUpload(put(ticket, bytes), { bucket: bucket as unknown as R2Bucket });
    expect(first.status).toBe(200);
    expect(bucket.objects.get(rawKey(COMPANY, sha(bytes)))).toEqual(bytes);
    const again = await handleIngestUpload(put(ticket, bytes), { bucket: bucket as unknown as R2Bucket });
    expect(again.status).toBe(409);
  });

  test("bytes that do not match the signed digest are refused with 400", async () => {
    const bucket = new DigestR2();
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes));
    const other = new TextEncoder().encode("Name,City\nAcme,Rajko\n");
    expect(other.byteLength).toBe(bytes.byteLength);
    const res = await handleIngestUpload(put(ticket, other), { bucket: bucket as unknown as R2Bucket });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("The file does not match its digest");
    expect(bucket.objects.size).toBe(0);
  });

  test("size checks: larger than declared is 413, a different exact size is 400", async () => {
    const bucket = new DigestR2();
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes));
    const bigger = new Uint8Array(bytes.byteLength + 5);
    expect((await handleIngestUpload(put(ticket, bigger), { bucket: bucket as unknown as R2Bucket })).status).toBe(413);
    const smaller = bytes.slice(0, 5);
    expect((await handleIngestUpload(put(ticket, smaller), { bucket: bucket as unknown as R2Bucket })).status).toBe(400);
  });

  test("a bad ticket is 403; no bucket is 503", async () => {
    const bucket = new DigestR2();
    expect((await handleIngestUpload(put("nope", bytes), { bucket: bucket as unknown as R2Bucket })).status).toBe(403);
    const { ticket } = await issueTicket({ request: null }, ticketFields(bytes));
    expect((await handleIngestUpload(put(ticket, bytes), { bucket: null })).status).toBe(503);
  });

  test("no signing key on the stage is 503 before anything else", async () => {
    const saved = workersEnv.ORRN_MASTER_KEY;
    delete workersEnv.ORRN_MASTER_KEY;
    try {
      const res = await handleIngestUpload(put("x.y", bytes), { bucket: new DigestR2() as unknown as R2Bucket });
      expect(res.status).toBe(503);
    } finally {
      workersEnv.ORRN_MASTER_KEY = saved;
    }
  });
});

describe("nameKey parity", () => {
  const samples = [
    "Acme Traders",
    "  ACME   traders. ",
    "M/s. Shree Ganesh Aluminium Pvt. Ltd.",
    "Shree-Ganesh_Aluminium",
    "श्री गणेश एल्युमिनियम",
    "Ｆｕｌｌｗｉｄｔｈ Ｃｏ",
    "Café Déjà-vu",
    "R.K. & Sons (Rajkot)",
    "",
    "123 456",
  ];

  test("packages/ingest names.ts and server lib/purchase.ts give the same key for every sample", () => {
    for (const s of samples) expect(engineNameKey(s)).toBe(serverNameKey(s));
  });
});
