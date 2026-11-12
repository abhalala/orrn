import { describe, expect, test } from "bun:test";

import { keptFiles, sizeText, unfinishedFiles } from "./files-model";
import { PLAIN_FORMAT } from "./list-model";
import type { ArtifactSummary } from "./types";

const art = (over: Partial<Record<string, unknown>>): ArtifactSummary =>
  ({ id: "A", fileName: "x.pdf", sizeBytes: 100, readState: "read", createdAt: Date.UTC(2026, 10, 11), ...over }) as unknown as ArtifactSummary;

describe("files that are not candidates", () => {
  test("sizes read as B, KB and MB", () => {
    expect([sizeText(512), sizeText(1536), sizeText(2.5 * 1024 * 1024)]).toEqual(["512 B", "1.5 KB", "2.5 MB"]);
  });

  test("kept files are the ones kept and not read, newest first, with size and date", () => {
    const list = keptFiles(
      [
        art({ id: "1", readState: "kept_unread", fileName: "old.pdf", createdAt: Date.UTC(2026, 9, 1) }),
        art({ id: "2", readState: "read", fileName: "sheet.xlsx" }),
        art({ id: "3", readState: "kept_unread", fileName: "page.jpg", sizeBytes: 3 * 1024 * 1024, createdAt: Date.UTC(2026, 10, 5) }),
      ],
      PLAIN_FORMAT,
    );
    expect(list).toEqual([
      { id: "3", name: "page.jpg", size: "3 MB", date: "2026-11-05" },
      { id: "1", name: "old.pdf", size: "100 B", date: "2026-10-01" },
    ]);
  });

  test("a file still being read that this page is not sending was left half way", () => {
    const files = [art({ id: "1", readState: "reading", fileName: "a.xlsx" }), art({ id: "2", readState: "reading", fileName: "b.xlsx" }), art({ id: "3" })];
    expect(unfinishedFiles(files, new Set(["2"]))).toEqual([{ id: "1", name: "a.xlsx" }]);
    const many = Array.from({ length: 5 }, (_, i) => art({ id: String(i), readState: "reading", fileName: `f${i}.xlsx`, createdAt: 1000 + i }));
    expect(unfinishedFiles(many, new Set()).map((f) => f.id)).toEqual(["4", "3", "2"]);
  });
});
