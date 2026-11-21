// `%40`, `%2540`, ...: an address inside a URL inside a URL is encoded once per level (council r1 A8).
const EMAIL_PATTERN = /[^\s@<>"',;()]+(?:@|%(?:25)*40)[^\s@<>"',;()]+\.[^\s@<>"',;()]{2,}/gi;
const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 20_000;

/**
 * Invite links (`/invite/<token>`, also percent-encoded inside a `callbackURL`) and the reset link's
 * token (`/reset-password/<token>`). Better Auth logs a refused callback or redirect URL whole, and the
 * invite page's set-password link carries `next=/invite/<token>` (global rule: never log invite tokens
 * or links; plan 2026-11-18, Task 8 fix round 1). Council round 1, A8: a link inside a `callbackURL`
 * inside another URL is encoded once per level (`%2F`, `%252F`, `%25252F`, ...), so a slash is any
 * depth of it, in either letter case.
 */
const LINK_TOKEN_PATTERN = /((?:\/|%(?:25)*2F)(?:invite|reset-password)(?:\/|%(?:25)*2F))[^\s/?#&"'%<>]+/gi;

function redactText(value: string): string {
  return value
    .slice(0, MAX_STRING_LENGTH)
    .replace(EMAIL_PATTERN, "[redacted email]")
    .replace(LINK_TOKEN_PATTERN, "$1[redacted]");
}

function redact(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redact(item, seen, depth + 1));
    if (value instanceof Error) {
      const copy = Object.create(Object.getPrototypeOf(value)) as Error;
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if ("value" in descriptor) descriptor.value = redact(descriptor.value, seen, depth + 1);
        Object.defineProperty(copy, key, descriptor);
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return redactText(String(value));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key), redact(item, seen, depth + 1)]),
    );
  } finally {
    seen.delete(value);
  }
}

export function redactAuthLog(value: unknown): unknown {
  return redact(value, new WeakSet(), 0);
}

export function writeAuthLog(level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]): void {
  try {
    console[level](redactAuthLog(message), ...args.map(redactAuthLog));
  } catch {
    try {
      console[level](redactText(message));
    } catch {
      // Logging must never replace the auth result with a logging failure.
    }
  }
}
