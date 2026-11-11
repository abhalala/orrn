import { POLL_MS } from "./model";

/**
 * The browser "pump" (plan A1): it calls one bounded server step after another, each carrying `expectCursor`.
 * The server moves the cursor with a compare-and-set, so a second tab gets CONFLICT. This file is the plain
 * logic with no React: `runPump` steps until done, `drivePump` also waits out another tab and takes over when
 * that tab stops moving (a closed tab loses nothing, any tab resumes from the stored cursor).
 */

/** How many polls with an unmoved cursor before this tab takes over from "another tab" (30 s at 3 s a poll). */
export const STALE_POLLS = 10;
/** Network failures retried on the same cursor before the pump reports an error. */
export const STEP_RETRIES = 2;

export type PumpError = { code: string; message: string };

/** The tRPC error code of a thrown error, or "NETWORK" for anything without one. */
export function errorCodeOf(error: unknown): string {
  const data = (error as { data?: { code?: unknown } } | null | undefined)?.data;
  if (data && typeof data.code === "string") return data.code;
  const shape = (error as { shape?: { data?: { code?: unknown } } } | null | undefined)?.shape?.data;
  if (shape && typeof shape.code === "string") return shape.code;
  return "NETWORK";
}

export function isConflict(error: unknown): boolean {
  return errorCodeOf(error) === "CONFLICT";
}

/** A call that can be sent again: no server code means the request never got an answer. */
export function isTransient(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "NETWORK" || code === "TIMEOUT" || code === "INTERNAL_SERVER_ERROR" || code === "TOO_MANY_REQUESTS";
}

export function toPumpError(error: unknown): PumpError {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return { code: errorCodeOf(error), message: typeof message === "string" ? message : "" };
}

export type PumpOutcome<R> =
  | { kind: "done"; last: R }
  | { kind: "conflict"; last: R | null }
  | { kind: "aborted"; last: R | null }
  | { kind: "error"; error: unknown; last: R | null };

