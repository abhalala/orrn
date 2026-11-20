/**
 * Vision read parameters (import portal release 2, contract docs/superpowers/plans/2026-11-20-vision-read.md).
 *
 * One object read by the browser (page rendering and upload) and the server (caps, confidence, page keys).
 * The EVAL lane may change the page size, the JPEG quality or the tiling: change them here only, never as
 * literals in the code that renders or reads a page. `tiling: "none"` means one image per page; bands would
 * change the contract (page keys and run keys), so a new value needs the lead first.
 */
export const VISION_PARAMS = {
  /** The long side of a page image, in px. A photo is downscaled to it; a PDF page is rendered to it. */
  longSidePx: 1600,
  /** JPEG quality of a page image, 0 to 1 (canvas.toBlob). */
  jpegQuality: 0.8,
  /** How a page is cut before the model reads it. Only "none" is built. */
  tiling: "none" as "none",
  /** Pages read per file in this release. Pages past it are listed as not read. */
  maxPagesPerFile: 30,
  /** Rows under this confidence are shown first and marked. */
  lowConfidence: 0.7,
  /** Tables taken from one page. Also the ordinal stride: table t of page p has ordinal (p - 1) * 5 + t. */
  tablesPerPage: 5,
  /** The largest page image accepted, in bytes (the upload ticket size and the model's limit). */
  maxPageBytes: 4_500_000,
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
