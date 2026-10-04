import { isAllowedWebOrigin } from "@orrn/auth/origins";

import { isDevLocalOrigin } from "./devOrigins";

/**
 * The `origin` callback of the API's CORS middleware (apps/server/src/index.ts).
 *
 * Returns the origin to echo in Access-Control-Allow-Origin. An origin that is not allowed (or no
 * Origin header at all) gets the one configured web origin, which the browser then rejects for any
 * other page. Production allows only CORS_ORIGIN / CORS_ALLOWED_ORIGINS; localhost origins on any
 * port are added only when NODE_ENV is "development".
 */
export function resolveCorsOrigin(
  env: { NODE_ENV?: string; CORS_ORIGIN: string; CORS_ALLOWED_ORIGINS?: string },
  origin: string,
): string {
  if (!origin) return env.CORS_ORIGIN;
  if (
    isAllowedWebOrigin(origin, {
      corsOrigin: env.CORS_ORIGIN,
      corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    }) ||
    isDevLocalOrigin(env, origin)
  ) {
    return origin;
  }
  return env.CORS_ORIGIN;
}
