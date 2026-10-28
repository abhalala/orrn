import type { BarcodeFormat } from "barcode-detector/ponyfill";

/** QR on the bundle label, Code 128 on older labels and supplier tags. */
export const SCAN_FORMATS = ["qr_code", "code_128"] as const;

export type DetectedBarcode = {
  rawValue: string;
  format: string;
  boundingBox: { x: number; y: number; width: number; height: number };
};

export type Detector = { detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<DetectedBarcode[]> };

type NativeDetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

const pending = new Map<string, Promise<Detector>>();

/**
 * The barcode reader: the browser's own `BarcodeDetector` when it reads QR
 * (Chrome on Android, macOS), else the `barcode-detector` ponyfill (ZXing in
 * WebAssembly; iPhone and iPad Safari). The ponyfill and its ~1 MB wasm load
 * only on that path, and the wasm is served from this app rather than the
 * library's default CDN, so a plant on a shaky or filtered connection still
 * scans. The camera reads `SCAN_FORMATS`; importing a label from a photo
 * asks for every printable code. One instance per format list is shared.
 */
export function loadDetector(formats: readonly string[] = SCAN_FORMATS): Promise<Detector> {
  const key = formats.join(",");
  let loading = pending.get(key);
  if (!loading) {
    loading = create(formats).catch((error: unknown) => {
      pending.delete(key);
      throw error;
    });
    pending.set(key, loading);
  }
  return loading;
}

/** Dev-only test seam: `window.__orrnDetector = "fail-load" | "fail-detect"` forces a broken reader. */
function forcedFailure(): Detector | null {
  if (!import.meta.env.DEV) return null;
  const forced = (globalThis as { __orrnDetector?: string }).__orrnDetector;
  if (forced === "fail-load") throw new Error("Forced detector load failure");
  if (forced === "fail-detect") return { detect: () => Promise.reject(new Error("Forced detect failure")) };
  return null;
}

async function create(wanted: readonly string[]): Promise<Detector> {
  const forced = forcedFailure();
  if (forced) return forced;
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      const formats = wanted.filter((f) => supported.includes(f));
      if (formats.includes("qr_code")) return new Native({ formats });
    } catch {
      // Fall through to the ponyfill.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  // Load and instantiate the wasm now, not on the first detect(): a 404, a CSP
  // block or a glue/wasm mismatch then fails here and the camera says so,
  // instead of every frame failing silently behind a live-looking viewfinder.
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  });
  // Callers pass ZXing's own format names (SCAN_FORMATS, the photo import's PHOTO_CODE_FORMATS).
  const formats = [...wanted] as BarcodeFormat[];
  return new BarcodeDetector({ formats });
}
