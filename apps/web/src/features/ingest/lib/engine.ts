import { findBlocks, readPdfTextBlocks, SqlReader, sqlTablesToBlocks, type ReadBlock as EngineRead } from "@orrn/ingest";

import { ReadStop } from "./reader-core";
import type { EngineBlock, PdfItem, ReaderEngine } from "./reader-engine";

/** The reader engine on the pure readers of `@orrn/ingest` (plan C2: `readers/blocks`, `readers/sql`, `readers/pdf-text`). */

const toBlock = (b: EngineRead): EngineBlock => ({
  title: b.title, headerRow: b.headerRow, headerRows: b.headerRows, headers: b.headers, rows: b.rows,
});

export const engine: ReaderEngine = {
  blocksFromMatrix(matrix) {
    return findBlocks(matrix).map(toBlock);
  },

  createSqlReader() {
    const reader = new SqlReader();
    return {
      push: (chunk) => reader.push(chunk),
      finish() {
        const result = reader.finish();
        if (result.truncated) {
          throw new ReadStop({ code: "too_many_rows", rows: result.tables.reduce((n, t) => n + t.rowCount, 0) });
        }
        return sqlTablesToBlocks(result.tables).map((b) => ({ table: b.sheetName ?? "", headers: b.headers, rows: b.rows }));
      },
    };
  },

  tablesFromPdfItems(items: PdfItem[]) {
    const pages: { str: string; x: number; y: number; width: number; height: number }[][] = [];
    for (const it of items) {
      (pages[it.page - 1] ??= []).push({ str: it.text, x: it.x, y: it.y, width: it.width, height: it.height });
    }
    return readPdfTextBlocks(Array.from(pages, (p) => p ?? [])).map((b) => ({
      title: b.title, sheetName: b.sheetName, headers: b.headers, rows: b.rows,
    }));
  },
};
