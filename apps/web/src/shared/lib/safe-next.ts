const PROBE_ORIGIN = "http://orrn.invalid";

/**
 * Post-login `next` target. Returns `next` only when it is a same-origin path:
 * starts with a single `/`, not `//` or `/\` (both read as protocol-relative by
 * browsers), has no control characters (browsers strip tabs and newlines, so
 * `/\t/evil.com` becomes `//evil.com`), and resolves to the same origin.
 * Never bounces back to the login page itself.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