export type PumpSpec<R> = {
  /** The stored cursor to send first (from the last read of the candidate or run). */
  cursor: number;
  step: (expectCursor: number) => Promise<R>;
  cursorOf: (result: R) => number;
  isDone: (result: R) => boolean;
  onStep?: (result: R) => void;
  signal?: AbortSignal;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Steps in a row that may return the same cursor, not done, before the pump reports `STALLED`. Off when unset. */
  maxStalls?: number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Steps until the server says done. Stops on CONFLICT, abort, a server refusal, or too many network failures. */
export async function runPump<R>(spec: PumpSpec<R>): Promise<PumpOutcome<R>> {
  const retries = spec.retries ?? STEP_RETRIES;
  const sleep = spec.sleep ?? realSleep;
  let cursor = spec.cursor;
  let last: R | null = null;
  let failures = 0;
  let stalls = 0;
  for (;;) {
    if (spec.signal?.aborted) return { kind: "aborted", last };
    let result: R;
    try {
      result = await spec.step(cursor);
    } catch (error) {
      if (spec.signal?.aborted) return { kind: "aborted", last };
      if (isConflict(error)) return { kind: "conflict", last };
      if (isTransient(error) && failures < retries) {
        failures += 1;
        await sleep(400 * 2 ** (failures - 1));
        continue;
      }
      return { kind: "error", error, last };
    }
    failures = 0;
    last = result;
    spec.onStep?.(result);
    if (spec.isDone(result)) return { kind: "done", last: result };
    const next = spec.cursorOf(result);
    if (spec.maxStalls !== undefined) {
      stalls = next === cursor ? stalls + 1 : 0;
      if (stalls >= spec.maxStalls) {
        return { kind: "error", error: Object.assign(new Error("The step did not move"), { data: { code: "STALLED" } }), last };
      }
    }
    cursor = next;
  }
}

export type PumpRead = { cursor: number; running: boolean };

export type DriveSpec<R> = Omit<PumpSpec<R>, "cursor"> & {
  /** Reads the stored state: used to start, and to watch another tab. */
  read: () => Promise<PumpRead>;
  onOtherTab?: (other: boolean) => void;
  pollMs?: number;
  stalePolls?: number;
};

export type DriveOutcome<R> =
  | { kind: "done"; last: R | null }
  | { kind: "aborted"; last: R | null }
  | { kind: "error"; error: unknown; last: R | null };

/**
 * `runPump` from the stored cursor; on CONFLICT it first looks once at the stored cursor: if it moved past the
 * one this tab sent, the move may be this tab's own earlier step (a step that finished after its tab effect was
 * cancelled), so the pump tries again from the stored cursor. A second CONFLICT means another tab is stepping:
 * the pump watches the stored state every `pollMs`. If the state stops running the other tab finished the work.
 * If the cursor does not move for `stalePolls` polls the other tab is gone and this tab steps from the stored
 * cursor.
 */
export async function drivePump<R>(spec: DriveSpec<R>): Promise<DriveOutcome<R>> {
  const sleep = spec.sleep ?? realSleep;
  const pollMs = spec.pollMs ?? POLL_MS;
  const stalePolls = spec.stalePolls ?? STALE_POLLS;
  let last: R | null = null;
  let fastRetry = 1;
  for (;;) {
    if (spec.signal?.aborted) return { kind: "aborted", last };
    let stored: PumpRead;
    try {
      stored = await spec.read();
    } catch (error) {
      return { kind: "error", error, last };
    }
    if (!stored.running) return { kind: "done", last };
    let sent = stored.cursor;
    const outcome = await runPump<R>({
      ...spec,
      cursor: stored.cursor,
      step: (expectCursor) => {
        sent = expectCursor;
        return spec.step(expectCursor);
      },
    });
    if (outcome.last) last = outcome.last;
    if (outcome.kind === "done") {
      spec.onOtherTab?.(false);
      return { kind: "done", last };
    }
    if (outcome.kind === "aborted") return { kind: "aborted", last };
    if (outcome.kind === "error") {
      // A step that lands after the work is finished is refused ("already checked"). If the stored state says it is
      // not running any more, the work is done and the refusal is only a late answer.
      if (errorCodeOf(outcome.error) !== "STALLED") {
        try {
          const now = await spec.read();
          if (!now.running) {
            spec.onOtherTab?.(false);
            return { kind: "done", last };
          }
        } catch {
          // keep the original error
        }
      }
      return { kind: "error", error: outcome.error, last };
    }

    // CONFLICT. A call that made progress and then conflicted is most likely this tab's own lost response, so the
    // quiet retry is available again. A conflict with no progress at all is another tab.
    if (outcome.last) fastRetry = 1;
    if (fastRetry > 0) {
      fastRetry -= 1;
      let now: PumpRead;
      try {
        now = await spec.read();
      } catch (error) {
        return { kind: "error", error, last };
      }
      if (!now.running) return { kind: "done", last };
      if (now.cursor !== sent) continue;
    }

    // Another tab holds the cursor. Watch it.
    spec.onOtherTab?.(true);
    let seen: number | undefined;
    let still = 0;
    for (;;) {
      await sleep(pollMs);
      if (spec.signal?.aborted) return { kind: "aborted", last };
      let now: PumpRead;
      try {
        now = await spec.read();
      } catch {
        still += 1;
        if (still >= stalePolls) break;
        continue;
      }
      if (!now.running) {
        spec.onOtherTab?.(false);
        return { kind: "done", last };
      }
      if (seen === undefined || now.cursor !== seen) {
        seen = now.cursor;
        still = 0;
      } else {
        still += 1;
      }
      if (still >= stalePolls) break;
    }
    spec.onOtherTab?.(false);
    // Take over: the loop reads the stored cursor again and steps.
  }
}

// ---------------------------------------------------------------------------------------------
// The bot retry pump (plan A1, B6): `shape.make` is one model call; `next` says whether to call again.
// ---------------------------------------------------------------------------------------------

export type BotCall = { outcome: string; attempt: number; model: string; next: "retry" | "escalate" | "manual" | "done" };

export type BotOutcomeKind = "done" | "capped" | "gaveUp" | "conflict" | "error" | "aborted";

/** Most model calls one click may make: 4 per block (plan B6). */
export const BOT_MAX_CALLS = 4;

/**
 * Calls `make` until the server says `done` or `manual`. `getSeq` returns the candidate's current `serverSeq`
 * before each call. `next: "retry"` or `"escalate"` calls again; `manual` ends with `capped` when the last
 * outcome was `capped`, else `gaveUp`.
 */
export async function runBotPump(spec: {
  getSeq: () => Promise<number>;
  make: (expectSeq: number) => Promise<BotCall>;
  onCall?: (call: BotCall) => void;
  signal?: AbortSignal;
  maxCalls?: number;
}): Promise<{ kind: BotOutcomeKind; last: BotCall | null; error?: unknown }> {
  let last: BotCall | null = null;
  const max = spec.maxCalls ?? BOT_MAX_CALLS;
  for (let calls = 0; calls < max; calls += 1) {
    if (spec.signal?.aborted) return { kind: "aborted", last };
    let result: BotCall;
    try {
      result = await spec.make(await spec.getSeq());
    } catch (error) {
      if (spec.signal?.aborted) return { kind: "aborted", last };
      if (isConflict(error)) return { kind: "conflict", last };
      return { kind: "error", last, error };
    }
    last = result;
    spec.onCall?.(result);
    if (result.next === "done") return { kind: "done", last };
    if (result.next === "manual") return { kind: result.outcome === "capped" ? "capped" : "gaveUp", last };
  }
  return { kind: "gaveUp", last };
}

// ---------------------------------------------------------------------------------------------
// Waiting for rows, and the phase a screen shows
// ---------------------------------------------------------------------------------------------

export type RowsRead = { missing: number; running: boolean };

/**
 * Waits while the uploading tab still has rows to send. It never gives up by itself, a slow upload may still
 * move; after `stalePolls` polls with the same number missing it raises `onStalled(true)` so the screen can tell the
 * person to drop the same file again, and clears it when the number moves. Ends when nothing is missing, the state
 * stops running, or the tab leaves.
 */
export async function waitForRows(spec: {
  read: () => Promise<RowsRead>;
  onStalled?: (stalled: boolean) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  stalePolls?: number;
}): Promise<RowsRead> {
  const sleep = spec.sleep ?? realSleep;
  const pollMs = spec.pollMs ?? POLL_MS;
  const stalePolls = spec.stalePolls ?? STALE_POLLS;
  let last: number | undefined;
  let still = 0;
  let stalled = false;
  for (;;) {
    const now = await spec.read();
    if (now.missing <= 0 || !now.running || spec.signal?.aborted) {
      if (stalled) spec.onStalled?.(false);
      return now;
    }
    if (last === undefined || now.missing !== last) {
      last = now.missing;
      still = 0;
      if (stalled) {
        stalled = false;
        spec.onStalled?.(false);
      }
    } else {
      still += 1;
      if (still >= stalePolls && !stalled) {
        stalled = true;
        spec.onStalled?.(true);
      }
    }
    await sleep(pollMs);
  }
}

export type HookPhase = "idle" | "running" | "otherTab" | "done" | "error";

/**
 * The phase a dry-run screen shows. `ui` is what the effect last set. A `running` or `otherTab` left behind when the
 * candidate stopped being processable (another tab finished it) is not shown: the effect was cancelled, so nobody is
 * going to set it right.
 */
export function dryRunPhase(a: { mine: boolean; ui: HookPhase; eligible: boolean }): HookPhase {
  if (!a.mine) return "idle";
  if ((a.ui === "running" || a.ui === "otherTab") && !a.eligible) return "idle";
  return a.ui;
}

/** The phase a merge screen shows: a finished run is done whatever a cancelled effect left, unless it ended in error. */
export function mergePhase(a: { mine: boolean; ui: HookPhase; finished: boolean }): HookPhase {
  if (a.mine && a.ui === "error") return "error";
  if (a.finished) return "done";
  if (!a.mine) return "idle";
  return a.ui;
}
