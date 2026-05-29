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
