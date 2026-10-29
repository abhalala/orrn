import { useT } from "@orrn/i18n";

import { DEMO_BUNDLE, DEMO_TRACE, demoKg } from "./demo-data";
import { DemoLabel } from "./demo-label";

const QR_MODULES = 25;

/** Seeded FNV-1a PRNG from orrn-showcase/src/ui/BundleLabel.tsx so a serial always draws the same pattern. */
export function seeded(text: string) {
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

/** A QR-shaped module pattern for a serial: finder squares, timing rows and seeded data modules. */
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

/** Bar widths for the label's barcode strip, seeded by the serial like the QR. */
export function barcodeBars(text: string, count: number): number[] {
  const rnd = seeded(`${text}:bars`);
  return Array.from({ length: count }, () => 1 + Math.floor(rnd() * 4));
}

export function BundleQr({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`-1 -1 ${QR_MODULES + 2} ${QR_MODULES + 2}`}
      shapeRendering="crispEdges"
      focusable="false"
      aria-hidden="true"
    >
      <rect x="-1" y="-1" width={QR_MODULES + 2} height={QR_MODULES + 2} fill="var(--m-paper)" />
      <path d={DEMO_QR_PATH} fill="var(--m-ink)" />
    </svg>
  );
}

/** The barcode strip printed along a thermal bundle label. */
export function BarcodeStrip({ className, bars = 64 }: { className?: string; bars?: number }) {
  const widths = barcodeBars(DEMO_BUNDLE.serial, bars);
  return (
    <span className={className} aria-hidden="true">
      {widths.map((width, index) => (
        // Bars alternate ink and paper; the index is the bar's identity.
        <i key={index} style={{ flexGrow: width }} data-ink={index % 2 === 0} />
      ))}
    </span>
  );
}

/**
 * The thermal label orrn prints at the packing scale, with sample values.
 * Hidden from screen readers and visibly marked as demo data.
 */
export function BundleLabel({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <div data-ui data-demo-visual aria-hidden="true" className={`marketing-label ${className ?? ""}`}>
      <div className="marketing-label-top">
        <span className="marketing-label-title">{t("marketing.label.title")}</span>
        <DemoLabel />
      </div>
      <div className="marketing-label-body">
        <p className="marketing-label-serial">{DEMO_BUNDLE.serial}</p>
        <BundleQr className="marketing-label-qr" />
        <dl className="marketing-label-fields">
          <div>
            <dt>{t("marketing.label.profile")}</dt>
            <dd>{t("marketing.office.demoMeta")}</dd>
          </div>
          <div>
            <dt>{t("marketing.label.pieces")}</dt>
            <dd>{DEMO_BUNDLE.pieces}</dd>
          </div>
          <div>
            <dt>{t("marketing.label.weight")}</dt>
            <dd>{`${demoKg(DEMO_BUNDLE)} kg`}</dd>
          </div>
          <div>
            <dt>{t("marketing.label.heat")}</dt>
            <dd>{`${DEMO_TRACE.heat} · ${DEMO_TRACE.alloy}`}</dd>
          </div>
          <div>
            <dt>{t("marketing.label.die")}</dt>
            <dd>{DEMO_TRACE.die}</dd>
          </div>
        </dl>
      </div>
      <BarcodeStrip className="marketing-barcode marketing-label-bars" bars={48} />
    </div>
  );
}
