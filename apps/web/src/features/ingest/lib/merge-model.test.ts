import { describe, expect, test } from "bun:test";

import { mergePhase, mergeView, TARGET_LIST_PATH } from "./merge-model";
import { INGEST_TARGETS } from "./types";
import type { MergeCandidateResult } from "./types";

const result = (over: Partial<MergeCandidateResult> = {}): MergeCandidateResult => ({
  candidateId: "c1", target: "dies", state: "merged", reasonCode: null, reasonDetail: null, rowsWritten: 0, rowsCreate: 0, rowsUpdate: 0,
  fileName: "dies.csv", sheetName: "Sections", ...over,
});
const pump = (over: Partial<{ chunksTotal: number; chunksWritten: number; chunksFailed: number }> = {}) => ({ chunksTotal: 2, chunksWritten: 0, chunksFailed: 0, ...over });

describe("merge result (M14)", () => {
  test("done counts only imports that merged: a held import's rows are never in the headline", () => {
    const view = mergeView({ state: "done_with_holds" }, [
      result({ candidateId: "a", rowsCreate: 700, rowsUpdate: 3, rowsWritten: 703 }),
      result({ candidateId: "b", state: "held", rowsCreate: 1402, reasonCode: "merge_failed", reasonDetail: "Bundle LRCQCZ is already in orrn." }),
    ], pump({ chunksWritten: 1, chunksFailed: 1 }));
    expect(view.status).toMatchObject({ tone: "warning", value: 700, unit: { key: "ingest.merge.rowsAdded" }, meta: { key: "ingest.merge.notMergedMeta", vars: { count: 1 } } });
    expect(view.title).toEqual({ key: "ingest.merge.titleDone" });
    expect(view.announce).toEqual({ key: "ingest.merge.announceDone", vars: { created: 700, updated: 3, held: 1 } });
  });

  test("with no holds the block is green and says how many were updated", () => {
    const view = mergeView({ state: "done" }, [result({ rowsCreate: 5, rowsUpdate: 2 })], pump({ chunksWritten: 2 }));
    expect(view.status).toMatchObject({ tone: "success", value: 5, meta: { key: "ingest.merge.updatedMeta", vars: { count: 2 } } });
    expect(view.phase).toBe("done");
    expect(view.back).toEqual({ key: "ingest.merge.back" });
  });

  test("held imports come first with their reason in full and Open; merged ones after, with zero counts left out", () => {
    const view = mergeView({ state: "done_with_holds" }, [
      result({ candidateId: "a", rowsCreate: 7, rowsUpdate: 0 }),
      result({ candidateId: "b", state: "held", reasonCode: "merge_failed", reasonDetail: "Section is archived." }),
    ], pump());
    expect(view.held.map((h) => h.candidateId)).toEqual(["b"]);
    expect(view.held[0]).toMatchObject({ open: true, reason: { code: "merge_failed", detail: "Section is archived." }, chip: { words: { key: "ingest.state.held" }, tone: "info" } });
    expect(view.merged[0]!.counts).toEqual([{ key: "ingest.merge.added", vars: { n: 7 } }]);
    expect(view.merged[0]!.open).toBe(false);
  });

  test("per target a link to that list, once, only for merged imports", () => {
    const view = mergeView({ state: "done" }, [
      result({ candidateId: "a", target: "dies" }), result({ candidateId: "b", target: "dies" }), result({ candidateId: "c", target: "bundles" }),
      result({ candidateId: "d", target: "orders", state: "held" }),
    ], pump());
    expect(view.targetLinks.map((l) => l.to)).toEqual(["/dies", "/stock/bundles"]);
    expect(view.targetLinks[0]!.words).toEqual({ key: "ingest.merge.see", varKeys: { target: "ingest.target.dies" } });
    for (const t of INGEST_TARGETS) expect(TARGET_LIST_PATH[t]).toMatch(/^\//);
  });

  test("running: a blue block by rows written over rows planned, part n of total, Stop after this part", () => {
    const view = mergeView({ state: "running" }, [
      result({ candidateId: "a", state: "merging", rowsCreate: 700, rowsWritten: 350 }), result({ candidateId: "b", state: "approved", rowsCreate: 1, rowsUpdate: 0 }),
    ], pump({ chunksWritten: 0 }));
    expect(view.title).toEqual({ key: "ingest.merge.titleRunning", vars: { count: 2 } });
    expect(view.status).toMatchObject({
      tone: "info", title: { key: "ingest.state.merging" }, value: 350, unit: { key: "ingest.merge.rowsUnit", vars: { total: 701 } },
      meta: { key: "ingest.merge.running", vars: { n: 1, total: 2 } },
    });
    expect(view.status.progress).toBeCloseTo(350 / 701);
    expect(view.canStop).toBe(true);
    expect(view.all[0]!.counts).toEqual([{ key: "ingest.merge.addedOf", vars: { n: 350, total: 700 } }]);
    expect(view.announce).toBeNull();
  });

  test("planning shows no number", () => {
    const view = mergeView({ state: "planning" }, [result({ state: "approved", rowsCreate: 5 })], pump({ chunksTotal: 0 }));
    expect(view.status).toMatchObject({ value: null, unit: null, meta: { key: "ingest.merge.planning" }, progress: null });
    expect(view.canStop).toBe(true);
  });

  test("stopped: how many parts were written, and Merge the rest", () => {
    const view = mergeView({ state: "stopped" }, [result({ rowsCreate: 3 })], pump({ chunksWritten: 1 }));
    expect(view.title).toEqual({ key: "ingest.merge.titleStopped" });
    expect(view.status.meta).toEqual({ key: "ingest.merge.partsWritten", vars: { done: 1, total: 2 } });
    expect(view.mergeRest).toEqual({ key: "ingest.merge.rest" });
    expect(view.canStop).toBe(false);
    expect(view.announce).toEqual({ key: "ingest.merge.titleStopped" });
  });

  test("phases", () => {
    expect(["planning", "running", "done", "done_with_holds", "stopped"].map((s) => mergePhase(s as never))).toEqual(["planning", "running", "done", "done", "stopped"]);
  });
});
