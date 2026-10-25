import { gToKg, formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { kgFromG, percentOfBp } from "./model";
import { reasonLabel } from "./reason-label";
import type { SummarySearch } from "./search";

/** `/press/summary`: the production day's three numbers, the stops longest first, shifts and late share. */
export function SummaryScreen({ search, onSearch }: { search: SummarySearch; onSearch: (next: SummarySearch) => void }) {
  const { t } = useT();
  const query = useQuery({ ...trpc.press.summary.queryOptions(search.day ? { productionDay: search.day } : {}), meta: INLINE_ERROR_META });
  const data = query.data;
  const header = (
    <PageHeader
      title={t("press.summary.title")}
      subtitle={data ? `${t("press.summary.day")} ${data.productionDay}` : undefined}
      back={{ to: "/press", label: t("press.title") }}
      actions={
        <Can do="reports.read">
          <Button asChild variant="secondary">
            <UiLink to={data ? `/press/report?from=${data.productionDay}&to=${data.productionDay}` : "/press/report"}>{t("press.summary.report")}</UiLink>
          </Button>
        </Can>
      }
    />
  );
  if (showsQueryError(query)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("press.summary.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <Skeleton className="h-32 rounded-card" />
      </>
    );
  }
  const totalStop = data.downtimeByReason.reduce((s, r) => s + r.min, 0);
  return (
    <>
      {header}
      <div className="max-w-[16rem]">
        <Field label={t("press.summary.day")}>
          <TextInput type="date" value={data.productionDay} onChange={(e) => onSearch(e.currentTarget.value ? { day: e.currentTarget.value } : {})} />
        </Field>
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">{t("press.summary.dayHint")}</p>
      {data.runs === 0 && data.downtimeMin === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("press.summary.noRuns")} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* BACKLOG 53b: pressed kg and recovery are production runs only; trial and sample kg is said apart. */}
          <StatusBlock
            tone="green"
            title={t("press.summary.pressedToday")}
            meta={[t("press.summary.runs") + ": " + data.runs, data.trialRuns > 0 ? t("press.summary.trials", { kg: kgFromG(data.trialKgG) }) : null].filter(Boolean).join(" · ")}
            value={gToKg(data.kgG)}
            unit={t("units.kg")}
            format={formatKgTotal}
            countUp={false}
          />
          <StatusBlock tone="blue" title={t("press.summary.recovery")} meta={t("press.summary.pieces") + ": " + data.pcs} value={data.recoveryBp == null ? "—" : Number(percentOfBp(data.recoveryBp))} unit={data.recoveryBp == null ? undefined : "%"} format={(n) => n.toFixed(1)} countUp={false} />
          <StatusBlock tone="amber" title={t("press.summary.downtime")} meta={`${t("press.summary.scrap")}: ${kgFromG(data.scrapG)} ${t("units.kg")}`} value={data.downtimeMin} unit={t("units.min")} countUp={false} />
        </div>
      )}

      {data.byLine.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-5" aria-labelledby="by-line">
          <h2 id="by-line" className="m-0 text-[15px] font-semibold">
            {t("press.summary.byLine")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.byLine.map((l) => (
              <li key={l.pressLineId} data-line={l.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[15px]">
                <span className="font-mono font-semibold">{l.code}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t("press.summary.shiftRow", { runs: l.runs, kg: kgFromG(l.kgG) })}
                  {l.trialKgG > 0 ? ` · ${t("press.summary.trials", { kg: kgFromG(l.trialKgG) })}` : ""}
                  {l.recoveryBp != null ? ` · ${percentOfBp(l.recoveryBp)}%` : ""}
                </span>
                <span className="tabular-nums">{t("press.summary.minutes", { min: l.downtimeMin })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-5" aria-labelledby="stops">
        <h2 id="stops" className="m-0 text-[15px] font-semibold">
          {t("press.summary.stops")}
        </h2>
        {data.downtimeByReason.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {data.downtimeByReason.map((r) => (
              <li key={r.code} className="min-w-0" data-reason={r.code}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[15px] font-medium">{reasonLabel(t, "downtime", r.code, r.label)}</span>
                  <span className="tabular-nums">{t("press.summary.minutes", { min: r.min })}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div className="h-2 rounded-full bg-foreground" style={{ width: `${Math.max(6, totalStop ? (r.min / totalStop) * 100 : 0)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[14px] text-muted-foreground">{t("press.summary.stopsNone")}</p>
        )}
      </section>

      {data.byShift.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-5" aria-labelledby="by-shift">
          <h2 id="by-shift" className="m-0 text-[15px] font-semibold">
            {t("press.summary.shifts")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
            {data.byShift.map((s) => (
              <li key={s.shiftSeq ?? "none"} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-medium">{s.shiftName ?? s.shiftSeq ?? ""}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t("press.summary.shiftRow", { runs: s.runs, kg: kgFromG(s.kgG) })}
                  {s.trialKgG > 0 ? ` · ${t("press.summary.trials", { kg: kgFromG(s.trialKgG) })}` : ""}
                  {s.recoveryBp != null ? ` · ${percentOfBp(s.recoveryBp)}%` : ""}
                </span>
                {s.lateRuns > 0 ? <span className="tabular-nums">{t("press.summary.late")}: {s.lateRuns}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
