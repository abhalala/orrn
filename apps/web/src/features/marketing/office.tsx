/**
 * For the office: three plain points beside a packing list laid out like the
 * plant's printed one (company header, PL no, the same columns). Demo data.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { FileText, Printer, Warehouse, type LucideIcon } from "lucide-react";

import { DEMO_PACKING_LIST, demoKg, demoKg12ft, demoTotalKg } from "./demo-data";
import { DemoLabel } from "./demo-label";

const POINTS: { icon: LucideIcon; text: MessageKey }[] = [
  { icon: Warehouse, text: "marketing.office.stock" },
  { icon: FileText, text: "marketing.office.packingList" },
  { icon: Printer, text: "marketing.office.labels" },
];

export function Office() {
  const { t } = useT();
  return (
    <section id="office" aria-labelledby="office-title" className="orrn-section py-20 md:py-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center lg:gap-16">
        <div className="min-w-0">
          <h2 id="office-title" className="orrn-display-2 m-0 text-balance text-foreground">
            {t("marketing.office.title")}
          </h2>
          <ul className="m-0 mt-8 flex list-none flex-col gap-7 p-0">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex min-w-0 gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground"
                >
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <p className="m-0 min-w-0 pt-2.5 text-[16px] leading-7 text-foreground">{t(text)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <PackingListSheet />
        </div>
      </div>
    </section>
  );
}

/** The example sheet's date, in the reader's language (it is demo data, like the rest). */
const DEMO_DATE = new Date(2026, 9, 3);

function PackingListSheet() {
  const { t, locale } = useT();
  const date = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" }).format(
    DEMO_DATE,
  );
  const th = "px-2 py-2.5 text-left text-[12px] font-semibold text-muted-foreground first:pl-0 last:pr-0";
  const td = "px-2 py-2.5 font-mono text-[13px] text-foreground first:pl-0 last:pr-0";
  return (
    <div
      data-demo-visual
      aria-hidden="true"
      className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground">
            {t("marketing.office.demoCompany")}
          </p>
          <p className="m-0 mt-1 text-[14px] font-semibold text-muted-foreground">{t("packingList.title")}</p>
        </div>
        <DemoLabel />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-3">
        <Fact label={t("packingList.plNo")} value="DSP-000412" mono />
        <Fact label={t("packingList.date")} value={date} />
        <Fact label={t("packingList.customer")} value={t("marketing.office.demoCustomer")} />
      </dl>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>{t("packingList.columns.sr")}</th>
            <th scope="col" className={th}>{t("packingList.columns.bundleNo")}</th>
            <th scope="col" className={`${th} text-right`}>{t("packingList.columns.weightKg")}</th>
            <th scope="col" className={`${th} hidden text-right sm:table-cell`}>{t("packingList.columns.pcs")}</th>
            <th scope="col" className={`${th} hidden text-right sm:table-cell`}>{t("packingList.columns.kgPer12ft")}</th>
          </tr>
        </thead>
        <tbody>
          {DEMO_PACKING_LIST.map((b, i) => (
            <tr key={b.serial} className="border-b border-border last:border-b-0">
              <td className={td}>{i + 1}</td>
              <td className={`${td} font-semibold`}>{b.serial}</td>
              <td className={`${td} text-right`}>{demoKg(b)}</td>
              <td className={`${td} hidden text-right sm:table-cell`}>{b.pieces}</td>
              <td className={`${td} hidden text-right sm:table-cell`}>{demoKg12ft(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="m-0 text-right font-mono text-[14px] font-semibold text-foreground">
        {t("packingList.totals", { bundles: DEMO_PACKING_LIST.length, kg: demoTotalKg(DEMO_PACKING_LIST) })}
      </p>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={`m-0 mt-0.5 text-[15px] font-semibold text-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
