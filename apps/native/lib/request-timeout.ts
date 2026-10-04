/**
 * Request timeouts for every call the app makes (tRPC and Better Auth).
 *
 * React Native's iOS fetch waits up to 60 s (the NSURLRequest default) and its
 * Android client has no timeout at all, so on plant Wi-Fi whose uplink has
 * dropped (connected, but nothing comes back) a request just hangs: the cold
 * start sat on the splash and the sign-in button spun for a minute or more.
 * Ten seconds is long for a floor screen and still generous for a slow 4G
 * link. Pure (no React Native imports) so bun tests can load it.
 *
 * Reads and sign-in use REQUEST_TIMEOUT_MS. tRPC saves use MUTATION_TIMEOUT_MS
 * (lib/trpc-links.ts): giving up on the phone does not undo the server's work.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The ceiling for a tRPC save. A save can commit at once while its reply takes
 * long to come back on a weak uplink; cutting it off at 10 s showed a saved
 * pack session as failed and invited a second one (bundle.createReceipt and
 * dispatch.create take no request id). Long, but still finite: Android's fetch
 * would otherwise wait forever.
 */
export const MUTATION_TIMEOUT_MS = 60_000;

/** Thrown when orrn sends nothing back within the timeout. */
export class RequestTimeoutError extends Error {
  override name = "TimeoutError";
  constructor(
    readonly ms: number,
    options?: { cause?: unknown },
  ) {
    super(`No answer from orrn within ${Math.round(ms / 1000)} s`, options);
  }
}

/** True for a RequestTimeoutError, also when tRPC wraps it as a TRPCClientError's `cause`. */
export function isRequestTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ((current as { name?: unknown }).name === "TimeoutError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * What a failed save means to the person. "unsure": orrn never gave its own
 * answer (a timeout, a dropped connection, a reply that is not orrn's), so the
 * save may have landed; the screen says "Not sure it saved" and re-reads (or
 * resends the same client request id) before it offers to try again.
 * "failed": orrn answered with an error, so nothing was saved and trying again
 * is safe.
 */
export function writeFailureKind(error: unknown): "unsure" | "failed" {
  if (isRequestTimeout(error)) return "unsure";
  const status = (error as { data?: { httpStatus?: unknown } | null } | null | undefined)?.data?.httpStatus;
  return typeof status === "number" ? "failed" : "unsure";
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Wrap a fetch so it aborts after `ms`. The caller's own signal (React Query
 * cancelling a query) still aborts it and keeps its AbortError. A timeout
 * rejects with RequestTimeoutError so the gate can tell it from a cancel.
 * Hermes may lack `AbortSignal.timeout`/`any`, so this uses a plain
 * AbortController and setTimeout.
 */
export function fetchWithTimeout(fetchImpl: FetchLike, ms: number = REQUEST_TIMEOUT_MS): FetchLike {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const outer = init.signal;
    const onOuterAbort = () => controller.abort();
    if (outer?.aborted) controller.abort();
    else outer?.addEventListener("abort", onOuterAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new RequestTimeoutError(ms, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  };
}
