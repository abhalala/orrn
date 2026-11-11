import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { IngestApi } from "./api";

// `actions.ts` reaches the tRPC client through `queries.ts`, which reads the web env when it loads. The tests never
// call the real client: they pass a fake api.
process.env.VITE_SERVER_URL ??= "http://localhost:3000";
const { makeIngestActions } = await import("./actions");

type Call = [string, unknown];

/** A fake api that records each call. Only what these actions touch is filled in. */
function fake(over: Partial<IngestApi> = {}) {
  const calls: Call[] = [];
  const rec = <T>(name: string, value: T) => (input?: unknown) => {
    calls.push([name, input]);
    return Promise.resolve(value);
  };
  const api = {
    candidateRelease: rec("release", {}),
    candidateApprove: rec("approve", {}),
    candidateHold: rec("hold", {}),
    candidateDiscard: rec("discard", {}),
    candidateGet: rec("get", { serverSeq: 50 }),
    rowsList: rec("list", { items: [], nextCursor: null }),
    rowsDecide: rec("decide", {}),
    periodConfirm: rec("period", {}),
    ...over,
  } as unknown as IngestApi;
  const qc = new QueryClient();
  const invalidated: unknown[] = [];
  qc.invalidateQueries = ((filters: { queryKey: unknown }) => {
    invalidated.push(filters.queryKey);
    return Promise.resolve();
  }) as never;
  return { actions: makeIngestActions(qc, (() => api) as never), calls, invalidated };
}

const flagged = (id: string, field = "weightG", decision: string | null = null) => ({ id, decision, reasons: [`magnitude:${field}`, `q:magnitude_check:${field}`] });

describe("Check again on a held import (M15)", () => {
  test("calls the release route with the import's serverSeq and refreshes the candidate, the lists and the files", async () => {
    const { actions, calls, invalidated } = fake();
    await actions.release("c1", 7);
    expect(calls).toEqual([["release", { candidateId: "c1", expectSeq: 7 }]]);
    expect(invalidated).toContainEqual(["ingest", "candidate", "c1"]);
    expect(invalidated).toContainEqual(["ingest", "candidates"]);
    expect(invalidated).toContainEqual(["ingest", "artifacts"]);
    expect(invalidated).toContainEqual(["ingest", "rows", "c1"]);
  });

  test("a stale serverSeq rejects, so the screen can refresh and ask again", async () => {
    const { actions } = fake({ candidateRelease: () => Promise.reject(Object.assign(new Error("stale"), { data: { code: "CONFLICT" } })) } as never);
    await expect(actions.release("c1", 1)).rejects.toThrow("stale");
  });
});

describe("hold and discard", () => {
  test("hold passes the reason, and no reason is allowed", async () => {
    const { actions, calls } = fake();
    await actions.hold("c1", 3, "Wait for the owner");
    await actions.hold("c2", 4);
    expect(calls).toEqual([["hold", { candidateId: "c1", reason: "Wait for the owner", expectSeq: 3 }], ["hold", { candidateId: "c2", reason: undefined, expectSeq: 4 }]]);
  });
  test("discard calls the server with the seq", async () => {
    const { actions, calls } = fake();
    await actions.discard("c1", 9);
    expect(calls[0]).toEqual(["discard", { candidateId: "c1", expectSeq: 9 }]);
  });
});

describe("Approve all N (lead answer 4)", () => {
  test("each import is approved with its own seq; one refusal does not stop the others", async () => {
    const { actions, calls } = fake({
      candidateApprove: (input: { candidateId: string }) =>
        input.candidateId === "b" ? Promise.reject(new Error("Answer every question first")) : Promise.resolve({}),
    } as never);
    const result = await actions.approveMany([{ id: "a", serverSeq: 1 }, { id: "b", serverSeq: 2 }, { id: "c", serverSeq: 3 }]);
    expect(result.approved).toEqual(["a", "c"]);
    expect(result.failed.map((f) => f.id)).toEqual(["b"]);
    expect(calls).toEqual([]);
  });
  test("the order is the order given, and the lists refresh once at the end", async () => {
    const { actions, calls, invalidated } = fake();
    await actions.approveMany([{ id: "x", serverSeq: 5 }, { id: "y", serverSeq: 6 }]);
    expect(calls.map(([, input]) => (input as { candidateId: string }).candidateId)).toEqual(["x", "y"]);
    expect(invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(["ingest", "candidates"]))).toHaveLength(1);
  });
});

describe("skip the flagged rows of a column (magnitude_check)", () => {
  test("reads the ambiguous rows, picks those flagged for this field with no decision, and skips them", async () => {
    const { actions, calls } = fake({
      rowsList: (input: { cursor?: string }) =>
        Promise.resolve(
          input.cursor === undefined
            ? { items: [flagged("r1"), flagged("r2", "lengthMm"), flagged("r3", "weightG", "skip"), { id: "r4", decision: null, reasons: ["ambiguous:customer"] }], nextCursor: "3" }
            : { items: [flagged("r5")], nextCursor: null },
        ),
    } as never);
    const n = await actions.skipFlaggedRows("c1", "weightG", 10);
    expect(n).toBe(2);
    expect(calls).toEqual([["decide", { candidateId: "c1", rowIds: ["r1", "r5"], decision: "skip", expectSeq: 10 }]]);
  });
  test("nothing flagged is no call, and a long list is sent 200 at a time with a fresh seq", async () => {
    const none = fake();
    expect(await none.actions.skipFlaggedRows("c1", "weightG", 1)).toBe(0);
    expect(none.calls.some(([name]) => name === "decide")).toBe(false);

    const many = Array.from({ length: 450 }, (_, i) => flagged(`r${i}`));
    const { actions, calls } = fake({ rowsList: () => Promise.resolve({ items: many, nextCursor: null }) } as never);
    await actions.skipFlaggedRows("c1", "weightG", 10);
    const decides = calls.filter(([name]) => name === "decide").map(([, input]) => input as { rowIds: string[]; expectSeq: number });
    expect(decides.map((d) => d.rowIds.length)).toEqual([200, 200, 50]);
    expect(decides.map((d) => d.expectSeq)).toEqual([10, 50, 50]);
  });
});
