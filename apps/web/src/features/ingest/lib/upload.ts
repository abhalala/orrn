import type { IngestApi } from "./api";
import type { ReadProgress } from "./reader-protocol";
import type { FileProblem } from "./limits";
import type { ArtifactKind, IngestLimits } from "./types";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet`);
};

/**
 * Where a file is in the upload. The screen shows the step with these keys:
 * `hashing`, `reading` (`ingest.read.reading` with sheet and rows), `saving` (`ingest.read.uploading`),
 * `sending` (rows going to the server), `done`, `seenBefore` (`ingest.drop.seenBefore`), `refused`
 * (`problem` holds the key and variables) and `failed` (`ingest.read.failed`).
 */
export type UploadStep = "queued" | "hashing" | "reading" | "saving" | "sending" | "done" | "seenBefore" | "refused" | "failed";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  kind: ArtifactKind | null;
  step: UploadStep;
  /** Latest reader progress, for the bar. */
  progress: ReadProgress | null;
  /** Rows sent so far and in all, for the bar while `sending`. */
  sent: { rows: number; total: number } | null;
  artifactId: string | null;
  /** For `seenBefore`: when the file was first uploaded. */
  seenOn: string | number | null;
  /** The raw bytes were not kept (no storage on this plant). */
  notStored: boolean;
  problem: FileProblem | null;
};

export type UploadClientDeps = {
  api: IngestApi;
  limits: IngestLimits;
  /** Defaults to `fetch`. */
  fetch?: typeof fetch;
};

/** What the upload needs from the reader: injected so tests can use a fake. */
export type UploadReader = {
  hash: (file: File, signal?: AbortSignal) => Promise<string>;
  read: (
    file: File,
    opts: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal },
  ) => Promise<import("./reader-client").ReadResult>;
};

/**
 * Sends one file through the whole path (plan A1, A2): hash, `artifact.begin`, the raw PUT and `commitRaw`
 * when a ticket came back, the read, `putBlocks` (50 blocks a call), `putRows` (500 rows a call with
 * `expectRowsPut`), `complete`, then the canonical rows as gzip to each canonical ticket. A file the
 * server already holds and has read opens that artifact (`seenBefore`) and sends nothing.
 */
export function uploadOneFile(
  file: File,
  deps: UploadClientDeps & { reader: UploadReader },
  hooks: { onItem: (patch: Partial<UploadItem>) => void; signal?: AbortSignal; note?: string },
): Promise<{ artifactId: string | null; step: UploadStep }> {
  void file;
  void deps;
  void hooks;
  return notBuilt("uploadOneFile");
}

/** The upload screen's state: add files, watch each one. At most 20 files per batch, one file at a time. */
export function useIngestUpload(): {
  items: UploadItem[];
  /** Files beyond 20 are left out; the count of those is returned. */
  add: (files: readonly File[], note?: string) => { left: number };
  retry: (id: string) => void;
  remove: (id: string) => void;
  busy: boolean;
} {
  return notBuilt("useIngestUpload");
}
