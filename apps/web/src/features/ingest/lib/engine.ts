import {
  HintError, parseCsv, readPdfTextBlocks, readSheet, SqlReader, sqlTablesToBlocks,
  type BlockHints, type ReadBlock as EngineRead,
} from "@orrn/ingest";

import { ReadStop } from "./reader-core";
import type { EngineBlock, EngineHints, MatrixRead, PdfItem, ReaderEngine } from "./reader-engine";

/** The reader engine on the pure readers of `@orrn/ingest` (plan C2: `readers/blocks`, `readers/sql`, `readers/pdf-text`). */

const toBlock = (b: EngineRead): EngineBlock => {
  const follows = (b as { follows?: { block: number; gapRows: number; continues?: boolean } | null }).follows ?? null;
  return {
    title: b.title, headerRow: b.headerRow, headerRows: b.headerRows, headers: b.headers, rows: b.rows,
    guess: b.guess as EngineHints, hints: b.hints as EngineHints | null, preview: b.preview, width: b.width,
    firstDataSheetRow: b.firstDataSheetRow, follows,
    gaps: (b as { gaps?: number }).gaps ?? 0,
    sections: (b as { sections?: { row: number; text: string }[] }).sections ?? [],
    warnings: (b.warnings ?? []) as { code: string; row: number; text?: string }[],
  };
};

/** A hint the package cannot follow is the person's pick, not a broken file: it stops the read with its own code. */
function read(matrix: string[][], opts: MatrixRead | undefined): EngineBlock[] {
  try {
    return readSheet(matrix, { sheetName: opts?.sheetName ?? null, hints: (opts?.hints ?? null) as readonly BlockHints[] | null }).blocks.map(toBlock);
  } catch (error) {
    if (error instanceof HintError) throw new ReadStop({ code: "hint_error", detail: error.code });
    throw error;
  }
}

export const engine: ReaderEngine = {
  blocksFromMatrix(matrix, opts) {
    return read(matrix, opts);
  },

  blocksFromCsv(text, opts) {
    // The package picks the delimiter (tab or semicolon before comma when numbers carry digit grouping).
    const matrix = parseCsv(text);
    return { blocks: read(matrix, opts), rawRows: matrix.length };
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
