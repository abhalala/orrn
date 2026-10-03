import {
  packingListModel,
  safeParsePackingListSnapshot,
  type PackingListGroup,
  type PackingListModel,
  type PackingListRow,
} from "@orrn/documents/packing-list/model";
import { formatKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { downloadPackingListPdf, downloadPackingListXlsx } from "@/shared/lib/exports";
import { trpc } from "@/shared/utils/trpc";

import { dispatchErrorText } from "./errors";
import { formatShipDate } from "./format";
import { useCompanyTimeZone } from "./hooks";

const num = (v: number | null, digits: number) => (v === null ? "-" : v.toFixed(digits));
const bundleWord = (t: ReturnType<typeof useT>["t"], n: number) => t("units.bundles", { count: n });

/**
 * The packing list, the dispatch's final state. Header (company, customer, PL
 * no, dispatch, date, ship date, totals "N bundles · X kg") and the plant's
 * columns, grouped by packing group label, from the stored snapshot parsed
 * once (W17). PDF and Excel are made on click (W3); Regenerate rebuilds it
 * from the bundles as they are now.
 */
export function PackingListView({ dispatchId }: { dispatchId: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const pl = useQuery(trpc.packingList.byDispatch.queryOptions({ dispatchId }));
  const parsed = useMemo(() => (pl.data ? safeParsePackingListSnapshot(pl.data.snapshot) : null), [pl.data]);
  const model = useMemo(
    () => (parsed?.success ? packingListModel(parsed.data, { timeZone }) : null),
    [parsed, timeZone],
  );
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const regenerate = useMutation(trpc.packingList.regenerate.mutationOptions());
  const make = useMutation(trpc.packingList.create.mutationOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.packingList.byDispatch.queryKey({ dispatchId }) });

  const download = async (kind: "pdf" | "xlsx") => {
    if (!pl.data || !parsed?.success) return;
    setDownloading(kind);
    try {
      if (kind === "pdf") await downloadPackingListPdf(parsed.data, pl.data.code, { timeZone });
      else await downloadPackingListXlsx(parsed.data, pl.data.code, { timeZone });
    } catch (err) {
      console.error("packing list export failed", err);
      toast.error(t("packingList.downloadFailed"));
    } finally {
      setDownloading(null);
    }
  };

  const regenButton = (
    <Can do="packingList.regenerate">
      <Button variant="ghost" onClick={() => setConfirmRegen(true)} aria-haspopup="dialog">
        <RefreshCw aria-hidden="true" strokeWidth={2} />
        {t("packingList.regenerate")}
      </Button>
    </Can>
  );

  let body;
  if (pl.isPending) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-[180px] w-full rounded-card" />
        <Skeleton className="h-[240px] w-full rounded-card" />
      </div>
    );
  } else if (pl.isError) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={dispatchErrorText(t, pl.error)}
          action={
            <Button variant="secondary" onClick={() => void pl.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  } else if (!pl.data) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("packingList.missing")}
          action={
            <Can do="dispatch.complete">
              <Button
                loading={make.isPending}
                onClick={() =>
                  make.mutate(
                    { dispatchId },
                    {
                      onSuccess: () => {
                        toast.success(t("packingList.made"));
                        void refresh();
                      },
                      onError: (err) => toast.error(dispatchErrorText(t, err)),
                    },
                  )
                }
              >
                {t("packingList.make")}
              </Button>
            </Can>
          }
        />
      </div>
    );
  } else if (!model) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={t("packingList.loadError")} action={regenButton} />
      </div>
    );
  } else {
    body = <PackingListBody model={model} code={pl.data.code} />;
  }

  return (
    <section aria-labelledby="packing-list-title" data-slot="packing-list" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 id="packing-list-title" className="m-0 font-display text-[22px] font-bold tracking-[-0.025em]">
          {t("packingList.title")}
        </h2>
        {model ? (
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" loading={downloading === "pdf"} disabled={downloading !== null} onClick={() => void download("pdf")}>
              <FileDown aria-hidden="true" strokeWidth={2} />
              {t("packingList.downloadPdf")}
            </Button>
            <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" loading={downloading === "xlsx"} disabled={downloading !== null} onClick={() => void download("xlsx")}>
              <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
              {t("packingList.downloadExcel")}
            </Button>
            <div className="col-span-2 sm:col-auto">{regenButton}</div>
          </div>
        ) : null}
      </div>
      {body}
      <Dialog
        open={confirmRegen}
        onOpenChange={(open) => !regenerate.isPending && setConfirmRegen(open)}
        title={t("packingList.regenerateTitle")}
        description={t("packingList.regenerateBody")}
        actions={
          <>
            <Button variant="secondary" disabled={regenerate.isPending} onClick={() => setConfirmRegen(false)}>
              {t("common.back")}
            </Button>
            <Button
              loading={regenerate.isPending}
              disabled={!pl.data}
              onClick={() =>
                pl.data &&
                regenerate.mutate(
                  { id: pl.data.id },
                  {
                    onSuccess: () => {
                      toast.success(t("packingList.regenerated"));
                      setConfirmRegen(false);
                      void refresh();
                    },
                    onError: (err) => toast.error(dispatchErrorText(t, err)),
                  },
                )
              }
            >
              {t("packingList.regenerate")}
            </Button>
          </>
        }
      />
    </section>
  );
}

