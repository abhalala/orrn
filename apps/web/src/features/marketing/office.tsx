import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type KeyboardEvent } from "react";

import { BundleLabel } from "./bundle-label";
import { DEMO_PACKING_LIST, DEMO_TRACE, demoKg, demoTotalKg } from "./demo-data";
import { DemoLabel } from "./demo-label";

const VIEWS = ["label", "list", "scan"] as const;
type View = (typeof VIEWS)[number];
const TAB_KEY = { label: "tabLabel", list: "tabList", scan: "tabScan" } as const;

/** One bundle seen three ways: the label at the scale, the packing list it joins, and the gate scan. */
export function Office() {
  const { t } = useT();
  const [view, setView] = useState<View>("list");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next]!);
    tabs.current[next]?.focus();
  }

  return (
    <section id="office" className="marketing-office" aria-labelledby="office-title">
      <div className="marketing-plate" data-reveal>
        <div id="marketing-office-panel" role="tabpanel" aria-labelledby={`marketing-tab-${view}`} className="marketing-plate-inner">
          {view === "label" ? <BundleLabel className="marketing-plate-label" /> : null}
          {view === "list" ? <PackingList /> : null}
          {view === "scan" ? <GateScan /> : null}
        </div>
      </div>
      <div className="marketing-office-copy" data-reveal>
        <div role="tablist" aria-label={t("marketing.office.views")} className="marketing-tabs">
          {VIEWS.map((id, index) => (
            <button
              key={id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`marketing-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={view === id}
              aria-controls="marketing-office-panel"
              tabIndex={view === id ? 0 : -1}
              onClick={() => setView(id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {t(`marketing.office.${TAB_KEY[id]}`)}
            </button>
          ))}
        </div>
        <div>
          <h2 id="office-title" className="marketing-heading">
            {t("marketing.office.title")}
          </h2>
          <p className="marketing-office-body">{t("marketing.office.body")}</p>
        </div>
        <div className="marketing-cells">
          <Link className="marketing-cell" data-fill="paper" to="/request-access">
            {t("marketing.requestAccess")}
          </Link>
          <Link className="marketing-cell" data-fill="surface" to="/guides">
            {t("marketing.guides")}
          </Link>
        </div>
      </div>
    </section>
  );
}

function PackingList() {
  const { t } = useT();
  return (
    <div data-ui data-demo-visual aria-hidden="true" className="marketing-sheet">
      <div className="marketing-sheet-top">
        <div>
          <p className="marketing-sheet-title">{t("packingList.title")}</p>
          <p>{t("marketing.office.demoCustomer")}</p>
        </div>
        <DemoLabel />
      </div>
      <p className="marketing-sheet-meta">{t("marketing.office.demoMeta")}</p>
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
        {t("packingList.totals", { bundles: DEMO_PACKING_LIST.length, kg: demoTotalKg(DEMO_PACKING_LIST) })}
      </p>
      <p className="marketing-sheet-exports">
        <span>{t("marketing.office.exportPdf")}</span>
        <span>{t("marketing.office.exportCsv")}</span>
      </p>
    </div>
  );
}

function GateScan() {
  const { t } = useT();
  return (
    <div data-ui data-demo-visual aria-hidden="true" className="marketing-scan">
      <div className="marketing-sheet-top">
        <p className="marketing-sheet-title">{t("marketing.office.scanTitle")}</p>
        <DemoLabel />
      </div>
      <ul className="marketing-scan-rows">
        {DEMO_PACKING_LIST.map((bundle, index) => (
          <li key={bundle.serial}>
            <i />
            <b>{bundle.serial}</b>
            <span>{`${demoKg(bundle)} kg`}</span>
            <span>{t("marketing.office.scanned")}</span>
            {index === 0 ? (
              <small>{`${t("marketing.label.heat")} ${DEMO_TRACE.heat} · ${t("marketing.label.die")} ${DEMO_TRACE.die} · ${t("marketing.office.pressRun")} ${DEMO_TRACE.run}`}</small>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="marketing-sheet-total">
        {t("packingList.totals", { bundles: DEMO_PACKING_LIST.length, kg: demoTotalKg(DEMO_PACKING_LIST) })}
      </p>
    </div>
  );
}
