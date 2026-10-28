/**
 * Geometry for importing a label from a photo: the four-point homography that straightens a
 * photographed label into a flat rectangle, a cheap guess at where the label sits in the photo,
 * and the stock size a crop looks like. Pure, so `label-photo-geometry.test.ts` checks it without
 * a browser; the canvas helpers at the end only wrap it.
 */

export type Point = { x: number; y: number };
/** Corners in label order: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point];
/** Row-major 3 × 3 projective matrix. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];
/** RGBA pixels, laid out like `ImageData`. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Solves `a · x = b` by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(m[row]![column]!) > Math.abs(m[pivot]![column]!)) pivot = row;
    if (Math.abs(m[pivot]![column]!) < 1e-10) return null;
    [m[column], m[pivot]] = [m[pivot]!, m[column]!];
    const lead = m[column]!;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const target = m[row]!;
      const factor = target[column]! / lead[column]!;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) target[k] = target[k]! - factor * lead[k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** The projective map that takes each corner of `from` onto the same corner of `to`. */
export function homography(from: Quad, to: Quad): Matrix3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  if (!h) throw new Error("The four corners do not make a label shape");
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function project(m: Matrix3, { x, y }: Point): Point {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function rectQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/** Turns which corner counts as the label's top left: one quarter turn clockwise per step. */
export function rotateQuad(quad: Quad, quarterTurns: number): Quad {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const next = [...quad] as Quad;
  for (let i = 0; i < turns; i += 1) next.unshift(next.pop()!);
  return next;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Rough straightened size of a quad: the mean of opposite edges. */
export function quadSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  return { width: (distance(tl, tr) + distance(bl, br)) / 2, height: (distance(tl, bl) + distance(tr, br)) / 2 };
}

/** The stock whose aspect is nearest the crop's (compared as a ratio, so wide and tall weigh the same). */
export function closestStock<T extends { widthMm: number; heightMm: number }>(aspect: number, sizes: readonly T[]): T {
  let best = sizes[0]!;
  let bestError = Infinity;
  for (const size of sizes) {
    const error = Math.abs(Math.log(aspect) - Math.log(size.widthMm / size.heightMm));
    if (error < bestError) {
      best = size;
      bestError = error;
    }
  }
  return best;
}

/**
 * Straightens the quad in `source` into a `width` × `height` rectangle: each output pixel is
 * mapped back through the homography and sampled bilinearly.
 */
export function warpPixels(source: Pixels, quad: Quad, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const m = homography(rectQuad(width, height), quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = source;
  const maxX = sw - 1;
  const maxY = sh - 1;
  for (let v = 0; v < height; v += 1) {
    const cy = v + 0.5;
    for (let u = 0; u < width; u += 1) {
      const cx = u + 0.5;
      const w = m[6] * cx + m[7] * cy + m[8];
      const sx = Math.min(maxX, Math.max(0, (m[0] * cx + m[1] * cy + m[2]) / w - 0.5));
      const sy = Math.min(maxY, Math.max(0, (m[3] * cx + m[4] * cy + m[5]) / w - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (v * width + u) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c]! + (data[i10 + c]! - data[i00 + c]!) * fx;
        const bottom = data[i01 + c]! + (data[i11 + c]! - data[i01 + c]!) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Otsu's threshold over 0-255 luminance values. */
function otsu(luma: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of luma) histogram[value] = histogram[value]! + 1;
  const total = luma.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]!;
  let backgroundSum = 0;
  let backgroundCount = 0;
  let best = 0;
  let threshold = 127;
  for (let i = 0; i < 256; i += 1) {
    backgroundCount += histogram[i]!;
    if (backgroundCount === 0) continue;
    const foregroundCount = total - backgroundCount;
    if (foregroundCount === 0) break;
    backgroundSum += i * histogram[i]!;
    const meanBackground = backgroundSum / backgroundCount;
    const meanForeground = (sum - backgroundSum) / foregroundCount;
    const between = backgroundCount * foregroundCount * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * Where the label probably is: the largest bright region of a small copy of the photo (white
 * label stock on a darker surface), as its four extreme corners. Null when there is no such
 * region, or it fills the frame (a scan, or a photo already cropped to the label), so the caller
 * keeps the whole image.
 */
export function detectLabelQuad(pixels: Pixels): Quad | null {
  const { data, width, height } = pixels;
  const count = width * height;
  if (count === 0) return null;
  const luma = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) luma[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
  const threshold = otsu(luma);
  const seen = new Uint8Array(count);
  const stack = new Int32Array(count);
  let best: { area: number; tl: Point; tr: Point; br: Point; bl: Point; minX: number; maxX: number; minY: number; maxY: number } | null = null;
  for (let start = 0; start < count; start += 1) {
    if (seen[start] || luma[start]! <= threshold) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let tl = { x: 0, y: 0, s: Infinity };
    let br = { x: 0, y: 0, s: -Infinity };
    let tr = { x: 0, y: 0, s: -Infinity };
    let bl = { x: 0, y: 0, s: Infinity };
    while (top > 0) {
      const index = stack[--top]!;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x + y < tl.s) tl = { x, y, s: x + y };
      if (x + y > br.s) br = { x, y, s: x + y };
      if (x - y > tr.s) tr = { x, y, s: x - y };
      if (x - y < bl.s) bl = { x, y, s: x - y };
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || luma[next]! <= threshold) continue;
        seen[next] = 1;
        stack[top++] = next;
      }
    }
    if (!best || area > best.area) best = { area, tl, tr, br, bl, minX, maxX, minY, maxY };
  }
  if (!best || best.area < count * 0.08) return null;
  const spansFrame = best.maxX - best.minX >= width * 0.97 && best.maxY - best.minY >= height * 0.97;
  if (spansFrame) return null;
  // Pixel centres to edges: the region covers whole pixels.
  const quad: Quad = [
    { x: best.tl.x, y: best.tl.y },
    { x: best.tr.x + 1, y: best.tr.y },
    { x: best.br.x + 1, y: best.br.y + 1 },
    { x: best.bl.x, y: best.bl.y + 1 },
  ];
  const size = quadSize(quad);
  // A blob that is not roughly four-sided (a shadow, a hand) is not a label.
  if (best.area < size.width * size.height * 0.6) return null;
  return quad;
}

/* -------------------------------------------------------------------------- */
/* Browser helpers (canvas)                                                   */
/* -------------------------------------------------------------------------- */

export function canvasPixels(canvas: HTMLCanvasElement): Pixels {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** A copy of `source` scaled to fit `maxSide` on its longer edge (never enlarged). */
export function scaledCanvas(source: CanvasImageSource & { width: number; height: number }, maxSide: number): HTMLCanvasElement {
  const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The quad of `source` straightened into a new `width` × `height` canvas. */
export function warpCanvas(source: HTMLCanvasElement, quad: Quad, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const output = warpPixels(canvasPixels(source), quad, width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(output, width, height), 0, 0);
  return canvas;
}

/** Guessed label corners in `source` coordinates, from a small copy; the whole image when unsure. */
export function guessLabelQuad(source: HTMLCanvasElement): Quad {
  const small = scaledCanvas(source, 160);
  const found = detectLabelQuad(canvasPixels(small));
  if (!found) return rectQuad(source.width, source.height);
  const sx = source.width / small.width;
  const sy = source.height / small.height;
  return found.map((point) => ({ x: Math.min(source.width, point.x * sx), y: Math.min(source.height, point.y * sy) })) as Quad;
}

/** Upper bound for the photo kept with a design as its tracing underlay (data URL characters). */
export const TRACING_PHOTO_MAX_CHARS = 1_500_000;

/** A JPEG data URL of `canvas`, scaled down until it is under the tracing photo budget. */
export function tracingPhotoDataUrl(canvas: HTMLCanvasElement): string {
  let side = 1400;
  let quality = 0.82;
  for (;;) {
    const scaled = scaledCanvas(canvas, side);
    const url = scaled.toDataURL("image/jpeg", quality);
    if (url.length <= TRACING_PHOTO_MAX_CHARS || side <= 400) return url;
    side = Math.round(side * 0.8);
    quality = Math.max(0.6, quality - 0.06);
  }
}
