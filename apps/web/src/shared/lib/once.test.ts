import { describe, expect, test } from "bun:test";

import { onceGuard } from "./once";

describe("onceGuard: one request per tap", () => {
  test("a second call while the first is in flight starts nothing and answers the first", async () => {
    const guard = onceGuard<string>();
    let sent = 0;
    let release!: (v: string) => void;
    const start = () => {
      sent += 1;
      return new Promise<string>((r) => (release = r));
    };
    const a = guard.run(start);
    const b = guard.run(start);
    expect([a.started, b.started, sent]).toEqual([true, false, 1]);
    expect(guard.busy).toBe(true);
    release("done");
    expect(await a.promise).toBe("done");
    expect(await b.promise).toBe("done");
    expect(guard.busy).toBe(false);
  });

  test("after the first settles (success or refusal) the next call is sent", async () => {
    const guard = onceGuard<number>();
    await guard.run(() => Promise.reject(new Error("no"))).promise.catch(() => undefined);
    const next = guard.run(() => Promise.resolve(2));
    expect(next.started).toBe(true);
    expect(await next.promise).toBe(2);
    expect(guard.run(() => Promise.resolve(3)).started).toBe(true);
  });
});
