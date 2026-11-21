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
  /** The buddy's own Hermes profile (owner decision 2026-11-20). Unset = `orrn-buddy`. */
  BUDDY_HERMES_PROFILE?: string | undefined;
  /** `development` (local and the dev stage) allows an `http://localhost` Hermes for the fake. */
  NODE_ENV?: string | undefined;
};

/** The buddy's Hermes profile when `BUDDY_HERMES_PROFILE` is unset (owner decision 2026-11-20). */
export const DEFAULT_BUDDY_HERMES_PROFILE = "orrn-buddy";
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

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
      /** The Hermes profile new links get (`BUDDY_HERMES_PROFILE`, else `orrn-buddy`). */
      profile: string;
    }
  | { ok: false; missing: (typeof HERMES_ENV_NAMES)[number][]; badBaseUrl?: true; badProfile?: true };

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
  const profile = buddyHermesProfile(env);
  if (!profile) return { ok: false, missing: [], badProfile: true };
  return {
    ok: true,
    baseUrl: origin,
    accessHeaders: {
      "CF-Access-Client-Id": clean(env.HERMES_ACCESS_CLIENT_ID),
      "CF-Access-Client-Secret": clean(env.HERMES_ACCESS_CLIENT_SECRET),
    },
    apiKey: clean(env.HERMES_API_KEY),
    profile,
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
    : cfg.badProfile
      ? "buddy is off: BUDDY_HERMES_PROFILE is not a profile name."
      : cfg.missing.length < HERMES_ENV_NAMES.length
      ? `buddy is off: ${cfg.missing.join(", ")} not set.`
      : null;
  if (line && !logged.has(line)) {
    logged.add(line);
    console.warn(line);
  }
  return false;
}

/**
 * The Hermes profile a new `buddy_link` gets: `BUDDY_HERMES_PROFILE`, else `orrn-buddy`. Null when the value is not
 * a plain profile name (letters, digits, `_` and `-`), so a bad value can never reach the chat path.
 */
export function buddyHermesProfile(env: BuddyEnv): string | null {
  const v = clean(env.BUDDY_HERMES_PROFILE) || DEFAULT_BUDDY_HERMES_PROFILE;
  return PROFILE_NAME.test(v) ? v : null;
}

/** The chat endpoint for one profile: `<origin>/p/<profile>/v1/responses`. Null for a name that is not a profile name. */
export function hermesChatUrl(baseUrl: string, profile: string | null | undefined): string | null {
  if (!profile || !PROFILE_NAME.test(profile)) return null;
  return `${baseUrl}/p/${profile}/v1/responses`;
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
