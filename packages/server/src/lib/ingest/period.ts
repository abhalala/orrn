/**
 * Period storage (plan B8). The guess itself is `detectPeriod` from `@orrn/ingest` (lane C); this file
 * feeds it what the server has (file name, sheet names, title rows) and the result is stored on the
 * artifact. A period the system cannot tell is asked, never guessed.
 */
import { detectPeriod } from "@orrn/ingest";
import type { IngestPeriodGuess } from "@orrn/db/schema/ingest";

import { now } from "../clock";
import type { ArtifactRow, BlockRow } from "./core";

export function guessArtifactPeriod(
  artifact: Pick<ArtifactRow, "fileName">,
  blocks: readonly Pick<BlockRow, "sheetName" | "title">[],
): IngestPeriodGuess {
  return detectPeriod({
    fileName: artifact.fileName,
    sheetNames: blocks.map((b) => b.sheetName).filter((s): s is string => !!s),
    titles: blocks.map((b) => b.title),
    currentYear: now().getUTCFullYear(),
  });
}
