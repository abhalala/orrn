/**
 * Vision read parameters (import portal release 2, contract docs/superpowers/plans/2026-11-20-vision-read.md).
 *
 * One object read by the browser (page rendering and upload) and the server (caps, confidence, page keys).
 * The EVAL lane may change the page size, the JPEG quality or the tiling: change them here only, never as
 * literals in the code that renders or reads a page. `tiling: "none"` means one image per page; bands would
 * change the contract (page keys and run keys), so a new value needs the lead first.
 */
export const VISION_PARAMS = {
  /** The long side of a page image, in px. A photo is downscaled to it; a PDF page is rendered to it. EVAL 2026-11-20: 2400 (1600 misread pages past about 11 px text). */
  longSidePx: 2400,
  /** JPEG quality of a page image, 0 to 1 (canvas.toBlob). */
  jpegQuality: 0.8,
  /** How a page is cut before the model reads it: "bands" (EVAL 2026-11-20) cuts a dense page into horizontal bands. */
  tiling: "bands" as "none" | "bands",
  /** A page with more table rows than this is read in bands (text PDF: counted from the text layer; scan or photo: rows of the whole-page read, or a truncated answer). */
  bandRowThreshold: 100,
  /** The most rows one band holds. A band is cut on a gap between text lines, never through one. */
  bandMaxRows: 65,
  /** The most bands one page is cut into (each band has its own run key, so its own 4-call cap). */
  maxBandsPerPage: 4,
  /** Pages read per file in this release. Pages past it are listed as not read. */
  maxPagesPerFile: 30,
  /** Rows under this confidence are shown first and marked. */
  lowConfidence: 0.7,
  /** Tables taken from one page. Also the ordinal stride: table t of page p has ordinal (p - 1) * 5 + t. */
  tablesPerPage: 5,
  /**
   * The largest page or band image accepted, in bytes (upload ticket size and the model's limit). The API's image
   * limit is 5 MB and the image travels as base64 (4/3 larger), so 3.7 MB stays under it. A 2400 px JPEG at 0.8 was
   * at most 680 KB in EVAL.
   */
  maxPageBytes: 3_700_000,
  /** The largest page text (pdfjs text layer, JSON) a text PDF page sends for the digit check, in bytes. */
  maxPageTextBytes: 1_000_000,
  /** The content type of every page image. */
  pageContentType: "image/jpeg",
} as const;

export type VisionParams = typeof VISION_PARAMS;

/** The ordinal of table `table` (0-based) on page `page` (1-based). */
export function visionOrdinal(page: number, table: number): number {
  return (page - 1) * VISION_PARAMS.tablesPerPage + table;
}

/** The page (1-based) a model-read block's ordinal belongs to. */
export function visionPageOfOrdinal(ordinal: number): number {
  return Math.floor(ordinal / VISION_PARAMS.tablesPerPage) + 1;
}

/** The run key of a page in `ingest_bot_run.block_id` (schema comment, migration 0049). */
export function visionPageKey(artifactId: string, page: number): string {
  return `${artifactId}:p${page}`;
}

/** The run key of band `band` (1-based) of a page: each band counts against its own per-key cap. */
export function visionBandKey(artifactId: string, page: number, band: number): string {
  return `${artifactId}:p${page}:b${band}`;
}

/** Width and height that fit `longSidePx` on the long side, never upscaled, at least 1 px each. */
export function fitLongSide(width: number, height: number, longSidePx: number = VISION_PARAMS.longSidePx): { width: number; height: number; scale: number } {
  const long = Math.max(width, height);
  const scale = long > longSidePx ? longSidePx / long : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** The pdfjs viewport scale that renders a page of this size (at scale 1) to `longSidePx` on its long side. */
export function pdfRenderScale(width: number, height: number, longSidePx: number = VISION_PARAMS.longSidePx): number {
  const long = Math.max(width, height);
  return long > 0 ? longSidePx / long : 1;
}
