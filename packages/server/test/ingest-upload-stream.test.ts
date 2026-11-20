/**
 * The chunked upload's streaming code on a real workerd (server review N9): `stream-digest.ts` is bundled into a
 * Miniflare Worker, so `crypto.DigestStream`, `FixedLengthStream` and the R2 binding's `uploadPart` run as on the edge,
 * with no Bun stand-in and no buffering at a process boundary. Synthetic bytes only.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

const STREAM_DIGEST = fileURLToPath(new URL("../src/lib/ingest/stream-digest.ts", import.meta.url));

/** The Worker under test: each route runs one function of `stream-digest.ts` against the request body or the bucket. */
const WORKER = `
import { digestTap, streamSha256 } from ${JSON.stringify(STREAM_DIGEST)};
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const length = Number(req.headers.get("content-length"));
    if (u.pathname === "/part") {
      // A part as the part route sends it: the body tapped into DigestStream and into a FixedLengthStream for R2.
      const key = u.searchParams.get("key");
      const up = await env.VAULT.createMultipartUpload(key);
      const tap = digestTap(req.body, length);
      const [part, digest] = await Promise.all([up.uploadPart(1, tap.stream), tap.done]);
      await up.complete([part]);
      return Response.json({ digest, etag: part.etag });
    }
    if (u.pathname === "/whole") {
      // The whole-file check: the stored object's body piped straight into DigestStream.
      const obj = await env.VAULT.get(u.searchParams.get("key"));
      return Response.json({ sha256: await streamSha256(obj.body), size: obj.size });
    }
    if (u.pathname === "/short") {
      // A body shorter than its declared length must fail, never be recorded.
      const up = await env.VAULT.createMultipartUpload("short");
      const tap = digestTap(req.body, length + 10);
      try {
        await Promise.all([up.uploadPart(1, tap.stream), tap.done]);
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false });
      }
    }
    return new Response("no", { status: 404 });
  },
};
`;

let mf: Miniflare;

beforeAll(async () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const path = `${dir}.stream-worker-${process.pid}.ts`;
  await Bun.write(path, WORKER);
  try {
    const out = await Bun.build({ entrypoints: [path], format: "esm", target: "browser" });
    if (!out.success) throw new Error(out.logs.map(String).join("\n"));
    mf = new Miniflare({ modules: true, script: await out.outputs[0]!.text(), compatibilityDate: "2025-09-01", r2Buckets: ["VAULT"] });
  } finally {
    await Bun.file(path).delete();
  }
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function bytesOf(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 997) b[i] = (i * 31 + seed) & 255;
  return b;
}

describe("stream-digest on workerd", () => {
  test("a part streams into R2 through FixedLengthStream and its DigestStream digest is the part's SHA-256", async () => {
    // 5 MiB + 1: over R2's part floor, in many chunks.
    const body = bytesOf(5 * 1024 * 1024 + 1, 3);
    const res = await mf.dispatchFetch("http://x/part?key=a", { method: "PUT", body, headers: { "content-length": String(body.length) } });
    const out = (await res.json()) as { digest: string; etag: string };
    expect(out.digest).toBe(sha(body));
    const bucket = await mf.getR2Bucket("VAULT");
    const stored = await bucket.get("a");
    expect(sha(new Uint8Array(await stored!.arrayBuffer()))).toBe(sha(body));
  });

  test("the whole-file check gives the object's SHA-256 and size, and a changed byte changes it", async () => {
    const bucket = await mf.getR2Bucket("VAULT");
    const body = bytesOf(3 * 1024 * 1024 + 17, 9);
    await bucket.put("b", body);
    const out = (await (await mf.dispatchFetch("http://x/whole?key=b")).json()) as { sha256: string; size: number };
    expect(out).toEqual({ sha256: sha(body), size: body.length });
    const other = new Uint8Array(body);
    other[1234] = other[1234]! ^ 1;
    await bucket.put("c", other);
    expect(((await (await mf.dispatchFetch("http://x/whole?key=c")).json()) as { sha256: string }).sha256).not.toBe(sha(body));
  });

  test("a body shorter than the length the ticket names fails in FixedLengthStream", async () => {
    const body = bytesOf(1024, 1);
    const res = await mf.dispatchFetch("http://x/short", { method: "PUT", body, headers: { "content-length": String(body.length) } });
    expect(await res.json()).toEqual({ ok: false });
  });
});
