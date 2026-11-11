import { describe, expect, test } from "bun:test";

import { drivePump, errorCodeOf, isConflict, isTransient, runBotPump, runPump, STALE_POLLS } from "./pump";

const trpcError = (code: string) => Object.assign(new Error(code), { data: { code } });
const noSleep = async () => undefined;

type R = { cursor: number; done: boolean };

describe("error codes", () => {
  test("reads the tRPC code, else NETWORK", () => {
    expect(errorCodeOf(trpcError("CONFLICT"))).toBe("CONFLICT");
    expect(errorCodeOf(new TypeError("Failed to fetch"))).toBe("NETWORK");
    expect(isConflict(trpcError("CONFLICT"))).toBe(true);
    expect(isConflict(trpcError("FORBIDDEN"))).toBe(false);
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(trpcError("BAD_REQUEST"))).toBe(false);
  });
});

describe("runPump", () => {
  test("sends the stored cursor first, then each returned cursor, until done", async () => {
    const sent: number[] = [];
    const steps: R[] = [{ cursor: 200, done: false }, { cursor: 400, done: false }, { cursor: 450, done: true }];
    const seen: R[] = [];
    const out = await runPump<R>({
      cursor: 100,
      step: async (expect) => {
        sent.push(expect);
        return steps.shift()!;
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      onStep: (r) => seen.push(r),
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(sent).toEqual([100, 200, 400]);
    expect(seen.map((r) => r.cursor)).toEqual([200, 400, 450]);
  });

  test("CONFLICT stops the pump and keeps the last result", async () => {
    let n = 0;
    const out = await runPump<R>({
      cursor: 0,
      step: async () => {
        n += 1;
        if (n === 2) throw trpcError("CONFLICT");
        return { cursor: 200, done: false };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("conflict");
    expect(out.last).toEqual({ cursor: 200, done: false });
  });

  test("a network failure is retried on the same cursor, then reported", async () => {
    const sent: number[] = [];
    let fail = 2;
    const ok = await runPump<R>({
      cursor: 5,
      step: async (expect) => {
        sent.push(expect);
        if (fail-- > 0) throw new TypeError("Failed to fetch");
        return { cursor: 9, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(ok.kind).toBe("done");
    expect(sent).toEqual([5, 5, 5]);

    const bad = await runPump<R>({
      cursor: 5,
      step: async () => {
        throw new TypeError("Failed to fetch");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(bad.kind).toBe("error");
  });

  test("a server refusal is not retried", async () => {
    let calls = 0;
    const out = await runPump<R>({
      cursor: 0,
      step: async () => {
        calls += 1;
        throw trpcError("FORBIDDEN");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("error");
    expect(calls).toBe(1);
  });

  test("abort ends the pump between steps", async () => {
    const controller = new AbortController();
    let calls = 0;
    const out = await runPump<R>({
      cursor: 0,
      signal: controller.signal,
      step: async () => {
        calls += 1;
        controller.abort();
        return { cursor: calls, done: false };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("aborted");
    expect(calls).toBe(1);
  });
});

describe("drivePump", () => {
  test("resumes from the stored cursor after a closed tab", async () => {
    const sent: number[] = [];
    const out = await drivePump<R>({
      read: async () => ({ cursor: 600, running: true }),
      step: async (expect) => {
        sent.push(expect);
        return { cursor: 800, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(sent).toEqual([600]);
  });

  test("does not step a state that is not running", async () => {
    let steps = 0;
    const out = await drivePump<R>({
      read: async () => ({ cursor: 600, running: false }),
      step: async () => {
        steps += 1;
        return { cursor: 1, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(steps).toBe(0);
  });

  test("CONFLICT: a cursor that moved past ours is tried again once, quietly", async () => {
    const flags: boolean[] = [];
    const sent: number[] = [];
    let n = 0;
    const out = await drivePump<R>({
      // the first read (start) gives 100; after the conflict the stored cursor is 200 (our own earlier step landed)
      read: async () => ({ cursor: n === 0 ? 100 : 200, running: true }),
      step: async (expect) => {
        sent.push(expect);
        n += 1;
        if (n === 1) throw trpcError("CONFLICT");
        return { cursor: 300, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      onOtherTab: (other) => flags.push(other),
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(sent).toEqual([100, 200]);
    expect(flags).toEqual([false]);
  });

  test("CONFLICT: a second conflict shows another tab, then ends when that tab finishes", async () => {
    const flags: boolean[] = [];
    let reads = 0;
    let steps = 0;
    const out = await drivePump<R>({
      read: async () => {
        reads += 1;
        // distinct cursors every read; the run ends on the 6th read
        return { cursor: reads * 100, running: reads < 6 };
      },
      step: async () => {
        steps += 1;
        throw trpcError("CONFLICT");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      onOtherTab: (other) => flags.push(other),
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(steps).toBe(2);
    expect(flags).toContain(true);
    expect(flags[flags.length - 1]).toBe(false);
  });

  test("CONFLICT: takes over when the other tab's cursor stops moving", async () => {
    const flags: boolean[] = [];
    const sent: number[] = [];
    let conflicts = 1;
    const out = await drivePump<R>({
      read: async () => ({ cursor: 300, running: true }),
      step: async (expect) => {
        sent.push(expect);
        if (conflicts-- > 0) throw trpcError("CONFLICT");
        return { cursor: 400, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      onOtherTab: (other) => flags.push(other),
      sleep: noSleep,
      stalePolls: STALE_POLLS,
    });
    expect(out.kind).toBe("done");
    expect(sent).toEqual([300, 300]);
    expect(flags).toEqual([true, false, false]);
  });

  test("CONFLICT: does not take over while the other tab keeps moving", async () => {
    let reads = 0;
    let steps = 0;
    const out = await drivePump<R>({
      read: async () => {
        reads += 1;
        // the cursor moves on every poll for 30 polls, then the run ends
        return { cursor: reads * 10, running: reads < 32 };
      },
      step: async () => {
        steps += 1;
        throw trpcError("CONFLICT");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    // one quiet retry after the first conflict, then it only watches
    expect(steps).toBe(2);
  });
});

describe("runBotPump", () => {
  const call = (over: Partial<import("./pump").BotCall>): import("./pump").BotCall => ({
    outcome: "recipe", attempt: 1, model: "claude-haiku-5-5", next: "done", ...over,
  });

  test("stops at done after one call", async () => {
    const seen: number[] = [];
    const out = await runBotPump({ getSeq: async () => 7, make: async (seq) => (seen.push(seq), call({})) });
    expect(out.kind).toBe("done");
    expect(seen).toEqual([7]);
  });

  test("retry and escalate call again, each with the seq read just before", async () => {
    let seq = 1;
    const seen: number[] = [];
    const script = [call({ outcome: "invalid", attempt: 1, next: "retry" }), call({ outcome: "invalid", attempt: 2, next: "escalate", model: "claude-sonnet-5-5" }), call({ attempt: 3, next: "done" })];
    const attempts: number[] = [];
    const out = await runBotPump({
      getSeq: async () => seq++,
      make: async (s) => (seen.push(s), script.shift()!),
      onCall: (c) => attempts.push(c.attempt),
    });
    expect(out.kind).toBe("done");
    expect(seen).toEqual([1, 2, 3]);
    expect(attempts).toEqual([1, 2, 3]);
  });

  test("manual after a capped call is capped; any other manual is gaveUp", async () => {
    expect((await runBotPump({ getSeq: async () => 1, make: async () => call({ outcome: "capped", next: "manual" }) })).kind).toBe("capped");
    expect((await runBotPump({ getSeq: async () => 1, make: async () => call({ outcome: "refused", next: "manual" }) })).kind).toBe("gaveUp");
  });

  test("never more than 4 calls", async () => {
    let calls = 0;
    const out = await runBotPump({ getSeq: async () => 1, make: async () => (calls += 1, call({ outcome: "invalid", next: "retry" })) });
    expect(calls).toBe(4);
    expect(out.kind).toBe("gaveUp");
  });

  test("CONFLICT is another tab; other failures are errors", async () => {
    expect((await runBotPump({ getSeq: async () => 1, make: async () => { throw trpcError("CONFLICT"); } })).kind).toBe("conflict");
    expect((await runBotPump({ getSeq: async () => 1, make: async () => { throw trpcError("FORBIDDEN"); } })).kind).toBe("error");
  });

  test("abort stops before the next call", async () => {
    const ctl = new AbortController();
    let calls = 0;
    const out = await runBotPump({
      getSeq: async () => 1,
      make: async () => (calls += 1, ctl.abort(), call({ next: "retry", outcome: "invalid" })),
      signal: ctl.signal,
    });
    expect(out.kind).toBe("aborted");
    expect(calls).toBe(1);
  });
});

describe("stall guard", () => {
  test("a step that never moves the cursor ends as STALLED when asked to", async () => {
    let calls = 0;
    const out = await runPump<R>({
      cursor: 10,
      step: async () => (calls += 1, { cursor: 10, done: false }),
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      maxStalls: 3,
      sleep: noSleep,
    });
    expect(out.kind).toBe("error");
    expect(calls).toBe(3);
    expect(out.kind === "error" && errorCodeOf(out.error)).toBe("STALLED");
  });
  test("moving cursors reset the count", async () => {
    const cursors = [10, 20, 20, 30, 30, 40];
    const out = await runPump<R>({
      cursor: 10,
      step: async () => {
        const c = cursors.shift()!;
        return { cursor: c, done: cursors.length === 0 };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      maxStalls: 2,
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
  });
});

/** Review E7 to E9, E15, E16. */
import { dryRunPhase, mergePhase, waitForRows } from "./pump";

describe("review: pump fixes", () => {
  test("E15: two lost responses in one run never show another tab", async () => {
    const flags: boolean[] = [];
    const sent: number[] = [];
    let stored = 100;
    let calls = 0;
    const out = await drivePump<R>({
      read: async () => ({ cursor: stored, running: true }),
      step: async (expect) => {
        sent.push(expect);
        calls += 1;
        // Calls 1 and 3 land on the server but the answer is lost: the retry sees the moved cursor and conflicts.
        if (calls === 2 || calls === 4) {
          stored += 100;
          throw trpcError("CONFLICT");
        }
        if (calls === 5) return { cursor: stored + 100, done: true };
        stored += 100;
        return { cursor: stored, done: false };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      onOtherTab: (o) => flags.push(o),
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
    expect(flags).not.toContain(true);
  });

  test("E16: a step that lands after the work is finished ends as done, not an error", async () => {
    let reads = 0;
    const out = await drivePump<R>({
      // start: running; after the failed step the stored state says finished
      read: async () => ({ cursor: 200, running: reads++ === 0 }),
      step: async () => {
        throw trpcError("BAD_REQUEST");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("done");
  });

  test("E16: a real refusal while the state still runs stays an error", async () => {
    const out = await drivePump<R>({
      read: async () => ({ cursor: 200, running: true }),
      step: async () => {
        throw trpcError("BAD_REQUEST");
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(out.kind).toBe("error");
  });

  test("E7: a phase left at running or otherTab does not outlive the work", () => {
    expect(dryRunPhase({ mine: true, ui: "otherTab", eligible: false })).toBe("idle");
    expect(dryRunPhase({ mine: true, ui: "running", eligible: false })).toBe("idle");
    expect(dryRunPhase({ mine: true, ui: "otherTab", eligible: true })).toBe("otherTab");
    expect(dryRunPhase({ mine: true, ui: "done", eligible: false })).toBe("done");
    expect(dryRunPhase({ mine: true, ui: "error", eligible: false })).toBe("error");
    expect(dryRunPhase({ mine: false, ui: "running", eligible: true })).toBe("idle");
  });

  test("E7: a finished run is done whatever the stale ui phase says", () => {
    expect(mergePhase({ mine: true, ui: "otherTab", finished: true })).toBe("done");
    expect(mergePhase({ mine: true, ui: "running", finished: true })).toBe("done");
    expect(mergePhase({ mine: true, ui: "error", finished: true })).toBe("error");
    expect(mergePhase({ mine: true, ui: "otherTab", finished: false })).toBe("otherTab");
    expect(mergePhase({ mine: false, ui: "otherTab", finished: false })).toBe("idle");
  });

  test("E9: rows that stop arriving raise a stalled flag after 30 s and it clears when they move", async () => {
    const stalled: boolean[] = [];
    const missing = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 0];
    let i = 0;
    const out = await waitForRows({
      read: async () => ({ missing: missing[Math.min(i++, missing.length - 1)]!, running: true }),
      onStalled: (s) => stalled.push(s),
      sleep: noSleep,
    });
    expect(out.missing).toBe(0);
    expect(stalled).toContain(true);
    expect(stalled[stalled.length - 1]).toBe(false);
  });

  test("E9: waiting never gives up by itself: a slow upload may still come", async () => {
    let i = 0;
    const out = await waitForRows({
      read: async () => ({ missing: i++ < 500 ? 3 : 0, running: true }),
      sleep: noSleep,
    });
    expect(i).toBe(501);
    expect(out.missing).toBe(0);
  });

  test("E9: it stops waiting when the state stops running or the tab leaves", async () => {
    const ended = await waitForRows({ read: async () => ({ missing: 3, running: false }), sleep: noSleep });
    expect(ended.running).toBe(false);
    const ctl = new AbortController();
    const aborted = await waitForRows({
      read: async () => (ctl.abort(), { missing: 3, running: true }),
      signal: ctl.signal,
      sleep: noSleep,
    });
    expect(aborted.missing).toBe(3);
  });
});
