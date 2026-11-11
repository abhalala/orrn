/**
 * Period storage (plan B8). The guess itself is `@orrn/ingest` period detection (lane C); this file
 * feeds it what the server has (file name, sheet names, title rows) and stores the answer on the
 * artifact. A period the system cannot tell is asked, never guessed.
 */
import type { IngestPeriodGuess } from "@orrn/db/schema/ingest";

import type { ArtifactRow, BlockRow } from "./core";

const UNKNOWN: IngestPeriodGuess = { fy: null, asOf: null, confidence: "unknown", sources: [] };

export function guessArtifactPeriod(artifact: Pick<ArtifactRow, "fileName">, blocks: readonly Pick<BlockRow, "sheetName" | "title">[]): IngestPeriodGuess {
  void artifact;
  void blocks;
  // Wired to `@orrn/ingest` period detection once lane C lands it.
  return UNKNOWN;
}
