import Tesseract from "tesseract.js/dist/tesseract.esm.min.js";
import plainCoreUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import simdCoreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import workerUrl from "tesseract.js/dist/worker.min.js?url";

import { loadDetector } from "@/features/scan/detector";

import { PHOTO_CODE_FORMATS, type DetectedCode, type DetectedLine, type PhotoDetections } from "./label-photo-import";

/**
 * tessdata_fast English (github.com/tesseract-ocr/tessdata_fast, eng.traineddata, sha256
 * 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2), gzipped, served from
 * `public/ocr/`: Tesseract fetches `{langPath}/eng.traineddata.gz`, so the name cannot be hashed.
 */
const MODEL_DIRECTORY = `${import.meta.env.BASE_URL}ocr`;

/**
 * Reads a straightened label photo entirely in this browser: codes through the camera's barcode
 * reader (native `BarcodeDetector` or self-hosted ZXing), text through Tesseract in a web worker.
 * The worker script, the Tesseract core and the English model are this app's own build assets,
 * so no image and no request leaves for a CDN. This module is loaded only when someone imports
 * a label from a photo.
 */

export type DetectProgress = { stage: "codes" | "text"; progress: number };

/** Smallest valid module using a SIMD opcode (the wasm-feature-detect probe). */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

const absolute = (url: string) => new URL(url, window.location.href).href;
const toBox = (b: Tesseract.Bbox) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

async function detectCodes(canvas: HTMLCanvasElement): Promise<DetectedCode[]> {
  const detector = await loadDetector(PHOTO_CODE_FORMATS);
  const found = await detector.detect(canvas);
  return found
    .filter((code) => code.rawValue)
    .map((code) => ({
      format: code.format,
      value: code.rawValue,
      box: { x: code.boundingBox.x, y: code.boundingBox.y, width: code.boundingBox.width, height: code.boundingBox.height },
    }));
}

/** A grey copy with the codes painted out, so OCR does not read QR modules as letters. */
function textOnly(canvas: HTMLCanvasElement, codes: readonly DetectedCode[]): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext("2d")!;
  context.filter = "grayscale(1) contrast(1.15)";
  context.drawImage(canvas, 0, 0);
  context.filter = "none";
  context.fillStyle = "#ffffff";
  for (const { box } of codes) {
    const pad = Math.max(box.width, box.height) * 0.04;
    context.fillRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
  }
  return copy;
}

async function readText(canvas: HTMLCanvasElement, onProgress: (progress: number) => void): Promise<DetectedLine[]> {
  // A worker that fails to start reports through errorHandler, not the createWorker promise.
  let fail: (error: unknown) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const worker = await Promise.race([
    Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: absolute(workerUrl),
      corePath: absolute(WebAssembly.validate(SIMD_PROBE) ? simdCoreUrl : plainCoreUrl),
      langPath: absolute(MODEL_DIRECTORY),
      gzip: true,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (message) => {
        if (message.status === "recognizing text") onProgress(message.progress);
      },
      errorHandler: (error) => fail(error instanceof Error ? error : new Error(String(error))),
    }),
    failed,
  ]);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, user_defined_dpi: "300" });
    const { data: page } = await Promise.race([worker.recognize(canvas, {}, { blocks: true }), failed]);
    const lines: DetectedLine[] = [];
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          lines.push({
            text: line.text.trim(),
            confidence: line.confidence,
            box: toBox(line.bbox),
            words: line.words.map((word) => ({ text: word.text, confidence: word.confidence, box: toBox(word.bbox) })),
          });
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

/** Codes first (fast), then text with the codes masked out. */
export async function detectPhoto(canvas: HTMLCanvasElement, onProgress: (progress: DetectProgress) => void): Promise<PhotoDetections> {
  onProgress({ stage: "codes", progress: 0 });
  // No codes is still a label worth reading: a reader that fails to load leaves the text.
  const codes = await detectCodes(canvas).catch((): DetectedCode[] => []);
  onProgress({ stage: "text", progress: 0 });
  const lines = await readText(textOnly(canvas, codes), (progress) => onProgress({ stage: "text", progress }));
  return { width: canvas.width, height: canvas.height, codes, lines };
}
