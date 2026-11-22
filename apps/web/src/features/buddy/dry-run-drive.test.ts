import { describe, expect, test } from "bun:test";

import { checkedRows, phaseAfterReport, runDryRunDrive, storedDryRun, type DryRunCounts, type DryRunStep } from "./dry-run-drive";

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
  test("steps from the stored cursor to the end and says it ended, with progress on the way", async () => {
    const f = fake([1, 2, 3]);
    const outcome = await runDryRunDrive({ ...f, signal: new AbortController().signal, sleep: async () => {} });
    expect(outcome).toBe("ended");
    expect(f.sent).toEqual([0, 1, 2]);
    expect(f.progress.at(-1)).toBe(600);
  });

  test("a candidate that is not processing any more ends the loop at once, no step", async () => {
    const f = fake([1], { running: false });
    expect(await runDryRunDrive({ ...f, signal: new AbortController().signal })).toBe("ended");
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
    expect(await runDryRunDrive({ ...f, signal: new AbortController().signal, sleep: async () => {} })).toBe("ended");
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

  test("the loop never says done: a table that left processing for any reason only ends it (S2, decision 3)", async () => {
    const f = fake([1], { running: false });
    const outcome = await runDryRunDrive({ ...f, signal: new AbortController().signal });
    expect(outcome).not.toBe("done" as never);
    expect(outcome).toBe("ended");
  });
});

describe("the outcome the bubble shows is the one the server stored (S2, decision 3)", () => {
  test("storedDryRun reads result.dryRun and nothing else", () => {
    expect(storedDryRun({ dryRun: { outcome: "done", state: "ready" } })).toEqual({ outcome: "done", state: "ready" });
    expect(storedDryRun({ dryRun: { outcome: "failed", state: "discarded" } })).toEqual({ outcome: "failed", state: "discarded" });
    expect(storedDryRun({ dryRun: { outcome: "stopped", state: "processing" } })).toEqual({ outcome: "stopped", state: "processing" });
    // The browser's own words are never an outcome.
    expect(storedDryRun({ report: { outcome: "done", summary: "4000 of 4000 rows checked" } })).toBeNull();
    expect(storedDryRun({ dryRun: { outcome: "finished", state: "ready" } })).toBeNull();
    expect(storedDryRun({ dryRun: { outcome: "done" } })).toBeNull();
    expect(storedDryRun(null)).toBeNull();
    expect(storedDryRun("done")).toBeNull();
  });

  test("after the report, the phase is the server's outcome with its state word; a discarded table is never done", () => {
    expect(phaseAfterReport({ result: { dryRun: { outcome: "failed", state: "discarded" } } })).toEqual({ phase: "failed", state: "discarded" });
    expect(phaseAfterReport({ result: { dryRun: { outcome: "done", state: "held" } } })).toEqual({ phase: "done", state: "held" });
    expect(phaseAfterReport({ result: { dryRun: { outcome: "stopped", state: "processing" } } })).toEqual({ phase: "stopped", state: "processing" });
  });

  test("a report that failed or came back without a stored outcome says orrn could not read it, never a guess", () => {
    expect(phaseAfterReport(null)).toEqual({ phase: "unknown", state: null });
    expect(phaseAfterReport({ result: null })).toEqual({ phase: "unknown", state: null });
    expect(phaseAfterReport({ result: { report: { outcome: "done" } } })).toEqual({ phase: "unknown", state: null });
  });
});
