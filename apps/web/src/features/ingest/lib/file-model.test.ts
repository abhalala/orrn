import { describe, expect, test } from "bun:test";

import { fileRows, fileSubtitle, fileYear, vaultWords } from "./file-model";
import type { ArtifactDetail, CandidateSummary } from "./types";

const counts = { total: 5, create: 3, update: 1, unchanged: 0, ambiguous: 0, conflict: 0, refused: 1, skipped: 0, written: 0 };
const cand = (over: Partial<CandidateSummary> = {}): CandidateSummary => ({
  id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null, fit: "exact", fitScore: 950,
  state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 1, dryCursor: 0, counts, openQuestions: 0, botAttempts: 0,
  recipeLocked: false, fileName: "dies.csv", sheetName: "Sections", blockOrdinal: 0, updatedAt: 0, ...over,
});
const block = (id: string, headers: string[], candidates: CandidateSummary[]): ArtifactDetail["blocks"][number] =>
  ({ id, ordinal: 0, sheetName: null, title: null, headerRow: 0, headerRows: 1, headers, kinds: [], headerKey: "", columnCount: headers.length, rowCount: 5, rowsPut: 5, sample: [], readBy: "parser", modelChecked: false, canonicalStored: true, candidates }) as ArtifactDetail["blocks"][number];

describe("file rows", () => {
  test("one row for each import of each table, with that table's columns and the list's action", () => {
    const blocks = [
      block("b1", ["Series", "Section code"], [cand({ id: "c1" })]),
      block("b2", ["Name"], [cand({ id: "c2", blockId: "b2", target: null, sheetName: null, state: "needs_shape", fit: "none" })]),
    ];
    const rows = fileRows(blocks, { merge: true, upload: true });
    expect(rows.map((r) => r.row.id)).toEqual(["c1", "c2"]);
    expect(rows[0]!.columns).toEqual(["Series", "Section code"]);
    expect(rows[0]!.row.action?.kind).toBe("approve");
    expect(rows[0]!.row.numbers).toEqual({ create: 3, update: 1, questions: 0, cannot: 1 });
    expect(rows[1]!.row.title).toEqual({ kind: "newTable", key: "ingest.list.newTable", sheetName: null });
    expect(rows[1]!.row.fit).toBeNull();
    expect(rows[1]!.row.action?.kind).toBe("mapColumns");
  });
  test("a person who cannot merge gets Review, not Approve", () => {
    const rows = fileRows([block("b1", [], [cand()])], { merge: false, upload: true });
    expect(rows[0]!.row.action?.kind).toBe("review");
  });
});

describe("file header lines", () => {
  test("the subtitle has rows, tables and the day; the vault line has a word for every state", () => {
    expect(fileSubtitle({ rowCount: 1400, blockCount: 2, createdAt: 5 }, () => "11 Nov 2026")).toEqual({
      key: "ingest.file.subtitleNoName", vars: { rows: 1400, tables: 2, date: "11 Nov 2026" },
    });
    expect(vaultWords("stored").key).toBe("ingest.vault.stored");
    expect(vaultWords("not_stored").key).toBe("ingest.vault.notStored");
    expect(vaultWords("pending").key).toBe("ingest.vault.pending");
  });
});

describe("the year line of a file", () => {
  const file = (target: CandidateSummary["target"], periodConfirmed: ArtifactDetail["periodConfirmed"] = null) => ({
    period: null, periodConfirmed, blocks: [block("b1", [], [cand({ target })])],
  });
  test("is not shown for a file with no orders or bundles", () => {
    expect(fileYear(file("dies"), (iso) => iso)).toEqual({ show: false });
  });
  test("asks once for a file of bundles, and says the saved year after", () => {
    expect(fileYear(file("bundles"), (iso) => iso, new Date("2026-11-11"))).toMatchObject({ show: true, mode: "ask" });
    const saved = fileYear(file("orders", { fy: "2025-26", asOf: "2026-03-31" }), (iso) => `on ${iso}`);
    expect(saved).toMatchObject({ show: true, mode: "saved", saved: { key: "ingest.period.done", vars: { fy: "2025-26", date: "on 2026-03-31" } } });
  });
});
