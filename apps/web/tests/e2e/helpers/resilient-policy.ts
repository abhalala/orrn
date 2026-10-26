/**
 * When an e2e API call may be sent again. Pure (no Playwright import) so `scripts/e2e-resilient.test.ts` can pin it.
 *
 * The local worker answers 503 for a moment while it reloads, and drops sockets (ECONNRESET, "socket hang up")
 * when several lanes saturate the machine. Those are transport hiccups, not answers: ask again with a short
 * backoff. A real refusal (4xx, a 500 with the server's sentence on a write) is never retried, so a failure the
 * app causes still fails the test at once.
 */

/** Errors Playwright throws when the socket dies before a response arrives. */
const TRANSIENT_ERROR = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|socket hang up|other side closed|network socket disconnected/i;

/** Calls that are safe to repeat after any 5xx or dropped socket: reads, sign-in (it only starts a session), the idempotent seed. */
export function isRepeatSafe(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  return m === "POST" && /\/api\/auth\/sign-in\/|\/dev\/seed(\?|$)/.test(url);
}

export type RetryDecision = { retry: boolean; why: string };

/** Decide for one outcome: a thrown error, or a status. `attempt` counts from 1. */
export function retryDecision(input: { method: string; url: string; attempt: number; maxAttempts?: number; error?: unknown; status?: number }): RetryDecision {
  const max = input.maxAttempts ?? 5;
  if (input.attempt >= max) return { retry: false, why: "out of attempts" };
  const safe = isRepeatSafe(input.method, input.url);
  if (input.error !== undefined) {
    const text = input.error instanceof Error ? input.error.message : String(input.error);
    if (!TRANSIENT_ERROR.test(text)) return { retry: false, why: "not a transport error" };
    // A refused connection never reached the worker: any call may be sent again. A reset mid-flight may have been
    // processed already: only repeat-safe calls go again.
    if (/ECONNREFUSED/i.test(text) || safe) return { retry: true, why: text.split("\n")[0]!.slice(0, 80) };
    return { retry: false, why: "write reset mid-flight (may have been applied)" };
  }
  const status = input.status ?? 0;
  if (status === 503) return { retry: true, why: "503" }; // the worker is reloading: it did not process the call
  if (safe && (status === 500 || status === 502 || status === 504)) return { retry: true, why: String(status) };
  return { retry: false, why: "answer" };
}

/** 300 ms, 600 ms, 1.2 s, 2.4 s: about 4.5 s in all, well under a test timeout. */
export function backoffMs(attempt: number): number {
  return 300 * 2 ** (attempt - 1);
}
