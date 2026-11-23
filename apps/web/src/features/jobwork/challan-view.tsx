import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect } from "react";

import { usePaperFmt } from "@/shared/lib/fmt";
import { bookDateText, countText, kgGrouped2, massUnit, paperT, rateText, rupeeScreen } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { challanTotals, processWord, serialsLine } from "./model";

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html[data-challan-print] [data-slot="side-nav"],
  html[data-challan-print] [data-slot="tab-bar"],
  html[data-challan-print] [data-shell-chrome],
  html[data-challan-print] [data-slot="app-shell"] > a,
  html[data-challan-print] .challan-no-print { display: none !important; }
  html[data-challan-print] [data-slot="app-shell"],
  html[data-challan-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-challan-print] main > div { max-width: none !important; padding: 0 !important; }
  html[data-challan-print] .challan-sheet { border: 0 !important; padding: 0 !important; font-size: 11px !important; }
}
`;

/**
 * `/jobwork/$id/challan`: the A4 delivery challan for goods sent for job work (GST rule 55 and section 143), read from
 * `process.steps.challan` as a snapshot and printed by the browser. A paper: today's units, words and date style whatever the
 * plant chose for its screens (guarded by paper-guard.test.ts). It says goods go for job work and not for sale, names the
 * consigner and the consignee, and has the HSN, pieces, kg, declared value, expected return, vehicle and the signatures.
 */
export function ChallanScreen({ id }: { id: string }) {
  const fmt = usePaperFmt();
  const { t: tUi } = useT();
  const t = paperT(tUi);
  const { data: me } = useMe();
  const q = useQuery({ ...trpc.process.steps.challan.queryOptions({ id }), meta: INLINE_ERROR_META, retry: (n, e) => !isNotFound(e) && n < 2 });
  useEffect(() => {
    document.documentElement.dataset.challanPrint = "1";
    return () => {
      delete document.documentElement.dataset.challanPrint;
    };
  }, []);
  const back = { to: `/jobwork/${id}`, label: t("jw.challan.back") };

  if (q.isError && isNotFound(q.error)) {
    return (
      <>
        <PageHeader title={t("jw.challan.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("jw.challan.notJobwork")} />
        </div>
      </>
    );
  }
  if (showsQueryError(q)) {
    return (
      <>
        <PageHeader title={t("jw.challan.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("jw.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title={t("jw.challan.title")} back={back} />
        <Skeleton className="h-64 rounded-card" aria-busy="true" />
      </>
    );
  }
  const c = q.data;
  const totals = challanTotals(c.items);
  const cancelled = c.status === "cancelled";
  const kg = (g: number) => kgGrouped2(fmt, g);
  const unit = massUnit(fmt);
  const party = (name: string | null, gstin: string | null, address: string | null, extra: (string | null)[]) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="m-0 text-[15px] font-semibold break-words">{name ?? "-"}</p>
      {[address, gstin ? `GSTIN ${gstin}` : null, ...extra].filter(Boolean).map((line) => (
        <p key={line} className="m-0 text-[13px] break-words">
          {line}
        </p>
      ))}
    </div>
  );
  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t("jw.challan.title")}
        back={back}
        subtitle={c.number}
        actions={
          <Button className="challan-no-print" onClick={() => window.print()} data-testid="challan-print">
            <Printer aria-hidden="true" className="size-4" />
            {t("common.print")}
          </Button>
        }
      />
      <article aria-label={t("jw.challan.title")} className="challan-sheet flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 text-[13px] sm:p-6" data-testid="challan-sheet" data-number={c.number}>
        <header className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 text-center">
          <h2 className="m-0 font-display text-[22px] leading-tight font-bold tracking-[-0.02em]">{t("jw.challan.heading")}</h2>
          <p className="m-0 text-[13px] font-semibold">{t("jw.challan.notForSale")}</p>
          <p className="m-0 text-[12px]">{t("jw.challan.rule")}</p>
          {cancelled ? <p className="m-0 text-[13px] font-bold uppercase" data-testid="challan-cancelled">{t("jw.challan.cancelled")}</p> : null}
        </header>

        <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {[
            [t("jw.challan.number"), c.number, true],
            [t("jw.challan.date"), bookDateText(fmt, c.date), false],
            [t("jw.challan.process"), `${t(`jw.process.${processWord(c.process)}`)}${c.finishCode ? ` (${c.finishCode})` : ""}`, false],
            [t("jw.challan.hsn"), c.hsn, true],
            [t("jw.challan.expected"), c.expectedReturn ? bookDateText(fmt, c.expectedReturn) : "-", false],
            [t("jw.challan.vehicle"), c.vehicleNo ?? "-", true],
            ...(c.interState ? [[t("jw.challan.placeOfSupply"), c.consignee.state ?? "-", false] as [string, string, boolean]] : []),
            ...(c.valuePaisePerKg ? [[t("jw.challan.valueRate"), t("jw.rate.perKg", { rate: rateText(fmt, c.valuePaisePerKg) }), false] as [string, string, boolean]] : []),
          ].map(([label, value, mono]) => (
            <div key={String(label)} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
              <dd className={`m-0 font-semibold break-words ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid min-w-0 grid-cols-1 gap-4 border-y border-border py-3 sm:grid-cols-2">
          <section aria-label={t("jw.challan.consigner")} data-testid="challan-consigner">
            <p className="m-0 mb-1 text-[12px] font-medium text-muted-foreground">{t("jw.challan.consigner")}</p>
            {party(c.consigner.legalName ?? me?.company?.name ?? null, c.consigner.gstin, c.consigner.address, [c.consigner.phone])}
          </section>
          <section aria-label={t("jw.challan.consignee")} data-testid="challan-consignee">
            <p className="m-0 mb-1 text-[12px] font-medium text-muted-foreground">{t("jw.challan.consignee")}</p>
            {party(c.consignee.name, c.consignee.gstin, c.consignee.address, [c.consignee.state, c.consignee.phone])}
          </section>
        </div>

        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]" data-testid="challan-lines">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 pr-2 font-semibold">{t("jw.challan.item")}</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">{t("jw.col.length")}</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">{t("jw.col.bundles")}</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">{t("jw.col.pcs")}</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">{t("jw.challan.qty")}</th>
                <th scope="col" className="py-1.5 text-right font-semibold">{t("jw.challan.value")}</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i, n) => (
                <tr key={n} className="border-b border-border/60 align-top">
                  <td className="py-1.5 pr-2 break-words">
                    <span className="font-semibold">{i.sectionCode}</span>
                    {i.sectionName ? <span className="text-muted-foreground"> {i.sectionName}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmt.q("bundle.length", i.lengthMm)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{countText(fmt, i.bundles)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{countText(fmt, i.pcs)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{kg(i.weightG)} {unit}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupeeScreen(fmt, i.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold" data-testid="challan-totals">
                <td className="pt-2 pr-2">{t("jw.challan.total")}</td>
                <td />
                <td className="pt-2 pr-2 text-right tabular-nums">{countText(fmt, totals.bundles)}</td>
                <td className="pt-2 pr-2 text-right tabular-nums">{countText(fmt, totals.pcs)}</td>
                <td className="pt-2 pr-2 text-right tabular-nums">{kg(totals.weightG)} {unit}</td>
                <td className="pt-2 text-right tabular-nums">{rupeeScreen(fmt, totals.valuePaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <section aria-label={t("jw.challan.serials")} className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[12px] font-medium text-muted-foreground">{t("jw.challan.serials")}</p>
          <p className="m-0 font-mono text-[12px] leading-5 break-words" data-testid="challan-serials">{serialsLine(c.serials)}</p>
        </section>
        {c.note ? <p className="m-0 text-[13px]">{c.note}</p> : null}

        <div className="grid min-w-0 grid-cols-1 gap-6 pt-10 sm:grid-cols-3" data-testid="challan-signatures">
          {[t("jw.challan.sigConsigner"), t("jw.challan.sigTransporter"), t("jw.challan.sigConsignee")].map((label) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 border-t border-foreground pt-1 text-[12px]">
              {label}
            </div>
          ))}
        </div>
      </article>
    </>
  );
}
