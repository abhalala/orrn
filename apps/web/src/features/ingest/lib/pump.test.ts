import { describe, expect, test } from "bun:test";

import { drivePump, errorCodeOf, isConflict, isTransient, runPump, STALE_POLLS } from "./pump";

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
    const sent: (number | null)[] = [];
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

  test("a null stored cursor is sent as null", async () => {
    const sent: (number | null)[] = [];
    await runPump<R>({
      cursor: null,
      step: async (expect) => {
        sent.push(expect);
        return { cursor: 10, done: true };
      },
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      sleep: noSleep,
    });
    expect(sent).toEqual([null]);
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
    const sent: (number | null)[] = [];
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
    const sent: (number | null)[] = [];
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

  test("CONFLICT: shows another tab, then ends when that tab finishes", async () => {
    const flags: boolean[] = [];
    let reads = 0;
    let steps = 0;
    const out = await drivePump<R>({
      read: async () => {
        reads += 1;
        // first read starts; the second and third watch; the third says the other tab finished
        return { cursor: reads * 100, running: reads < 4 };
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
    expect(steps).toBe(1);
    expect(flags).toEqual([true, false]);
  });

  test("CONFLICT: takes over when the other tab's cursor stops moving", async () => {
    const flags: boolean[] = [];
    const sent: (number | null)[] = [];
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
    expect(steps).toBe(1);
  });
});
