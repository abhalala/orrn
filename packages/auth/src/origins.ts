/**
 * Web origins allowed for CORS and Better Auth `trustedOrigins`: `CORS_ORIGIN` plus the
 * comma-separated `CORS_ALLOWED_ORIGINS`, each a full origin (`https://orrn.in`). Nothing else.
 */
export function parseOriginList(...parts: (string | undefined)[]): string[] {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const entry of part.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set];
}

/** `https://orrn.in/` and `HTTPS://Orrn.in` as the browser sends them (`https://orrn.in`); other text unchanged. */
function canonicalWebOrigin(entry: string): string {
  if (!/^https?:\/\//i.test(entry)) return entry;
  try {
    return new URL(entry).origin;
  } catch {
    return entry;
  }
}

/**
 * Exact match only (security review 2026-11-04, HIGH 2): scheme, host and port must equal one
 * configured origin. There is no subdomain rule and no http twin, because the API answers these
 * origins with credentials: any `*.orrn.in` host (a plant's `*.spool.orrn.in` tunnel, or an
 * http page a network attacker serves) would otherwise read and write the API as the visitor.
 */
export function isAllowedWebOrigin(
  origin: string,
  config: { corsOrigin: string; corsAllowedOrigins?: string },
): boolean {
  if (!origin) return false;
  return parseOriginList(config.corsOrigin, config.corsAllowedOrigins).some((entry) => canonicalWebOrigin(entry) === origin);
}

export function trustedWebOrigins(config: {
  corsOrigin: string;
  corsAllowedOrigins?: string;
}): string[] {
  return parseOriginList(config.corsOrigin, config.corsAllowedOrigins);
}

/**
 * Better Auth `trustedOrigins` wildcard patterns for local web dev servers on any port. Added only
 * when NODE_ENV is "development" (see trustedOriginsFor). Same set as `isDevLocalOrigin` in
 * @orrn/server/lib/devOrigins, which the CORS middleware uses.
 */
export const DEV_LOCAL_TRUSTED_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"] as const;

export interface TrustedOriginsEnv {
  NODE_ENV?: string;
  CORS_ORIGIN?: string;
  CORS_ALLOWED_ORIGINS?: string;
}

/**
 * Better Auth `trustedOrigins` (packages/auth/src/index.ts). Production: the configured web origins
 * and the native `orrn://` scheme, nothing else. Development (local stack and the deployed dev stage)
 * also trusts Expo, the Expo web port and local web servers on any port (one per worktree).
 */
export function trustedOriginsFor(env: TrustedOriginsEnv): string[] {
  return [
    ...trustedWebOrigins({ corsOrigin: env.CORS_ORIGIN ?? "", corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS }),
    "orrn://",
    ...(env.NODE_ENV === "development"
      ? [
          "exp://",
          "exp://**",
          "exp://192.168.*.*:*/**",
          "http://localhost:8081",
          // Every worktree runs its own web port; mirrors isDevLocalOrigin in @orrn/server (CORS).
          ...DEV_LOCAL_TRUSTED_ORIGINS,
        ]
      : []),
  ];
}
