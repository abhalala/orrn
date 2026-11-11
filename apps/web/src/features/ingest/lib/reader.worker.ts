/// <reference lib="webworker" />
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { engine } from "./engine";
import { readFileBlocks, ReadStop, READ_LIMITS, sha256OfBuffer, type PapaLike, type PdfLike, type XlsxLike } from "./reader-core";
import type { WorkerRequest, WorkerResponse } from "./reader-protocol";

/**
 * The reader worker (plan A1): hashes and reads one file in a module Web Worker, so a 20 MB workbook never
 * blocks the page. xlsx, papaparse and pdfjs are loaded here, on demand, and never reach the app entry.
 * The page terminates the worker to cancel.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse) => scope.postMessage(message);

async function loadXlsx(): Promise<XlsxLike> {
  return (await import("xlsx")) as unknown as XlsxLike;
}

async function loadPapa(): Promise<PapaLike> {
  return (await import("papaparse")).default as unknown as PapaLike;
}

async function loadPdf(): Promise<PdfLike> {
  const pdfjs = await import("pdfjs-dist");
  // The pdfjs worker file is this app's own build asset, like the Tesseract files (plan D15).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(pdfWorkerUrl, self.location.href).href;
  return pdfjs as unknown as PdfLike;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "hash") {
      post({ id: msg.id, type: "progress", progress: { phase: "hash", sheet: null, rowsRead: 0, rowsTotal: null } });
      post({ id: msg.id, type: "hashed", sha256: await sha256OfBuffer(await msg.file.arrayBuffer()) });
      return;
    }
    const blocks = await readFileBlocks(msg.file, msg.kind, {
      engine,
      limits: READ_LIMITS,
      loadXlsx,
      loadPapa,
      loadPdf,
      onProgress: (progress) => post({ id: msg.id, type: "progress", progress }),
    });
    post({ id: msg.id, type: "blocks", kind: msg.kind, blocks, rawRows: blocks.reduce((n, b) => n + b.input.rowCount, 0) });
  } catch (error) {
    if (error instanceof ReadStop) post({ id: msg.id, type: "failed", failure: error.failure });
    else post({ id: msg.id, type: "failed", failure: { code: "unreadable", detail: error instanceof Error ? error.message : "unknown" } });
  }
};
