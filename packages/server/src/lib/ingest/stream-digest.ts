/**
 * Streaming SHA-256 for the chunked upload (`upload-parts.ts`). No imports on purpose: the upload tests bundle this
 * file into a real workerd (Miniflare) so `crypto.DigestStream` and `FixedLengthStream` run as they do on the edge,
 * and the whole-file check's throughput is measured through exactly this code.
 */

/** `crypto.DigestStream` (workerd), reached through a cast: the web build type-checks this file without Workers types. */
type DigestStreamLike = WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
function newDigestStream(): DigestStreamLike {
  const C = (crypto as unknown as { DigestStream: new (algorithm: string) => DigestStreamLike }).DigestStream;
  return new C("SHA-256");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 of a stream, hex, through `crypto.DigestStream` (never buffered). Piped straight in, with no JS step per
 * chunk, so the cost does not grow with the number of chunks the body arrives in; the caller checks the size from
 * the R2 object.
 */
export async function streamSha256(body: ReadableStream): Promise<string> {
  const digest = newDigestStream();
  await body.pipeTo(digest);
  return toHex(await digest.digest);
}

/** A stream of known length (for `uploadPart`) whose bytes also run into `DigestStream`; `done` is the hex digest. */
export function digestTap(body: ReadableStream<Uint8Array>, length: number): { stream: ReadableStream; done: Promise<string> } {
  const digest = newDigestStream();
  const writer = digest.getWriter();
  const fixed = new FixedLengthStream(length);
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, c) {
      await writer.write(chunk);
      c.enqueue(chunk);
    },
    async flush() {
      await writer.close();
    },
  });
  const piped = body.pipeThrough(tap).pipeTo(fixed.writable as WritableStream<Uint8Array>);
  return { stream: fixed.readable, done: piped.then(async () => toHex(await digest.digest)) };
}
