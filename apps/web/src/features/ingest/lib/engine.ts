import type { ReaderEngine } from "./reader-engine";

/**
 * The reader engine on the pure readers of `@orrn/ingest` (lane C: `readers/blocks.ts`, `readers/sql.ts`,
 * `readers/pdf-text.ts`). Not wired until lane C's readers are merged; until then a read of a real file fails
 * with this message.
 */
export const engine: ReaderEngine = {
  blocksFromMatrix() {
    throw new Error("The readers of @orrn/ingest are not merged yet");
  },
  createSqlReader() {
    throw new Error("The readers of @orrn/ingest are not merged yet");
  },
  tablesFromPdfItems() {
    throw new Error("The readers of @orrn/ingest are not merged yet");
  },
};
