import { describe, expect, test } from "bun:test";

import { replayKey, sendOnce, type ReplayAttempt } from "../lib/replay-key";
import { RequestTimeoutError } from "../lib/request-timeout";
import { writeFailureKind } from "../lib/request-timeout";


describe("the replay models", () => {
  let n = 0;
  const fresh = () => `id-${++n}`;

  test("the same content after an unsure answer reuses the id; new content gets a new one", () => {
    n = 0;
    const first = replayKey(null, { id: "d1", serial: "S1" }, fresh);
    expect(replayKey(first.attempt, { id: "d1", serial: "S1" }, fresh).id).toBe("id-1");
    expect(replayKey(first.attempt, { id: "d1", serial: "S2" }, fresh).id).toBe("id-2");
  });

  test("editing and going back to an earlier unsaved send reuses that send's id (it may have landed)", () => {
    n = 0;
    const a = replayKey(null, { q: 1 }, fresh);
    const b = replayKey(a.attempt, { q: 2 }, fresh);
    const c = replayKey(b.attempt, { q: 1 }, fresh);
    expect([a.id, b.id, c.id]).toEqual(["id-1", "id-2", "id-1"]);
    expect(replayKey(c.attempt, { q: 2 }, fresh).id).toBe("id-2");
    expect(replayKey(c.attempt, { q: 3 }, fresh).id).toBe("id-3");
  });

  test("a saved write ends the attempt: the next one is new even with the same content", () => {
    n = 0;
    const a = replayKey(null, { q: 1 }, fresh);
    let attempt: ReplayAttempt = a.attempt;
    attempt = null; // what every screen does on success
    expect(replayKey(attempt, { q: 1 }, fresh).id).toBe("id-2");
  });

  test("only a bounded number of earlier sends are remembered", () => {
    n = 0;
    let attempt: ReplayAttempt = null;
    for (let i = 0; i < 40; i++) attempt = replayKey(attempt, { q: i }, fresh).attempt;
    expect(Object.keys(attempt!.earlier ?? {}).length).toBeLessThanOrEqual(8);
  });

  test("sendOnce resends with the SAME key only when no reply came, never after a refusal", async () => {
    const seen: string[] = [];
    const lost = async (key: string) => {
      seen.push(key);
      if (seen.length === 1) throw new RequestTimeoutError(60_000);
      return "ok";
    };
    // a timeout carries no tRPC data, so it counts as no reply
    expect(await sendOnce(lost, "k1")).toBe("ok");
    expect(seen).toEqual(["k1", "k1"]);

    const refused = async (key: string) => {
      seen.push(key);
      throw { data: { code: "BAD_REQUEST", httpStatus: 400 }, message: "x" };
    };
    seen.length = 0;
    await expect(sendOnce(refused, "k2")).rejects.toBeDefined();
    expect(seen).toEqual(["k2"]);
  });

  test("a timed-out or 5xx write is 'unsure': the screen re-reads before offering a resend", () => {
    expect(writeFailureKind(new RequestTimeoutError(60_000))).toBe("unsure");
    expect(writeFailureKind({ data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } })).toBe("unsure");
    expect(writeFailureKind({ data: { code: "CONFLICT", httpStatus: 409 } })).toBe("failed");
  });
});
