import { describe, expect, test } from "bun:test";

import { checkedRows, runDryRunDrive, type DryRunCounts, type DryRunStep } from "./dry-run-drive";

const counts = (done: number, total = 4000): DryRunCounts => ({ total, create: done, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0 });
const conflict = () => Object.assign(new Error("Running in another tab"), { data: { code: "CONFLICT" } });

function fake(steps: (number | "conflict" | "error")[], opts: { running?: boolean } = {}) {
  let cursor = 0;
  let i = 0;
  const sent: number[] = [];
  const progress: (number | null)[] = [];
  const otherTab: boolean[] = [];
  return {
    sent,
    progress,
    otherTab,
    read: async () => ({ cursor, running: (opts.running ?? true) && i < steps.length, counts: counts(cursor * 200) }),
    step: async (expect: number): Promise<DryRunStep> => {
      sent.push(expect);
      const next = steps[i++];
      if (next === "conflict") {
        cursor += 1; // the other tab moved on
        throw conflict();
      }
      if (next === "error") throw Object.assign(new Error("This import is not ready to check"), { data: { code: "BAD_REQUEST" } });
      cursor = next!;
      return { cursor, done: i === steps.length, counts: counts(cursor * 200) };
    },
    onProgress: (c: DryRunCounts | null) => void progress.push(checkedRows(c)?.done ?? null),
    onOtherTab: (o: boolean) => void otherTab.push(o),
  };
}

describe("the row check a confirmed draft runs in the bubble", () => {
  test("steps from the stored cursor to the end and says done, with progress on the way", async () => {
    const f = fake([1, 2, 3]);
    const outcome = await runDryRunDrive({ ...f, signal: new AbortController().signal, sleep: async () => {} });
    expect(outcome).toBe("done");
    expect(f.sent).toEqual([0, 1, 2]);
    expect(f.progress.at(-1)).toBe(600);
  });

  test("a candidate that is not processing any more is done at once, no step", async () => {
    const f = fake([1], { running: false });
    expect(await runDryRunDrive({ ...f, signal: new AbortController().signal })).toBe("done");
    expect(f.sent).toEqual([]);
  });

  test("Stop aborts between steps and nothing more is sent", async () => {
    const ctl = new AbortController();
    const f = fake([1, 2, 3, 4]);
    const step = f.step;
    f.step = async (c) => {
      const r = await step(c);
      if (c === 1) ctl.abort();
      return r;
    };
    expect(await runDryRunDrive({ ...f, signal: ctl.signal })).toBe("aborted");
    expect(f.sent).toEqual([0, 1]);
  });

  test("another tab (CONFLICT) is waited out from the stored cursor; a refusal is a failure", async () => {
    const f = fake([1, "conflict", 3]);
    expect(await runDryRunDrive({ ...f, signal: new AbortController().signal, sleep: async () => {} })).toBe("done");
    expect(f.otherTab).toContain(true);
    expect(f.sent).toEqual([0, 1, 2]);
    const g = fake([1, "error", 3]);
    expect(await runDryRunDrive({ ...g, signal: new AbortController().signal, sleep: async () => {} })).toBe("failed");
  });

  test("checkedRows counts every row that has an answer, never past the total", () => {
    expect(checkedRows(null)).toBeNull();
    expect(checkedRows(counts(0, 0))).toBeNull();
    expect(checkedRows({ ...counts(100), refused: 50, skipped: 10 })).toEqual({ done: 160, total: 4000 });
  });
});
