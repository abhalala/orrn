import type { ReadBlock, ReadFailure, ReadProgress } from "./reader-protocol";
import type { ArtifactKind } from "./types";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet`);
};

export type ReadResult = { kind: ArtifactKind; blocks: ReadBlock[]; rawRows: number };

/** Thrown by `readFile`. `failure.code` picks the message: `too_many_rows` is `ingest.drop.tooManyRows`, else `ingest.read.failed`. */
export class ReadError extends Error {
  constructor(readonly failure: ReadFailure) {
    super(failure.code);
  }
}

/** SHA-256 hex of the raw bytes, computed in the reader worker with `crypto.subtle`. */
export function hashFile(file: File, signal?: AbortSignal): Promise<string> {
  void file;
  void signal;
  return notBuilt("hashFile");
}

/** Reads a file into blocks in the module worker. Progress goes to `onProgress` (plan A4). Rejects with `ReadError`. */
export function readFile(
  file: File,
  opts: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal },
): Promise<ReadResult> {
  void file;
  void opts;
  return notBuilt("readFile");
}
