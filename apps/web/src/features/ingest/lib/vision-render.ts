import { fitLongSide, pdfRenderScale, VISION_PARAMS } from "@orrn/ingest";

import type { ArtifactKind } from "./types";

/**
 * Page images for the vision read (contract sections 1 and 9). A PDF page is rendered with pdfjs so its long side is
 * `VISION_PARAMS.longSidePx`; a photo is drawn at `fitLongSide` (never upscaled). Both leave as JPEG at
 * `VISION_PARAMS.jpegQuality`. pdfjs and its worker are loaded by dynamic `import()` inside `openPdf` only, so they never
 * reach a route's static graph and the pure helpers below test without them.
 */

/** Pages read of a file with `pageCount` pages: 1 to `maxPagesPerFile`. */
export function plannedPages(pageCount: number): number {
  return Math.max(0, Math.min(Math.floor(pageCount), VISION_PARAMS.maxPagesPerFile));
}

/** The page numbers read, from 1. */
export function pageNumbers(pageCount: number): number[] {
  return Array.from({ length: plannedPages(pageCount) }, (_, i) => i + 1);
}

/** The cap line ("Pages 1 to 30 of 45 were read."): null when every page of the file is read. */
export function capLine(pageCount: number): { key: "ingest.vision.cap"; vars: { max: number; total: number } } | null {
  const planned = plannedPages(pageCount);
  if (pageCount <= planned) return null;
  return { key: "ingest.vision.cap", vars: { max: planned, total: pageCount } };
}

/** The canvas of a PDF page whose size at scale 1 is `width` x `height`: the scale pdfjs renders at and whole pixels. */
export function pdfCanvasSize(width: number, height: number): { scale: number; width: number; height: number } {
  const scale = pdfRenderScale(width, height);
  return { scale, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The canvas of a photo: fitted to the long side, never larger than the photo. */
export function photoCanvasSize(width: number, height: number): { width: number; height: number } {
  const fit = fitLongSide(width, height);
  return { width: fit.width, height: fit.height };
}

export function isVisualKind(kind: ArtifactKind | string | null | undefined): kind is "pdf_text" | "pdf_scan" | "image" {
  return kind === "pdf_text" || kind === "pdf_scan" || kind === "image";
}

/** The browser could not open the file's pages (a broken or locked PDF, a photo type this browser cannot draw). */
export class RenderError extends Error {
  constructor(readonly code: "cannot_open" | "cannot_draw") {
    super(code);
  }
}

/** An opened file: how many pages it has, and one JPEG per page on request. Call `close` when done. */
export type PageSource = {
  pageCount: number;
  render: (page: number) => Promise<Blob>;
  close: () => void;
};

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RenderError("cannot_draw");
  // JPEG has no transparency: a clear pixel would turn black. Paper is white.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Let the browser drop the pixels at once; a 30 page file would otherwise hold 30 canvases.
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new RenderError("cannot_draw"));
      },
      VISION_PARAMS.pageContentType,
      VISION_PARAMS.jpegQuality,
    );
  });
}

type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown; background?: string }) => { promise: Promise<void> };
  cleanup: () => void;
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = {
  getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};

let pdfjsLoad: Promise<PdfJs> | null = null;

/** pdfjs and its worker file, on first use only (the worker is this app's own build asset). */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    const lib = pdfjs as unknown as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = new URL(worker.default, location.href).href;
    return lib;
  })().catch((error: unknown) => {
    pdfjsLoad = null;
    throw error;
  });
  return pdfjsLoad;
}

export async function openPdf(bytes: ArrayBuffer): Promise<PageSource> {
  const pdfjs = await loadPdfJs();
  let doc: PdfDoc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  } catch {
    throw new RenderError("cannot_open");
  }
  return {
    pageCount: doc.numPages,
    async render(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const size = pdfCanvasSize(base.width, base.height);
      const viewport = page.getViewport({ scale: size.scale });
      const { canvas, ctx } = canvasOf(size.width, size.height);
      await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
      page.cleanup();
      return toJpeg(canvas);
    },
    close() {
      void doc.destroy();
    },
  };
}

export async function openPhoto(blob: Blob): Promise<PageSource> {
  let bitmap: ImageBitmap;
  try {
    // The photo's own orientation (EXIF) is applied, so a phone photo is not read on its side.
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new RenderError("cannot_open");
  }
  return {
    pageCount: 1,
    async render() {
      const size = photoCanvasSize(bitmap.width, bitmap.height);
      const { canvas, ctx } = canvasOf(size.width, size.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      return toJpeg(canvas);
    },
    close() {
      bitmap.close();
    },
  };
}

/** Opens a PDF or a photo for page images. */
export async function openVisualSource(file: Blob, kind: ArtifactKind): Promise<PageSource> {
  if (kind === "image") return openPhoto(file);
  return openPdf(await file.arrayBuffer());
}
