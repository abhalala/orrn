import type { MiddlewareHandler } from "hono";

/**
 * The part of a request URL the log may keep: the path, never the query string or fragment. The query
 * carries tRPC GET inputs, Better Auth's `callbackURL` (an invite's set-password link holds
 * `/invite/<token>` there) and magic-link tokens, and Workers Logs keep every line in prod. The reset
 * link carries its own token in the path (`/api/auth/reset-password/<token>`), so that segment is
 * masked too. Global rule: never log invite tokens or links (plan 2026-11-18, Task 8 fix round 1).
 */
export function loggedPath(url: string): string {
  let path: string;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? "";
  }
  return path.replace(/(\/reset-password\/)[^/]+/, "$1:token");
}

const elapsed = (start: number) => {
  const ms = Date.now() - start;
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
};

/**
 * Hono's `logger()` prints `url.slice(...)`, which keeps the query string. This one prints the same two
 * lines (`<-- METHOD path`, `--> METHOD path STATUS time`) with `loggedPath`.
 */
export function requestLogger(print: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const path = loggedPath(c.req.url);
    print(`<-- ${c.req.method} ${path}`);
    const start = Date.now();
    await next();
    print(`--> ${c.req.method} ${path} ${c.res.status} ${elapsed(start)}`);
  };
}
