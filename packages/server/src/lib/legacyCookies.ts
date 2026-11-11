import type { MiddlewareHandler } from "hono";
import { inArray } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { session } from "@orrn/db/schema/auth";

/**
 * Security review 2026-11-04, CRITICAL 1. Until this change the auth cookies were
 * `__Secure-better-auth.*` with `Domain=.orrn.in` (prod) or `.orrn.app` (dev stage), so a browser
 * sent them to every subdomain. They are now host-only `__Host-better-auth.*` cookies
 * (packages/auth/src/index.ts). A browser keeps the old ones until they expire (up to 7 days) and
 * goes on sending them to every subdomain. On any API request that still carries one, this:
 *   - clears it, host-only and on the old parent domain (`LEGACY_COOKIE_DOMAIN`), and
 *   - ends the session its token names, so a copy taken from a subdomain is worthless.
 * Ending it costs the user nothing: the API no longer reads that cookie name. Remove this, and
 * the binding, once no old cookie can be alive (30 days after the deploy is plenty).
 */
export const LEGACY_AUTH_COOKIE_PREFIX = "__Secure-better-auth.";
const LEGACY_SESSION_COOKIE = `${LEGACY_AUTH_COOKIE_PREFIX}session_token`;

export type LegacyAuthCookies = { names: string[]; sessionTokens: string[] };

/** The old auth cookie names in a Cookie header, and the session tokens they carry. */
export function legacyAuthCookies(cookieHeader: string | null | undefined): LegacyAuthCookies {
  const names: string[] = [];
  const sessionTokens: string[] = [];
  if (!cookieHeader || !cookieHeader.includes(LEGACY_AUTH_COOKIE_PREFIX)) return { names, sessionTokens };
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name.startsWith(LEGACY_AUTH_COOKIE_PREFIX) || names.includes(name)) continue;
    names.push(name);
    if (name !== LEGACY_SESSION_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value; a malformed one simply matches no session.
    }
    // A signed Better Auth cookie is `<token>.<signature>`; the token has no dot.
    const token = value.split(".")[0] ?? "";
    if (token) sessionTokens.push(token);
  }
  return { names, sessionTokens };
}

/** Set-Cookie values that expire each name host-only and, when given, on the old parent domain. */
export function clearLegacyCookieHeaders(names: readonly string[], legacyDomain?: string): string[] {
  const domain = legacyDomain?.trim();
  const base = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=None";
  const headers: string[] = [];
  for (const name of names) {
    headers.push(`${name}=; ${base}`);
    if (domain) headers.push(`${name}=; ${base}; Domain=${domain}`);
  }
  return headers;
}

export function legacyCookieCleanup(opts: {
  legacyDomain: () => string | undefined;
  db: () => OrrnDb;
}): MiddlewareHandler {
  return async (c, next) => {
    const legacy = legacyAuthCookies(c.req.header("cookie"));
    await next();
    if (legacy.names.length === 0) return;
    if (legacy.sessionTokens.length > 0) {
      try {
        await opts.db().delete(session).where(inArray(session.token, legacy.sessionTokens));
      } catch (error) {
        // The cookie is still cleared below; the session also ends when it expires.
        console.error("legacy session clean-up failed:", (error as Error)?.name);
      }
    }
    // A copy, so a Response with immutable headers (a fetch result) can still take the cookies.
    const res = new Response(c.res.body, c.res);
    for (const header of clearLegacyCookieHeaders(legacy.names, opts.legacyDomain())) {
      res.headers.append("set-cookie", header);
    }
    c.res = res;
  };
}
