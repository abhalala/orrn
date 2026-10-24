import { describe, expect, test } from "bun:test";

import type { AddBundlesReport } from "@/features/scan/scan-outcome";

import { PASTE_CHUNK, addInChunks, emptyReport, reportTotal } from "./paste";

const serials = (n: number) => Array.from({ length: n }, (_, i) => `26I${4000 + i}`);

describe("addInChunks", () => {
  test("sends at most 100 serials per request (the server and D1 limit) and merges the reports", async () => {
    const calls: string[][] = [];
    const progress: [number, number][] = [];
    const result = await addInChunks(
      serials(250),
      async (chunk) => {
        calls.push(chunk);
        return { ...emptyReport(), added: chunk.slice(0, -1), alreadyInDispatch: chunk.slice(-1) };
      },
      (done, total) => progress.push([done, total]),
    );
    expect(PASTE_CHUNK).toBe(100);
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(result.error).toBeUndefined();
    expect(result.report.added).toHaveLength(247);
    expect(result.report.alreadyInDispatch).toHaveLength(3);
    expect(progress).toEqual([
      [0, 250],
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
  });

  test("a failed chunk keeps what earlier chunks added and reports the error", async () => {
    let n = 0;
    const boom = new Error("network");
    const result = await addInChunks(serials(150), async (chunk) => {
      n += 1;
      if (n === 2) throw boom;
      return { ...emptyReport(), added: chunk };
    });
    expect(result.report.added).toHaveLength(100);
    expect(result.error).toBe(boom);
    expect(result.unsent).toHaveLength(50);
  });

  test("nothing to send sends nothing", async () => {
    let called = false;
    const result = await addInChunks([], async () => {
      called = true;
      return emptyReport();
    });
    expect(called).toBe(false);
    expect(reportTotal(result.report)).toBe(0);
  });
});

describe("reportTotal", () => {
  test("counts every serial in a report", () => {
    const r: AddBundlesReport = {
      added: ["A", "B"],
      alreadyInDispatch: ["C"],
      notFound: ["D"],
      unavailable: [{ serial: "E", reason: "Bundle is void", code: "void", status: "void", heldBy: null }],
    };
    expect(reportTotal(r)).toBe(5);
  });
});
