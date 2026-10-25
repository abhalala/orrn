import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDebouncer } from "../features/dispatch/use-debounced";
import { bandText, previewInputKey, previewInputOf, type PreviewInput } from "../features/pack/line-preview";

/** A clock the test moves by hand: timers fire in order when time passes. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    api: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (h: unknown) => void timers.delete(h as number),
    },
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    scheduled: () => timers.size,
  };
}

describe("createDebouncer (the rule behind useDebounced)", () => {
  test("the same key offered again and again settles nothing and schedules nothing", () => {
    const clock = fakeClock();
    const settled: string[] = [];
    const d = createDebouncer("a", 250, (v) => settled.push(v), clock.api);
    for (let i = 0; i < 20; i++) d.push("a");
    expect(clock.scheduled()).toBe(0);
    clock.tick(5_000);
    expect(settled).toEqual([]);
    expect(d.pending()).toBe(false);
  });

  test("a changed key settles once, after the delay", () => {
    const clock = fakeClock();
    const settled: string[] = [];
    const d = createDebouncer("a", 250, (v) => settled.push(v), clock.api);
    d.push("b");
    expect(d.pending()).toBe(true);
    clock.tick(249);
    expect(settled).toEqual([]);
    clock.tick(1);
    expect(settled).toEqual(["b"]);
    expect(d.pending()).toBe(false);
    // Offering the settled key again is not a change: no second call.
    d.push("b");
    clock.tick(1_000);
    expect(settled).toEqual(["b"]);
  });

  test("typing on restarts the delay and only the last key settles", () => {
    const clock = fakeClock();
    const settled: string[] = [];
    const d = createDebouncer("", 250, (v) => settled.push(v), clock.api);
    d.push("5");
    clock.tick(200);
    d.push("52");
    clock.tick(200);
    d.push("52.4");
    clock.tick(249);
    expect(settled).toEqual([]);
    clock.tick(1);
    expect(settled).toEqual(["52.4"]);
  });

  test("going back to the settled key before the delay cancels the wait", () => {
    const clock = fakeClock();
    const settled: string[] = [];
    const d = createDebouncer("a", 250, (v) => settled.push(v), clock.api);
    d.push("b");
    d.push("a");
    expect(d.pending()).toBe(false);
    clock.tick(1_000);
    expect(settled).toEqual([]);
  });

  test("dispose drops a waiting key", () => {
    const clock = fakeClock();
    const settled: string[] = [];
    const d = createDebouncer("a", 250, (v) => settled.push(v), clock.api);
    d.push("b");
    d.dispose();
    clock.tick(1_000);
    expect(settled).toEqual([]);
  });

  test("a fresh object each render is a change every time: this is why the preview debounces a string", () => {
    const clock = fakeClock();
    let calls = 0;
    const d = createDebouncer<object>({ x: 1 }, 250, () => calls++, clock.api);
    d.push({ x: 1 });
    expect(d.pending()).toBe(true);
    clock.tick(250);
    expect(calls).toBe(1);
  });
});

describe("the pack line preview key (I-1)", () => {
  const input = (over: Partial<PreviewInput> = {}): PreviewInput => ({ dieId: "die-1", lengthMm: 3658, weightG: 52_400, pieces: 21, ...over });

  test("equal content gives an equal key, so a new object per render does not look like a change", () => {
    expect(previewInputKey(input())).toBe(previewInputKey(input()));
    expect(previewInputKey(input({ dieInstanceId: "c1" }))).toBe(previewInputKey(input({ dieInstanceId: "c1" })));
  });

  test("every field changes the key", () => {
    const base = previewInputKey(input());
    for (const over of [{ dieId: "die-2" }, { dieInstanceId: "c1" }, { lengthMm: 1829 }, { weightG: 52_401 }, { weightG: null }, { pieces: 22 }, { pieces: null }] as const) {
      expect(previewInputKey(input(over))).not.toBe(base);
    }
  });

  test("the key reads back to the same input", () => {
    for (const i of [input(), input({ dieInstanceId: "c1" }), input({ weightG: null, pieces: null }), input({ dieId: null })]) {
      expect(previewInputOf(previewInputKey(i))).toEqual(i);
    }
  });

  test("typing the same bundle over several renders asks the server once", () => {
    const clock = fakeClock();
    const asked: string[] = [];
    const d = createDebouncer(previewInputKey(input({ weightG: null })), 250, (k) => asked.push(k), clock.api);
    for (let render = 0; render < 40; render++) {
      d.push(previewInputKey(input()));
      clock.tick(100);
    }
    expect(asked).toEqual([previewInputKey(input())]);
  });

  test("the hook debounces the key, never the object", () => {
    const src = readFileSync(join(import.meta.dir, "..", "features/pack/use-pack-server.ts"), "utf8");
    expect(src).toMatch(/useDebounced\(key,/);
    expect(src).not.toMatch(/useDebounced\(input/);
  });
});

describe("band text (m-2)", () => {
  const to = (v: { min: string; max: string }) => `${v.min} TO ${v.max}`;
  test("figures are formatted here, the word between them is the language's", () => {
    expect(bandText({ minG: 2400, maxG: 2600 }, to)).toBe("2.4 TO 2.6");
    expect(bandText({ minG: 2350, maxG: 2650 }, to)).toBe("2.350 TO 2.650");
  });
});
