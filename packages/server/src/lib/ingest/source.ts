/**
 * Provenance of a write made by the Infinity Portal merge (plan A6). The merge adapters set it on the
 * caller context they pass to `appRouter.createCaller`; the procedures they call copy it into
 * `audit_log.meta.source`. It comes from server context only: a browser cannot set ctx, so the source
 * cannot be spoofed through an input.
 */
export type IngestSource = {
  artifactId: string;
  blockId: string;
  candidateId: string;
  mergeRunId: string;
  chunkId: string;
  rowFrom: number;
  rowTo: number;
  /** Rule 5.3: rows of this write the reader doubted and a person said are right, and who. */
  confirmed?: { row: number; by: string; codes: string[] }[];
  /** Rule 7.1: lines of this order a person chose to leave out, and the note that says so. */
  skippedLines?: number;
  note?: string;
};
