/** QR on the bundle label, Code 128 on older labels and supplier tags. */
export const SCAN_FORMATS = ["qr_code", "code_128"] as const;

export type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

type NativeDetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

let pending: Promise<Detector> | null = null;

/**
 * The barcode reader for the camera: the browser's own `BarcodeDetector`
 * when it reads QR (Chrome on Android, macOS), else the `barcode-detector`
 * ponyfill (ZXing in WebAssembly; iPhone and iPad Safari). The ponyfill and
 * its ~1 MB wasm load only on that path, and the wasm is served from this
 * app rather than the library's default CDN, so a plant on a shaky or
 * filtered connection still scans. One instance is shared.
 */
export function loadDetector(): Promise<Detector> {
  pending ??= create().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

async function create(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("qr_code")) return new Native({ formats });
    } catch {
      // Fall through to the ponyfill.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector({ formats: [...SCAN_FORMATS] });
}
