/**
 * orrn buddy configuration (design 2026-11-18, §6, §13). One place reads the environment. Nothing here
 * returns or logs a value: the off lines name variables only.
 */
export type BuddyEnv = {
  HERMES_BASE_URL?: string | undefined;
  HERMES_ACCESS_CLIENT_ID?: string | undefined;
  HERMES_ACCESS_CLIENT_SECRET?: string | undefined;
  HERMES_API_KEY?: string | undefined;
  BUDDY_COMPANIES?: string | undefined;
};

export const HERMES_ENV_NAMES = [
  "HERMES_BASE_URL",
  "HERMES_ACCESS_CLIENT_ID",
  "HERMES_ACCESS_CLIENT_SECRET",
  "HERMES_API_KEY",
] as const;

export type HermesConfig =
  | {
      ok: true;
      /** Origin only, no trailing slash. */
      baseUrl: string;
      accessHeaders: { "CF-Access-Client-Id": string; "CF-Access-Client-Secret": string };
      apiKey: string;
    }
  | { ok: false; missing: (typeof HERMES_ENV_NAMES)[number][]; badBaseUrl?: true };

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/** All four set (and the base URL an http(s) origin) = on. Anything else = off, with the names missing. */
export function resolveHermesConfig(env: BuddyEnv): HermesConfig {
  const missing = HERMES_ENV_NAMES.filter((n) => clean(env[n]) === "");
  if (missing.length > 0) return { ok: false, missing };
  let origin: string;
  try {
    const url = new URL(clean(env.HERMES_BASE_URL));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
    origin = url.origin;
  } catch {
    return { ok: false, missing: [], badBaseUrl: true };
  }
  return {
    ok: true,
    baseUrl: origin,
    accessHeaders: {
      "CF-Access-Client-Id": clean(env.HERMES_ACCESS_CLIENT_ID),
      "CF-Access-Client-Secret": clean(env.HERMES_ACCESS_CLIENT_SECRET),
    },
    apiKey: clean(env.HERMES_API_KEY),
  };
}

const logged = new Set<string>();

/** For tests: forget which off lines were printed. */
export function resetBuddyConfigLogForTests(): void {
  logged.clear();
}

/**
 * True when the four `HERMES_*` names are set. A half-set group prints one line per isolate naming the
 * missing variables; nothing set at all is the normal "not configured" and prints nothing.
 */
export function hermesReady(env: BuddyEnv): boolean {
  const cfg = resolveHermesConfig(env);
  if (cfg.ok) return true;
  const line = cfg.badBaseUrl
    ? "buddy is off: HERMES_BASE_URL is not an http(s) origin."
    : cfg.missing.length < HERMES_ENV_NAMES.length
      ? `buddy is off: ${cfg.missing.join(", ")} not set.`
      : null;
  if (line && !logged.has(line)) {
    logged.add(line);
    console.warn(line);
  }
  return false;
}

/** The company slugs listed in `BUDDY_COMPANIES` (comma list, spaces ignored, lower case). */
export function buddyCompanies(env: BuddyEnv): ReadonlySet<string> {
  return new Set(
    clean(env.BUDDY_COMPANIES)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function companyListed(env: BuddyEnv, slug: string | null | undefined): boolean {
  return Boolean(slug) && buddyCompanies(env).has(String(slug).toLowerCase());
}
