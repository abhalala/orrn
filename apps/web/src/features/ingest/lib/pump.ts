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
  cursor: number | null;
  step: (expectCursor: number | null) => Promise<R>;
  cursorOf: (result: R) => number | null;
  isDone: (result: R) => boolean;
  onStep?: (result: R) => void;
  signal?: AbortSignal;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Steps until the server says done. Stops on CONFLICT, abort, a server refusal, or too many network failures. */
export async function runPump<R>(spec: PumpSpec<R>): Promise<PumpOutcome<R>> {
  const retries = spec.retries ?? STEP_RETRIES;
  const sleep = spec.sleep ?? realSleep;
  let cursor = spec.cursor;
  let last: R | null = null;
  let failures = 0;
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
    cursor = spec.cursorOf(result);
  }
}

export type PumpRead = { cursor: number | null; running: boolean };

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
 * `runPump` from the stored cursor; on CONFLICT it watches the stored state every `pollMs`. If the state stops
 * running the other tab finished the work. If the cursor does not move for `stalePolls` polls the other tab is
 * gone and this tab steps from the stored cursor.
 */
export async function drivePump<R>(spec: DriveSpec<R>): Promise<DriveOutcome<R>> {
  const sleep = spec.sleep ?? realSleep;
  const pollMs = spec.pollMs ?? POLL_MS;
  const stalePolls = spec.stalePolls ?? STALE_POLLS;
  let last: R | null = null;
  for (;;) {
    if (spec.signal?.aborted) return { kind: "aborted", last };
    let stored: PumpRead;
    try {
      stored = await spec.read();
    } catch (error) {
      return { kind: "error", error, last };
    }
    if (!stored.running) return { kind: "done", last };
    const outcome = await runPump<R>({ ...spec, cursor: stored.cursor });
    if (outcome.last) last = outcome.last;
    if (outcome.kind === "done") {
      spec.onOtherTab?.(false);
      return { kind: "done", last };
    }
    if (outcome.kind === "aborted") return { kind: "aborted", last };
    if (outcome.kind === "error") return { kind: "error", error: outcome.error, last };

    // CONFLICT: another tab holds the cursor. Watch it.
    spec.onOtherTab?.(true);
    let seen: number | null | undefined;
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