function PackingListBody({ model, code }: { model: PackingListModel; code: string }) {
  const { t, locale } = useT();
  const wide = useMediaQuery(breakpoints.desktop);
  const { header, groups, totals } = model;
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: t("packingList.plNo"), value: code, mono: true },
    { label: t("packingList.dispatch"), value: header.dispatchCode, mono: true },
    { label: t("packingList.date"), value: formatShipDate(header.date, { locale }) ?? t("packingList.notSet") },
    { label: t("packingList.shipDate"), value: formatShipDate(header.shipDate, { locale }) ?? t("packingList.notSet") },
  ];
  return (
    <>
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] break-words">{header.companyName}</p>
            <p className="m-0 text-[14px] text-muted-foreground">{t("packingList.title")}</p>
          </div>
          <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="flex min-w-0 flex-col">
                <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
                <dd className={f.mono ? "m-0 font-mono text-[15px] font-semibold [overflow-wrap:anywhere]" : "m-0 text-[15px] font-semibold"}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 text-[13px] text-muted-foreground">{t("packingList.customer")}</p>
          <p className="m-0 font-display text-[19px] leading-snug font-bold tracking-[-0.015em] break-words">{header.customerName}</p>
          {header.customerTaxId ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("packingList.gstin")} <span className="font-mono">{header.customerTaxId}</span>
            </p>
          ) : null}
          {header.notes ? <p className="m-0 mt-1 text-[14px] break-words">{header.notes}</p> : null}
        </div>
        <p data-testid="packing-list-totals" data-no-truncate="" className="m-0 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.03em] tabular-nums sm:text-[34px]">
          {t("packingList.totals", { bundles: totals.bundles, kg: formatKg(totals.weightKg) })}
        </p>
      </div>
      {wide ? <PackingListTable groups={groups} totals={totals} /> : <PackingListStack groups={groups} totals={totals} />}
    </>
  );
}

function groupTitle(t: ReturnType<typeof useT>["t"], g: PackingListGroup) {
  return g.labelled ? `${t("packingList.groupNamed", { label: g.label })}: ${g.dieLabel}` : g.label;
}

