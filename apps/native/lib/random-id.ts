/**
 * A random hex id of `bytes` bytes (32 hex characters for 16). Used for the install id and for
 * replay keys, which need to be unique, not secret. Uses the platform's secure generator when it has
 * one (`crypto.getRandomValues`), else Math.random, which Hermes always has.
 */
export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
