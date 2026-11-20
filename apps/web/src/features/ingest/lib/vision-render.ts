import { fitLongSide, pdfRenderScale, VISION_PARAMS } from "@orrn/ingest";

import { bandCountFor, inkRows, pageTextJson, textLines, planScanBands, planTextBands, type BandPlan, type TextBox } from "./vision-bands";
import type { ArtifactKind } from "./types";

/**
 * Page images for the vision read (contract sections 1 and 9). A PDF page is rendered with pdfjs so its long side is
 * `VISION_PARAMS.longSidePx`; a photo is drawn at `fitLongSide` (never upscaled). Both leave as JPEG at
 * `VISION_PARAMS.jpegQuality`. pdfjs and its worker are loaded by dynamic `import()` inside `openPdf` only, so they never
 * reach a route's static graph and the pure helpers below test without them.
 */

/**
 * Pages read of a file with `pageCount` pages: 1 to `max`, the pages the server planned (`vision.pages`
 * `planned`) or the plant's pages per batch (`ingest.status` `visionPagesPerBatch`, set in Godseye).
 */
export function plannedPages(pageCount: number, max: number): number {
  return Math.max(0, Math.min(Math.floor(pageCount), Math.floor(max)));
}

/** The page numbers read, from 1. */
export function pageNumbers(pageCount: number, max: number): number[] {
  return Array.from({ length: plannedPages(pageCount, max) }, (_, i) => i + 1);
}

/** The cap line ("Pages 1 to 30 of 45 were read."): null when every page of the file is read. */
export function capLine(pageCount: number, max: number): { key: "ingest.vision.cap"; vars: { max: number; total: number } } | null {
  const planned = plannedPages(pageCount, max);
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

/** How a page is cut into bands: from the text layer (text PDF) or the ink projection (scan or photo). */
export type BandHow = "text" | "ink";

/**
 * An opened file: how many pages it has, one JPEG per page on request, and for dense pages (contract section 11.3) the
 * band JPEGs, each `longSidePx` wide (null when the page is read whole or cannot be cut on blank rows). `text` is the
 * page's text layer as `{ v: 1, items }` JSON, or null (a photo, a page with no text, or text over the cap). Call
 * `close` when done.
 */
export type PageSource = {
  pageCount: number;
  render: (page: number) => Promise<Blob>;
  text?: (page: number) => Promise<string | null>;
  bands?: (page: number, how: BandHow) => Promise<Blob[] | null>;
  close: () => void;
};

/** The canvas size of a page drawn `longSidePx` wide (bands are cut from it). */
export function bandCanvasSize(width: number, height: number): { scale: number; width: number; height: number } {
  const scale = width > 0 ? VISION_PARAMS.longSidePx / width : 1;
  return { scale, width: VISION_PARAMS.longSidePx, height: Math.max(1, Math.round(height * scale)) };
}

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

/** The band JPEGs of a page drawn on `canvas`, cut by `plan`; the header strip goes on top of bands 2..k. */
async function bandJpegs(canvas: HTMLCanvasElement, plan: BandPlan): Promise<Blob[] | null> {
  const out: Blob[] = [];
  for (const [i, band] of plan.bands.entries()) {
    const strip = i > 0 ? plan.strip : null;
    const stripH = strip ? strip.bottom - strip.top : 0;
    const bandH = band.bottom - band.top;
    const { canvas: piece, ctx } = canvasOf(canvas.width, stripH + bandH);
    if (strip) ctx.drawImage(canvas, 0, strip.top, canvas.width, stripH, 0, 0, canvas.width, stripH);
    ctx.drawImage(canvas, 0, band.top, canvas.width, bandH, 0, stripH, canvas.width, bandH);
    const blob = await toJpeg(piece);
    // A band over the image cap is not sent; the page is then read whole.
    if (blob.size > VISION_PARAMS.maxPageBytes) return null;
    out.push(blob);
  }
  return out;
}

function inkOf(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Uint32Array {
  return inkRows(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
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

type PdfTextItem = { str?: string; transform?: number[] };
type PdfViewport = { width: number; height: number; transform: number[] };
type PdfPage = {
  getViewport: (o: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown; background?: string }) => { promise: Promise<void> };
  cleanup: () => void;
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => Promise<void> };
type PdfTask = { promise: Promise<PdfDoc>; destroy?: () => Promise<void> };
type PdfJs = {
  getDocument: (o: { data: Uint8Array }) => PdfTask;
  GlobalWorkerOptions: { workerSrc: string };
  Util: { transform: (a: number[], b: number[]) => number[] };
};

/** Text boxes of a page in canvas rows of `viewport` (through its transform, so a rotated page maps right). */
function textBoxes(pdfjs: PdfJs, items: readonly PdfTextItem[], viewport: PdfViewport): TextBox[] {
  const boxes: TextBox[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || !item.transform) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const em = Math.hypot(t[2]!, t[3]!);
    // The baseline is at t[5]; the em box sits above it, with a little room for descenders below.
    boxes.push({ str: item.str, top: t[5]! - em, bottom: t[5]! + em * 0.2 });
  }
  return boxes;
}

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
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    doc = await task.promise;
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
    async text(n) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      page.cleanup();
      return pageTextJson(content.items.map((i) => (typeof i.str === "string" ? i.str : "")));
    },
    async bands(n, how) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const size = bandCanvasSize(base.width, base.height);
      const viewport = page.getViewport({ scale: size.scale });
      // A text page under the row threshold is read whole: counted from the text layer before anything is drawn.
      const boxes = how === "text" ? textBoxes(pdfjs, (await page.getTextContent()).items, viewport) : [];
      if (how === "text" && bandCountFor(textLines(boxes).length) === 0) {
        page.cleanup();
        return null;
      }
      const { canvas, ctx } = canvasOf(size.width, size.height);
      await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
      const ink = inkOf(canvas, ctx);
      const plan = how === "text" ? planTextBands(ink, canvas.width, boxes) : planScanBands(ink, canvas.width);
      page.cleanup();
      const out = plan ? await bandJpegs(canvas, plan) : null;
      canvas.width = 0;
      canvas.height = 0;
      return out;
    },
    close() {
      // pdfjs 6 frees a document through its loading task; older builds through the document. Never throws.
      const free = task.destroy ? task.destroy.bind(task) : doc.destroy?.bind(doc);
      void free?.().catch(() => undefined);
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
    async text() {
      return null;
    },
    async bands(_page, how) {
      // A photo has no text layer: it is cut only when the server asks for bands.
      if (how !== "ink") return null;
      const size = bandCanvasSize(bitmap.width, bitmap.height);
      const { canvas, ctx } = canvasOf(size.width, size.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const plan = planScanBands(inkOf(canvas, ctx), canvas.width);
      const out = plan ? await bandJpegs(canvas, plan) : null;
      canvas.width = 0;
      canvas.height = 0;
      return out;
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
