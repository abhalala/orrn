import { useT } from "@orrn/i18n";

import { DEMO_BUNDLE, DEMO_PACKING_LIST, demoKg, demoTotalKg } from "./demo-data";
import { DemoLabel } from "./demo-label";

const QR_MODULES = 25;

/** Seeded FNV-1a PRNG from orrn-showcase/src/ui/BundleLabel.tsx so a serial always draws the same QR matrix. */
function seeded(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const inFinder = (x: number, y: number, n: number) =>
  (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);

const finderOn = (x: number, y: number) => {
  const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
  return d === 3 || d <= 1;
};

function qrPath(text: string, n = QR_MODULES): string {
  const rnd = seeded(text);
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let on = false;
      if (inFinder(x, y, n)) {
        const fx = x >= n - 8 ? x - (n - 7) : x;
        const fy = y >= n - 8 ? y - (n - 7) : y;
        on = fx >= 0 && fy >= 0 && fx <= 6 && fy <= 6 && finderOn(fx, fy);
      } else if (y === 6) {
        on = x % 2 === 0;
      } else if (x === 6) {
        on = y % 2 === 0;
      } else {
        on = rnd() < 0.5;
      }
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

const DEMO_QR_PATH = qrPath(DEMO_BUNDLE.serial);

/** Viewfinder corner bracket from orrn-showcase/src/scenes/parts/ch5-camera.tsx. */
function ScanCorner({ pos }: { pos: "tl" | "tr" | "br" | "bl" }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 44 44"
      className={`marketing-scan-corner marketing-scan-corner-${pos}`}
      focusable="false"
    >
      <path
        d="M3 41V15A12 12 0 0 1 15 3h26"
        fill="none"
        stroke="var(--tone-green-from)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Office() {
  const { t } = useT();
  return (
    <section id="office" className="marketing-container marketing-record" aria-labelledby="office-title">
      <div className="marketing-record-copy">
        <p className="marketing-eyebrow">{t("marketing.office.eyebrow")}</p>
        <h2 id="office-title">{t("marketing.office.title")}</h2>
        <p>{t("marketing.office.body")}</p>
        <p className="marketing-record-note">{t("marketing.office.note")}</p>
      </div>
      <div className="marketing-sheet-shell">
        <div data-demo-visual aria-hidden="true" className="marketing-sheet">
          <div className="marketing-sheet-top">
            <span className="marketing-sheet-wordmark">{t("common.appName")}</span>
            <DemoLabel />
          </div>

          {/* Thermal bundle sticker with camera scan lock from orrn-showcase Ch4 & Ch5 */}
          <div className="marketing-bundle-sticker">
            <ScanCorner pos="tl" />
            <ScanCorner pos="tr" />
            <ScanCorner pos="br" />
            <ScanCorner pos="bl" />
            <div className="marketing-sticker-main">
              <div className="marketing-sticker-meta">
                <span>{t("marketing.office.printerTitle")}</span>
                <span className="marketing-sticker-chip">{t("marketing.office.scannerTitle")}</span>
              </div>
              <p className="marketing-sticker-serial">{DEMO_BUNDLE.serial}</p>
              <p className="marketing-sticker-spec">
                {`${t("marketing.office.demoMeta")} · ${DEMO_BUNDLE.pieces} ${t("packingList.columns.pcs")} · ${demoKg(DEMO_BUNDLE)} kg`}
              </p>
            </div>
            <div className="marketing-sticker-qr">
              <svg
                width="76"
                height="76"
                viewBox={`-1 -1 ${QR_MODULES + 2} ${QR_MODULES + 2}`}
                shapeRendering="crispEdges"
                focusable="false"
              >
                <rect x="-1" y="-1" width={QR_MODULES + 2} height={QR_MODULES + 2} rx="1.5" fill="#f4f4f1" />
                <path d={DEMO_QR_PATH} fill="#0c0c0e" />
              </svg>
            </div>
          </div>

          {/* Assembled Packing List Sheet from orrn-showcase Ch7 */}
          <div className="marketing-sheet-header">
            <div>
              <p className="marketing-sheet-title">{t("packingList.title")}</p>
              <p className="marketing-sheet-customer">{t("marketing.office.demoCustomer")}</p>
            </div>
            <span className="marketing-sheet-meta">{t("marketing.office.demoMeta")}</span>
          </div>

          <table>
            <thead>
              <tr>
                <th scope="col">{t("packingList.columns.bundleNo")}</th>
                <th scope="col">{t("packingList.columns.pcs")}</th>
                <th scope="col">{t("packingList.columns.weightKg")}</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_PACKING_LIST.map((bundle) => (
                <tr key={bundle.serial}>
                  <td>{bundle.serial}</td>
                  <td>{bundle.pieces}</td>
                  <td>{demoKg(bundle)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="marketing-sheet-total">
            {t("packingList.totals", {
              bundles: DEMO_PACKING_LIST.length,
              kg: demoTotalKg(DEMO_PACKING_LIST),
            })}
          </p>

          <div className="marketing-export-pills">
            <span className="marketing-export-pill" data-tone="red">
              <i />
              {t("marketing.office.exportPdf")}
            </span>
            <span className="marketing-export-pill" data-tone="green">
              <i />
              {t("marketing.office.exportCsv")}
            </span>
            <span className="marketing-export-pill" data-tone="neutral">
              <i />
              {t("marketing.office.exportQr")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