function PackingListTable({ groups, totals }: Pick<PackingListModel, "groups" | "totals">) {
  const { t } = useT();
  const cols = [
    { key: "sr", label: t("packingList.columns.sr"), end: false },
    { key: "bundle", label: t("packingList.columns.bundleNo"), end: false },
    { key: "item", label: t("packingList.columns.item"), end: false },
    { key: "kg", label: t("packingList.columns.weightKg"), end: true },
    { key: "ft", label: t("packingList.columns.cutLengthFt"), end: true },
    { key: "in", label: t("packingList.columns.cutLengthIn"), end: true },
    { key: "pcs", label: t("packingList.columns.pcs"), end: true },
    { key: "k12", label: t("packingList.columns.kgPer12ft"), end: true },
    { key: "range", label: t("packingList.columns.weightRange"), end: true },
  ];
  const cell = "px-3 py-2 first:pl-5 last:pr-5";
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
      <div className="overflow-x-auto">
        <table data-testid="packing-list-table" aria-label={t("packingList.rowsLabel")} className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`h-11 ${cell} text-[13px] font-semibold text-muted-foreground ${c.end ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr className="border-b border-border bg-surface-sunken/60">
                <th scope="rowgroup" colSpan={cols.length} className={`${cell} text-left text-[14px] font-semibold`}>
                  {groupTitle(t, g)}
                </th>
              </tr>
              {g.rows.map((r) => (
                <PlTableRow key={r.sr} row={r} cell={cell} />
              ))}
              <tr className="border-b border-border font-semibold">
                <td className={cell} />
                <td className={`${cell} whitespace-nowrap`}>{bundleWord(t, g.bundles)}</td>
                <td className={cell}>{t("packingList.groupTotalOf", { label: g.label })}</td>
                <td className={`${cell} text-right font-mono tabular-nums`}>{formatKg(g.weightKg)}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={`${cell} text-right font-mono tabular-nums`}>{g.pieces}</td>
                <td className={cell} />
                <td className={cell} />
              </tr>
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-foreground text-[15px] font-bold">
              <td className={cell} />
              <td className={`${cell} whitespace-nowrap`}>{bundleWord(t, totals.bundles)}</td>
              <td className={cell}>{t("packingList.grandTotal")}</td>
              <td className={`${cell} text-right font-mono tabular-nums`} data-testid="packing-list-total-kg">
                {formatKg(totals.weightKg)}
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={`${cell} text-right font-mono tabular-nums`}>{totals.pieces}</td>
              <td className={cell} />
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PlTableRow({ row: r, cell }: { row: PackingListRow; cell: string }) {
  return (
    <tr data-testid="packing-list-row" className="border-b border-border">
      <td className={`${cell} font-mono text-muted-foreground tabular-nums`}>{r.sr}</td>
      <td className={`${cell} font-mono font-semibold whitespace-nowrap`}>{r.bundleNo}</td>
      <td className={`${cell} break-words`}>{r.item}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{formatKg(r.weightKg)}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.cutLengthFt}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.cutLengthIn}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.pcs}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{num(r.kgPer12ft, 3)}</td>
      <td className={`${cell} text-right font-mono font-semibold tabular-nums`}>{num(r.weightRange12ft, 1)}</td>
    </tr>
  );
}

function PackingListStack({ groups, totals }: Pick<PackingListModel, "groups" | "totals">) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => (
        <section key={g.key} aria-label={groupTitle(t, g)} className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
          <div className="flex min-w-0 flex-col gap-0.5 border-b border-border px-4 py-3">
            <h3 className="m-0 text-[15px] font-semibold break-words">{groupTitle(t, g)}</h3>
            <p className="m-0 text-[13px] text-muted-foreground tabular-nums">
              {t("packingList.totals", { bundles: g.bundles, kg: formatKg(g.weightKg) })}
            </p>
          </div>
          <ul aria-label={t("packingList.rowsLabel")} className="m-0 list-none divide-y divide-border p-0">
            {g.rows.map((r) => (
              <li key={r.sr} data-testid="packing-list-row" className="flex min-w-0 flex-col gap-2 px-4 py-3">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="mr-2 font-mono text-[13px] text-muted-foreground">{r.sr}</span>
                    <span className="font-mono text-[16px] font-semibold">{r.bundleNo}</span>
                  </span>
                  <span data-no-truncate="" className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
                    {formatKg(r.weightKg)} {t("units.kg")}
                  </span>
                </div>
                {g.labelled ? <p className="m-0 text-[13px] text-muted-foreground break-words">{r.item}</p> : null}
                <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-1.5">
                  <Fact label={t("packingList.columns.cutLengthFt")} value={String(r.cutLengthFt)} />
                  <Fact label={t("packingList.columns.cutLengthIn")} value={String(r.cutLengthIn)} />
                  <Fact label={t("packingList.columns.pcs")} value={String(r.pcs)} />
                  <Fact label={t("packingList.columns.kgPer12ft")} value={num(r.kgPer12ft, 3)} />
                  <Fact label={t("packingList.columns.weightRange")} value={num(r.weightRange12ft, 1)} strong />
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-card border-2 border-foreground bg-card px-4 py-3">
        <span className="text-[15px] font-bold">{t("packingList.grandTotal")}</span>
        <span data-testid="packing-list-total-kg" data-no-truncate="" className="font-mono text-[17px] font-bold tabular-nums">
          {t("packingList.totals", { bundles: totals.bundles, kg: formatKg(totals.weightKg) })}
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[12px] leading-4 text-muted-foreground break-words">{label}</dt>
      <dd className={`m-0 font-mono text-[14px] tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
