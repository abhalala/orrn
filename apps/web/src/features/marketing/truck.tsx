import { useT } from "@orrn/i18n";
import type { ReactNode } from "react";

import { DemoTag } from "./demo-tag";
import { StatusChip } from "./status-chip";

/** The added rows all say 21 pieces; only the weight differs. */
function Weighed({ kg }: { kg: string }) {
  return (
    <>
      <span className="marketing-nb">{kg} kg</span>, 21 pcs
    </>
  );
}

/**
 * The phone scan sheet for DSP-000412, the dispatch the hero's bundle went out
 * in. Five rows: three added, two refused. 52.40 + 51.90 + 52.10 = 156.40 kg.
 * The chip words and refusal lines are the app's own strings under
 * `scan.continuous` in en.ts, copied here because the sheet is a picture of
 * the app and stays English. No customer and no order: the app's sheet header
 * has neither.
 */
const ROWS: readonly { code: string; ok: boolean; why: ReactNode }[] = [
  { code: "26J4086", ok: true, why: <Weighed kg="52.40" /> },
  { code: "26J4062", ok: false, why: "Packed for another customer" },
  { code: "26J4091", ok: true, why: <Weighed kg="51.90" /> },
  {
    code: "26J4055",
    ok: false,
    why: (
      <>
        Held for <span className="marketing-code">DSP-000409</span>
      </>
    ),
  },
  { code: "26J4092", ok: true, why: <Weighed kg="52.10" /> },
];

function ScanSheet() {
  return (
    <div className="marketing-shot marketing-phone" data-demo-visual aria-hidden="true" lang="en">
      <DemoTag />
      <div className="marketing-app-top">
        <b>Dispatch</b>
      </div>
      {/* A div, not a heading: the sheet is hidden from the accessibility tree, so an h3 here would be a stray level in the DOM outline. */}
      <div className="marketing-phone-title">
        Scanning into <span className="marketing-code">DSP-000412</span>
      </div>
      <ul className="marketing-scan">
        {ROWS.map((row) => (
          <li key={row.code} data-refused={row.ok ? undefined : ""}>
            <span className="marketing-code">{row.code}</span>
            <StatusChip state={row.ok ? "ok" : "no"}>{row.ok ? "Added" : "Not added"}</StatusChip>
            <span className="marketing-scan-why">{row.why}</span>
          </li>
        ))}
      </ul>
      <div className="marketing-phone-foot">
        <span>
          <b>3 added</b>, <span className="marketing-nb">156.40 kg</span>
        </span>
        {/* A picture of the app's button, not a control: the whole sheet is aria-hidden and takes no pointer. */}
        <span className="marketing-button marketing-button-sm">Done scanning</span>
      </div>
    </div>
  );
}

/** The truck (#truck): the scans decide what leaves stock, with the one real-world number. */
export function Truck() {
  const { t } = useT();
  return (
    <section id="truck" aria-labelledby="truck-title" className="marketing-section">
      <div className="marketing-wrap marketing-grid">
        <div className="marketing-copy">
          <h2 id="truck-title">{t("marketing.truck.title")}</h2>
          <p>{t("marketing.truck.body1")}</p>
          <p>{t("marketing.truck.body2")}</p>
          <div className="marketing-count">
            {/* 1,071 of 1,721 bundles, the 30 June 2026 count. The sentence carries the date and the source. */}
            <span className="marketing-count-figure marketing-nb">62 %</span>
            <p>{t("marketing.truck.count")}</p>
          </div>
        </div>
        <figure className="marketing-proof">
          <ScanSheet />
          <figcaption>
            {/* The readable caption sits outside the hidden screen and begins "Demo data." */}
            <span className="sr-only">{t("marketing.truck.alt")}</span>
            <span aria-hidden="true">{t("marketing.truck.caption")}</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
