import { useT } from "@orrn/i18n";

import { DEMO_PACKING_LIST, demoKg, demoTotalKg } from "./demo-data";
import { DemoLabel } from "./demo-label";

export function Office() {
  const { t } = useT();
  return (
    <section id="office" className="marketing-container marketing-record" aria-labelledby="office-title">
      <div className="marketing-record-copy">
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
          <p className="marketing-sheet-title">{t("packingList.title")}</p>
          <p className="marketing-sheet-customer">{t("marketing.office.demoCustomer")}</p>
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
                  <td>{bundle.serial}</td><td>{bundle.pieces}</td><td>{demoKg(bundle)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="marketing-sheet-total">{t("packingList.totals", {
            bundles: DEMO_PACKING_LIST.length, kg: demoTotalKg(DEMO_PACKING_LIST),
          })}</p>
        </div>
      </div>
    </section>
  );
}
