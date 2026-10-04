/**
 * Web origins allowed for CORS and Better Auth `trustedOrigins`.
 * `CORS_ALLOWED_ORIGINS` covers extra apex hosts (e.g. orrn.app when API cookies use .orrn.in).
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

export function isAllowedWebOrigin(
  origin: string,
  config: { corsOrigin: string; corsAllowedOrigins?: string },
): boolean {
  const explicit = parseOriginList(config.corsOrigin, config.corsAllowedOrigins);
  if (explicit.includes(origin)) return true;

  const baseHost = config.corsOrigin.replace(/^https?:\/\//, "");
  const originHost = origin.replace(/^https?:\/\//, "");
  return originHost === baseHost || originHost.endsWith(`.${baseHost}`);
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
