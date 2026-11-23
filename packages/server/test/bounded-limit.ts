/**
 * Per-test limits for the long bounded files (ingest-merge-bounded, ingest-bounded-targets*).
 *
 * Each test keeps its own limit, but the limit is timed here, not by Bun. When Bun times a test out
 * it walks away from the body (the merge step in flight keeps running), kills the Miniflare child as
 * a dangling process, and the next test cannot connect; afterAll then disposes Miniflare under the
 * running step and its error lands as "Unhandled error between tests" (CI run 44852373688), and
 * every later test of the file fails with "Attempted to use poisoned stub" (CI run 45099150888:
 * one slow test in ingest-bounded-targets, 18 failures). So when a limit passes, the API callers
 * that test made refuse their next call, the body is awaited until it stops, and the test fails as
 * timed out at its own limit, however soon the body stops after that. Bun gets the limit plus
 * DRAIN_MS only as a backstop.
 *
 * Use: `const limits = boundedLimits();` once per file, wrap every tRPC caller the tests use with
 * `limits.guard(...)` (when it is made, during the test), declare tests with `limits.test(name,
 * body, limitMs)`, and call `await limits.drain()` in afterAll before disposing the env.
 */
import { test as bunTest } from "bun:test";

export const DRAIN_MS = 120_000;

/** One per test: set when that test's limit passes. Callers made during the test read it on every call. */
type Stop = { stopped: boolean };

/** A tRPC caller whose every call throws once `stop` is set. Calls already made are left to finish. */
function guardedBy<T>(node: T, stop: Stop): T {
  if (node === null || (typeof node !== "object" && typeof node !== "function")) return node;
  return new Proxy(node as object, {
    get: (target, prop) => guardedBy(Reflect.get(target, prop), stop),
    apply(target, self, args) {
      if (stop.stopped) throw new Error("this test's limit has passed: call refused");
      return Reflect.apply(target as (...a: unknown[]) => unknown, self, args);
    },
  }) as T;
}

export function boundedLimits() {
  let currentStop: Stop = { stopped: false };
  /** Bodies that have not settled yet (each promise never rejects), awaited before Miniflare is disposed. */
  const bodies = new Set<Promise<unknown>>();

  /** Tie a caller to the test running now: once that test's limit passes, its calls are refused. */
  function guard<T>(node: T): T {
    return guardedBy(node, currentStop);
  }

  function test(name: string, body: () => Promise<void>, limitMs: number) {
    bunTest(
      name,
      async () => {
        const stop: Stop = { stopped: false };
        currentStop = stop;
        const settled = body().then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        bodies.add(settled);
        void settled.then(() => bodies.delete(settled));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<"late">((resolve) => {
          timer = setTimeout(() => resolve("late"), limitMs);
        });
        const first = await Promise.race([settled, limit]);
        clearTimeout(timer);
        if (first === "late") {
          stop.stopped = true;
          let drainTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([settled, new Promise((resolve) => (drainTimer = setTimeout(resolve, DRAIN_MS)))]);
          clearTimeout(drainTimer);
          throw new Error(`Test "${name}" timed out after ${limitMs}ms`);
        }
        if (!first.ok) throw first.error;
      },
      limitMs + DRAIN_MS + 10_000,
    );
  }

  /** For afterAll: refuse further calls and wait for every body still running. */
  async function drain() {
    currentStop.stopped = true;
    await Promise.all(bodies);
  }

  return { test, guard, drain };
}
