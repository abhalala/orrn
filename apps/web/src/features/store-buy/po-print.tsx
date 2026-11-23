import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect } from "react";

import { formatQty } from "@/features/store/store-qty";
import { unitShort } from "@/features/store/store-labels";
import { StoreLoadError } from "@/features/store/store-ui";
import { usePaperFmt } from "@/shared/lib/fmt";
import { bookDateText, dateText, paperT } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { bpText, rupees } from "./money";

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html[data-po-print] [data-slot="side-nav"],
  html[data-po-print] [data-slot="tab-bar"],
  html[data-po-print] [data-shell-chrome],
  html[data-po-print] [data-slot="app-shell"] > a,
  html[data-po-print] .po-no-print { display: none !important; }
  html[data-po-print] [data-slot="app-shell"],
  html[data-po-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-po-print] main > div { max-width: none !important; padding: 0 !important; }
  html[data-po-print] .po-paper { border: 0 !important; padding: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; }
}
`;

/**
 * `/store/po/$id/print` (XE store row 70): the A4 purchase order a vendor receives. It is a paper that
 * leaves the plant, so it reads the paper formatter and the paper words (today's units, Indian grouping,
 * day month year) whatever the plant chose for its screens (guarded by paper-guard.test.ts).
 */
export function PoPrintScreen({ id }: { id: string }) {
  const fmt = usePaperFmt();
  const { t: tUi } = useT();
  const t = paperT(tUi);
  const query = useQuery({ ...trpc.store.po.get.queryOptions({ id }), meta: INLINE_ERROR_META });
  useEffect(() => {
    document.documentElement.dataset.poPrint = "1";
    return () => {
      delete document.documentElement.dataset.poPrint;
    };
  }, []);

  const back = { to: `/store/po/${encodeURIComponent(id)}`, label: t("store2.po.print.back") };
  if (showsQueryError(query)) {
    return (
      <>
        <PageHeader title={t("store2.po.print.title")} back={back} />
        <StoreLoadError onRetry={() => void query.refetch()} />
      </>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <>
        <PageHeader title={t("store2.po.print.title")} back={back} />
        <Skeleton className="h-96 rounded-card" />
      </>
    );
  }

  const { po, vendor, lines, totals, plant } = data;
  const plantName = plant.legalName ?? plant.name;
  const dated = po.issuedAt ?? po.createdAt;
  const mark = po.status === "draft" ? t("store2.po.print.draftMark") : po.status === "cancelled" ? t("store2.po.print.cancelledMark") : null;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t("store2.po.print.title")}
        back={back}
        actions={
          <Button className="po-no-print" onClick={() => window.print()} data-testid="po-print">
            <Printer aria-hidden="true" className="size-4" />
            {t("common.print")}
          </Button>
        }
      />
      <article
        aria-label={t("store2.po.print.title")}
        className="po-paper mx-auto flex w-full max-w-[210mm] min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 text-[13px] sm:p-8"
        data-testid="po-paper"
      >
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="m-0 font-display text-[22px] leading-tight font-bold break-words">{plantName}</p>
            {plant.address ? <p className="m-0 whitespace-pre-line break-words">{plant.address}</p> : null}
            {plant.phone ? <p className="m-0">{t("store2.po.print.phone", { phone: plant.phone })}</p> : null}
            {plant.gstin ? <p className="m-0">{t("store2.po.print.gstin", { gstin: plant.gstin })}</p> : null}
          </div>
          <div className="text-right">
            <p className="m-0 text-[18px] font-bold uppercase">{t("store2.po.print.title")}</p>
            {mark ? <p className="m-0 font-semibold">{mark}</p> : null}
          </div>
        </header>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="m-0 text-muted-foreground">{t("store2.po.print.to")}</p>
            <p className="m-0 text-[15px] font-semibold break-words">{vendor?.name ?? ""}</p>
            {vendor?.city ? <p className="m-0 break-words">{vendor.city}</p> : null}
            {vendor?.phone ? <p className="m-0">{t("store2.po.print.phone", { phone: vendor.phone })}</p> : null}
            {vendor?.gstin ? <p className="m-0">{t("store2.po.print.gstin", { gstin: vendor.gstin })}</p> : null}
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t("store2.po.print.number")}</dt>
            <dd className="m-0 font-mono font-semibold">{po.number}</dd>
            <dt className="text-muted-foreground">{t("store2.po.print.date")}</dt>
            <dd className="m-0">{dateText(fmt, dated)}</dd>
            {po.deliveryDate ? (
              <>
                <dt className="text-muted-foreground">{t("store2.po.print.delivery")}</dt>
                <dd className="m-0">{bookDateText(fmt, po.deliveryDate)}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-border text-left">
              <th scope="col" className="px-2 py-2 font-semibold">{t("store2.po.print.sl")}</th>
              <th scope="col" className="px-2 py-2 font-semibold">{t("store2.po.print.item")}</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">{t("store2.po.print.qty")}</th>
              <th scope="col" className="px-2 py-2 font-semibold">{t("store2.po.print.unit")}</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">{t("store2.po.print.rate")}</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">{t("store2.po.print.gst")}</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">{t("store2.po.print.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-border align-top">
                <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                <td className="px-2 py-2 break-words">{l.itemName}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatQty(l.qtyMilli, l.unit, fmt)}</td>
                <td className="px-2 py-2">{unitShort(t, l.unit, l.qtyMilli, fmt)}</td>
                {/* Rates are per kg (or per piece...) whatever unit the plant prints weights in. */}
                <td className="px-2 py-2 text-right tabular-nums">{t("store2.money.perUnit", { rate: rupees(l.ratePaise), unit: unitShort(t, l.unit, 1000) })}</td>
                <td className="px-2 py-2 text-right tabular-nums">{bpText(l.gstBp)}%</td>
                <td className="px-2 py-2 text-right tabular-nums">{rupees(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="m-0 ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[14px] tabular-nums">
          <dt>{t("store2.po.print.totalsAmount")}</dt>
          <dd className="m-0 text-right">{rupees(totals.amountPaise)}</dd>
          <dt>{t("store2.po.print.totalsGst")}</dt>
          <dd className="m-0 text-right">{rupees(totals.gstPaise)}</dd>
          <dt className="font-bold">{t("store2.po.print.totalsTotal")}</dt>
          <dd className="m-0 text-right font-bold">{rupees(totals.totalPaise)}</dd>
        </dl>

        {po.terms ? (
          <section className="min-w-0">
            <p className="m-0 font-semibold">{t("store2.po.print.terms")}</p>
            <p className="m-0 whitespace-pre-wrap break-words">{po.terms}</p>
          </section>
        ) : null}

        <footer className="mt-10 flex min-w-0 flex-wrap items-end justify-between gap-6">
          <p className="m-0 text-muted-foreground">{t("store2.po.print.footer", { date: dateText(fmt, Date.now()) })}</p>
          <div className="min-w-[200px] text-center">
            <p className="m-0 font-semibold">{t("store2.po.print.forPlant", { plant: plantName })}</p>
            <div className="mt-12 border-t border-foreground pt-1">{t("store2.po.print.signature")}</div>
          </div>
        </footer>
      </article>
    </>
  );
}
