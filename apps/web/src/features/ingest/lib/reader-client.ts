import { detectFileKind } from "./limits";
import type { ReadBlock, ReadFailure, ReadProgress, WorkerRequest, WorkerResponse } from "./reader-protocol";
import type { ArtifactKind } from "./types";

export type ReadResult = { kind: ArtifactKind; blocks: ReadBlock[]; rawRows: number };

/** Thrown by `readFile`. `failure.code` picks the message: `too_many_rows` is `ingest.drop.tooManyRows`, else `ingest.read.failed`. */
export class ReadError extends Error {
  constructor(readonly failure: ReadFailure) {
    super(failure.code);
  }
}

let nextId = 1;

/** The seam for tests: how a worker is started. The app's is a module worker on `reader.worker.ts`. */
export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
export type WorkerFactory = () => WorkerLike;

const realFactory: WorkerFactory = () =>
  new Worker(new URL("./reader.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

let factory: WorkerFactory = realFactory;

/** For tests: replace how workers start, or pass null to reset. */
export function setReaderWorkerFactoryForTests(next: WorkerFactory | null): void {
  factory = next ?? realFactory;
}

type Req = WorkerRequest extends infer U ? (U extends { id: number } ? Omit<U, "id"> : never) : never;

function ask<T extends WorkerResponse["type"]>(
  request: Req,
  want: T,
  opts: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal },
): Promise<Extract<WorkerResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    const worker = factory();
    const id = nextId++;
    const finish = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === "progress") return opts.onProgress?.(msg.progress);
      finish();
      if (msg.type === "failed") return reject(new ReadError(msg.failure));
      if (msg.type === want) return resolve(msg as Extract<WorkerResponse, { type: T }>);
      reject(new ReadError({ code: "unreadable", detail: `unexpected ${msg.type}` }));
    };
    worker.onerror = (event) => {
      finish();
      reject(new ReadError({ code: "unreadable", detail: event.message || "worker failed" }));
    };
    worker.postMessage({ ...request, id } as WorkerRequest);
  });
}

/** SHA-256 hex of the raw bytes, computed in the reader worker with `crypto.subtle`. */
export async function hashFile(file: File, signal?: AbortSignal): Promise<string> {
  return (await ask({ type: "hash", file }, "hashed", { signal })).sha256;
}

/** Reads a file into blocks in the module worker. Progress goes to `onProgress` (plan A4). Rejects with `ReadError`. */
export async function readFile(
  file: File,
  opts: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal },
): Promise<ReadResult> {
  const found = detectFileKind(file.name, file.type);
  if (!found) throw new ReadError({ code: "unreadable", detail: "unknown file type" });
  const done = await ask({ type: "read", file, kind: found.kind }, "blocks", opts);
  return { kind: done.kind, blocks: done.blocks, rawRows: done.rawRows };
}
