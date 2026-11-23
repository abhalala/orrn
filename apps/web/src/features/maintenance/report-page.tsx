import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { rupeeScreen } from "@/shared/lib/fmt-text";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { ymdInZone } from "@/shared/lib/plant-calendar";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useCompanyTimeZone } from "../orders/hooks";
import { ReportActions, ReportPrintStyle, ReportTableFrame } from "../reports/report-chrome";
import { defaultRange, paiseToRupeesText, rangeProblem, rupeesToPaise } from "./asset-model";
import { maintErrorKey } from "./model";
import { MonthsTable, StillOpenList, TotalsTable } from "./report-parts";

const PROBLEM_KEY = {
  bad: "maint.reports.rangeBad",
  order: "maint.reports.rangeOrder",
  long: "maint.reports.rangeLong",
} as const;

/** `/maintenance/report`: breakdowns, downtime, repair time, labour and spares per asset over a range of months. */
export function MaintReportPage() {
  const { t } = useT();
  const fmt = useFmt();
  const zone = useCompanyTimeZone();
  const initial = defaultRange(ymdInZone(Date.now(), zone));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const problem = rangeProblem(from, to);
  const q = useQuery({
    ...trpc.maint.reports.summary.queryOptions({ from, to }),
    enabled: problem === null,
    retry: false,
    meta: INLINE_ERROR_META,
  });
  const money = (paise: number) => `₹${rupeeScreen(fmt, paise)}`;
  const data = q.data;

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("maint.reports.title")}
        subtitle={t("maint.reports.subtitle")}
        back={{ to: "/maintenance", label: t("maint.reports.back") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions />
          </div>
        }
      />
      <div className="report-no-print grid grid-cols-1 gap-3 sm:max-w-[28rem] sm:grid-cols-2">
        <Field label={t("maint.reports.from")}>
          <TextInput type="month" value={from} max={to || undefined} placeholder="YYYY-MM" onChange={(e) => setFrom(e.currentTarget.value)} data-testid="maint-from" />
        </Field>
        <Field label={t("maint.reports.to")}>
          <TextInput type="month" value={to} min={from || undefined} placeholder="YYYY-MM" onChange={(e) => setTo(e.currentTarget.value)} data-testid="maint-to" />
        </Field>
      </div>
      {problem ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {t(PROBLEM_KEY[problem])}
        </p>
      ) : null}

      {problem ? null : q.isError && !data ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={t(q.error && (q.error as { data?: { code?: string } }).data?.code === "FORBIDDEN" ? maintErrorKey(q.error) : "maint.reports.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("maint.reports.empty")} />
        </div>
      ) : (
        <>
          {data.truncated ? (
            <p role="status" className="m-0 text-[14px] font-medium text-destructive" data-testid="maint-report-truncated">
              {t("maint.reports.truncated")}
            </p>
          ) : null}
          <p className="m-0 text-[14px] text-muted-foreground" data-testid="maint-month-rule">
            {t("maint.reports.monthRule")}
          </p>
          {!data.sparesValueKnown ? (
            <p className="m-0 text-[14px] text-muted-foreground" data-testid="spares-not-counted">
              {t("maint.reports.sparesNotCounted")}
            </p>
          ) : null}
          {data.showMoney && data.labourRatePaisePerHour == null ? <p className="m-0 text-[14px] text-muted-foreground">{t("maint.reports.noLabourRate")}</p> : null}
          <ReportTableFrame label={t("maint.reports.total")}>
            <TotalsTable rows={data.rows} showMoney={data.showMoney} money={money} assetLabel={t("maint.assets.cols.name")} />
          </ReportTableFrame>
          <StillOpenList rows={data.rows} />
          <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("maint.reports.byMonth")}</h2>
          <div className="flex flex-col gap-3">
            {data.rows.map((r) => (
              <details key={r.asset.id} className="rounded-card border border-border bg-card" data-asset={r.asset.code}>
                <summary className="min-h-11 cursor-pointer px-4 py-3 text-[15px] font-semibold">
                  <span className="font-mono">{r.asset.code}</span> {r.asset.name}
                </summary>
                <div className="px-2 pb-3">
                  <ReportTableFrame label={`${r.asset.code} ${r.asset.name}`}>
                    <MonthsTable row={r} showMoney={data.showMoney} money={money} />
                  </ReportTableFrame>
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      <Can do="maint.manage">
        <RateCard />
      </Can>
    </>
  );
}

function RateCard() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const q = useQuery({
    ...trpc.maint.settings.get.queryOptions(),
    retry: false,
    meta: INLINE_ERROR_META,
  });
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const loaded = q.data?.labourRatePaisePerHour;
  /** True once the field was typed in after the last load or save; a refetch must not overwrite it. */
  const edited = useRef(false);
  useEffect(() => {
    if (q.data && !edited.current) setText(paiseToRupeesText(q.data.labourRatePaisePerHour));
  }, [q.data]);
  const save = useOnceMutation(
    trpc.maint.settings.set.mutationOptions({
      onSuccess: () => {
        toast.success(t("maint.reports.rate.saved"));
        void queryClient.invalidateQueries(trpc.maint.pathFilter());
      },
      onError: (e) => {
        edited.current = true; // the draft was not saved: keep it
        toast.error(t(maintErrorKey(e)));
      },
    }),
  );
  const paise = rupeesToPaise(text);
  const error = paise === "bad" ? t("maint.reports.rate.needsNumber") : typeof paise === "number" && paise > 100_000_000 ? t("maint.reports.rate.tooBig") : undefined;
  return (
    <section className="report-no-print flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:max-w-[28rem]" data-testid="labour-rate-card">
      <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("maint.reports.rate.title")}</h2>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("maint.reports.rate.hint")}</p>
      {q.isError && !q.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-2" data-testid="labour-rate-error">
          <span className="text-[14px] font-medium text-destructive">{t("maint.reports.rate.loadFailed")}</span>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <>
          <Field label={t("maint.reports.rate.label")} error={tried ? error : undefined}>
            <TextInput
              inputMode="decimal"
              value={text}
              disabled={loaded === undefined}
              onChange={(e) => {
                edited.current = true;
                setText(e.currentTarget.value);
              }}
              autoComplete="off"
            />
          </Field>
          <div>
            <Button
              loading={save.isPending}
              disabled={loaded === undefined}
              onClick={() => {
                setTried(true);
                if (error || paise === "bad") return;
                edited.current = false; // edits made after this point are kept over the refetch
                save.mutate({ labourRatePaisePerHour: paise });
              }}
            >
              {t("maint.reports.rate.save")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
