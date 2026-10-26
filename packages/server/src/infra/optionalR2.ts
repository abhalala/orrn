/**
 * R2 is optional at deploy (LEDGER D10, D36). A Cloudflare account without an R2 subscription answers
 * every R2 call with HTTP 403 and code 10042 ("Please enable R2 through the Cloudflare Dashboard"), and
 * `R2Bucket(...)` would fail the whole deploy. `optionalR2Bucket` returns `undefined` instead, logs one
 * loud line per bucket, and alchemy.run.ts leaves that binding off the Worker. The runtime then answers
 * PRECONDITION_FAILED "not set up" for die files and backups and the cron skips them (docs/R2_BUCKETS.md).
 *
 * Kept free of alchemy imports so the decision is unit-tested (test/infra-optional-r2.test.ts); the
 * Cloudflare calls are passed in by alchemy.run.ts.
 *
 * Why a probe before `create`: a resource that throws inside alchemy marks the whole scope failed, which
 * skips finalize, and leaves a half-made "creating" state entry behind. The probe is a plain R2 list call
 * that fails the same way, so on an account without R2 the bucket resource is never started.
 *
 * Why `forget`: a skipped bucket must not stay in alchemy state, or finalize treats it as an orphan and
 * tries to delete it (die-files has no `delete: false`; on an account without R2 that delete is a 403 and
 * fails the deploy). Dropping the state entry never touches the bucket itself; when R2 is enabled the next
 * deploy creates or adopts it (`adopt: true`).
 */

/** Cloudflare codes that mean "R2 is not enabled on this account" (403). */
export const R2_NOT_ENABLED_CODES: ReadonlySet<number> = new Set([10042]);

const NOT_ENABLED_TEXT = /enable R2|R2 is not enabled|not (?:enabled|subscribed)|subscription/i;

type ApiErrorLike = { status?: unknown; errorData?: unknown };

function errorEntries(error: ApiErrorLike): { code: number; message: string }[] {
  const data = Array.isArray(error.errorData) ? error.errorData : [];
  return data
    .filter((e): e is { code?: unknown; message?: unknown } => !!e && typeof e === "object")
    .map((e) => ({ code: typeof e.code === "number" ? e.code : Number(e.code), message: typeof e.message === "string" ? e.message : "" }));
}

/**
 * Whether a Cloudflare API error means the account has no R2: HTTP 403 with code 10042, or 403 with a
 * 10000-series code whose message says R2 is not enabled. Text alone never matches (no status, no code),
 * and a plain auth failure (403, 10000 "Authentication error") is not this: it is rethrown.
 */
export function isR2NotEnabledError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ApiErrorLike;
  if (e.status !== 403) return false;
  return errorEntries(e).some(
    (x) => R2_NOT_ENABLED_CODES.has(x.code) || (x.code >= 10000 && x.code < 11000 && NOT_ENABLED_TEXT.test(x.message)),
  );
}

function describe(error: unknown): string {
  const e = error as ApiErrorLike;
  const entries = errorEntries(e)
    .map((x) => `[${x.code}] ${x.message}`.trim())
    .join("; ");
  return `Cloudflare ${String(e.status)}${entries ? ` ${entries}` : ""}`;
}

export type OptionalR2Options<T> = {
  /** What stops working without this bucket, for the warning ("die files", "backups"). */
  feature: string;
  /** Creates or adopts the bucket (alchemy `R2Bucket`). */
  create: () => Promise<T>;
  /** A cheap R2 call that fails like `create` would on an account without R2. Skipped when absent. */
  probe?: () => Promise<unknown>;
  /** Drops this bucket's alchemy state entry (never the bucket). */
  forget?: () => Promise<unknown>;
  env?: Record<string, string | undefined>;
  warn?: (line: string) => void;
};

/** The bucket, or `undefined` when `ORRN_SKIP_R2=1` or the account has no R2. Any other error is rethrown. */
export async function optionalR2Bucket<T>(name: string, opts: OptionalR2Options<T>): Promise<T | undefined> {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const skip = async (reason: string) => {
    await opts.forget?.();
    warn(`[deploy] R2 bucket "${name}" not created: ${reason} — ${opts.feature} disabled until R2 is enabled; re-deploy then`);
    return undefined;
  };

  if (env.ORRN_SKIP_R2 === "1") return skip("ORRN_SKIP_R2=1");

  if (opts.probe) {
    try {
      await opts.probe();
    } catch (error) {
      if (isR2NotEnabledError(error)) return skip(describe(error));
      throw error;
    }
  }

  try {
    return await opts.create();
  } catch (error) {
    // Belt and braces: the probe passed but the create still says "no R2". The scope is already marked
    // failed by alchemy (finalize is skipped this run); the next deploy's probe forgets the entry.
    if (isR2NotEnabledError(error)) return skip(describe(error));
    throw error;
  }
}
