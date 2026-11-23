import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { materialGroupText, materialsCsv, type MaterialClassRow } from "./reg-model";
import type { RegRangeSearch } from "./reg-search";
import { RegLoadFailed, RegLoading, RegRangeFields, useRegRange } from "./reg-shared";
import { NUM, ReportActions, ReportPrintContext, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

/** `/reports/materials` (#74): opening + in - out + gap = closing per material class, from the stock ledger. */
export function MaterialsReport({ search, onSearch }: { search: RegRangeSearch; onSearch: (next: RegRangeSearch) => void }) {
  return (
    <ReportsGate>
      <Body search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function Body({ search, onSearch }: { search: RegRangeSearch; onSearch: (next: RegRangeSearch) => void }) {
  const { t } = useT();
  const range = useRegRange(search);
  const query = useQuery({
    ...trpc.reports.materials.queryOptions(range ?? { from: "2000-01-01", to: "2000-01-01" }),
    enabled: range !== null,
    meta: INLINE_ERROR_META,
  });
  const data = query.data;

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.materials.title")}
        subtitle={t("reg.reports.materials.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (data && range ? { name: csvFileName(t("reg.reports.materials.csvName"), range.from, range.to), text: materialsCsv(data, t) } : null)} />
          </div>
        }
      />
      <ReportPrintContext parts={[range ? `${range.from} - ${range.to}` : null]} />
      <div className="report-no-print grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("common.filter")}>
        <RegRangeFields search={search} range={range} onSearch={onSearch} />
      </div>
      <p className="m-0 max-w-[70ch] text-[14px] leading-6 text-muted-foreground" data-testid="materials-explain">
        {t("reg.reports.materials.explain")}
      </p>

      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !data ? (
        <RegLoading />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="materials-classes">
          {data.classes.map((c) => (
            <ClassCard key={c.class} row={c} />
          ))}
        </div>
      )}
    </>
  );
}

function ClassCard({ row }: { row: MaterialClassRow }) {
  const { t } = useT();
  const fmt = useFmt();
  const kg = (g: number) => kgGrouped3(fmt, g);
  const unit = massUnit(fmt);
  const name = t(`reg.reports.materials.cls.${row.class}`);

  const section = (label: string, total: number, items: readonly { group: string; g: number }[]) => (
    <>
      <tr className="border-t border-border font-medium">
        <th scope="row" className={TD}>
          {label}
        </th>
        <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(total)}</td>
      </tr>
      {items.length === 0 ? (
        <tr>
          <td colSpan={2} className={`${TD} pl-6 text-muted-foreground`}>
            {t("reg.reports.materials.none")}
          </td>
        </tr>
      ) : (
        items.map((x) => (
          <tr key={x.group}>
            <th scope="row" className={`${TD} pl-6 font-normal`}>
              {materialGroupText(x.group, t)}
            </th>
            <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(x.g)}</td>
          </tr>
        ))
      )}
    </>
  );

  return (
    <section aria-labelledby={`mat-${row.class}`} className="flex min-w-0 flex-col gap-2" data-class={row.class}>
      <h2 id={`mat-${row.class}`} className="m-0 text-[17px] font-semibold">
        {name}
      </h2>
      <ReportTableFrame label={name}>
        <table className="report-table w-full border-collapse text-left text-[13px] leading-5">
          <caption className="sr-only">{name}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className={TH}>
                {t("reg.reports.materials.part")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("reg.reports.col.weight", { massUnit: unit })}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-medium">
              <th scope="row" className={TD}>
                {t("reg.reports.materials.opening")}
              </th>
              <td className={`${TD} ${NUM} whitespace-nowrap`} data-part="opening">
                {kg(row.openingG)}
              </td>
            </tr>
            {section(t("reg.reports.materials.in"), row.inG, row.inBy)}
            {section(t("reg.reports.materials.out"), row.outG, row.outBy)}
            {section(t("reg.reports.materials.gap"), row.gapG, row.gapBy)}
            <tr className="border-t border-border font-semibold">
              <th scope="row" className={TD}>
                {t("reg.reports.materials.closing")}
              </th>
              <td className={`${TD} ${NUM} whitespace-nowrap`} data-part="closing">
                {kg(row.closingG)}
              </td>
            </tr>
          </tbody>
        </table>
      </ReportTableFrame>
      {row.balanced ? null : (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {t("reg.reports.materials.unbalanced")}
        </p>
      )}
    </section>
  );
}
