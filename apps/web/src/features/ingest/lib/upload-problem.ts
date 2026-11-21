import type { ArtifactKind } from "./types";
import { beginRefusalWords, ingestErrorWords } from "./errors";
import { readFailedKey, type FileProblem, type FileProblemKey } from "./limits";

export { readFailedKey };
import { errorCodeOf } from "./pump";
import { ReadError } from "./reader-client";
import type { UploadStep } from "./upload";

/**
 * The words of a failed upload (web review S2, decision 12). The real error is kept: a server sentence keeps its own
 * words, and a failure with no answer from the server while the parts go says the upload stopped and that "Try again"
 * carries on from the parts already saved (the resume sends only the missing ones). A file orrn could not read says so;
 * only a sheet hears "save it as Excel or CSV", never a PDF or a photo.
 */
export function uploadFailureProblem(error: unknown, at: { kind: ArtifactKind | null; step: UploadStep | null }): FileProblem {
  if (error instanceof ReadError) return { key: readFailedKey(at.kind) };
  // The storage quota is checked again when the parts start: the same words as at begin, with the size.
  const limit = beginRefusalWords(error);
  if (limit) return { key: limit.key as FileProblemKey, vars: limit.vars };
  const words = ingestErrorWords(error, "action");
  if (at.step === "saving") {
    // No server sentence of its own: the request never got an answer, or a part PUT was refused by the storage.
    const own = words.key.startsWith("ingest.upload.") || words.key.startsWith("ingest.vision.");
    const code = errorCodeOf(error);
    if (!own && (code === "NETWORK" || code === "TIMEOUT" || code === "UNKNOWN")) return { key: "ingest.upload.error.stopped" };
  }
  return { key: words.key as FileProblemKey };
}

/**
 * Keeps the digest of each file the tab has hashed, so "Try again" on a large file does not read it all again before the
 * missing parts go. A hash that failed (or was cancelled) is dropped and runs again next time.
 */
export function memoHash<T>(hash: (file: File, signal?: AbortSignal) => Promise<T>): (file: File, signal?: AbortSignal) => Promise<T> {
  const done = new WeakMap<File, Promise<T>>();
  return (file, signal) => {
    const kept = done.get(file);
    if (kept) return kept;
    const running = hash(file, signal);
    done.set(file, running);
    running.catch(() => done.delete(file));
    return running;
  };
}
