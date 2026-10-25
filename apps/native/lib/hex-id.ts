/** Hex text from `bytes` random bytes (32 characters for 16). The byte source is passed in so the shape is unit-tested without a phone. */
export function hexId(bytes: number, getBytes: (count: number) => Uint8Array): string {
  const buf = getBytes(bytes);
  if (buf.length !== bytes) throw new Error("random source returned the wrong number of bytes");
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
