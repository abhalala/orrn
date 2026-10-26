const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Gate for POST /dev/seed. The deployed dev stage also runs with NODE_ENV=development, so that flag
 * alone is not enough: the seed needs the ORRN_LOCAL_PASSWORD binding (set only by
 * apps/server/wrangler.local.jsonc) and a loopback request host.
 */
export function canRunDevSeed(
  env: { NODE_ENV?: string; ORRN_LOCAL_PASSWORD?: string },
  url: string,
): boolean {
  if (env.NODE_ENV !== "development") return false;
  if (!env.ORRN_LOCAL_PASSWORD) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
