import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { countText, kgGrouped3, massUnit, rateText, rupeeText } from "@/shared/lib/fmt-text";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { BreakupView } from "./breakup-view";
import { finishCell, quoteShownStatus } from "./docs-model";
import { nextLineKey, QuoteForm } from "./quote-form";
import { draftFromQuoteLine } from "./quote-model";
import { usePrintQuote } from "./quote-print";
import { CancelQuoteSheet, ConvertQuoteSheet } from "./quote-sheets";
import { MakeProformaButton, ProformaList } from "./proforma-panel";
import { useInvalidateDocs } from "./use-docs";

const TONE = { draft: "neutral", sent: "blue", converted: "green", cancelled: "red", expired: "amber" } as const;

/** `/pricing/quotes/$id`: the quote, its lines with rate, amount and breakdown, and what can be done with it. */
export function QuoteDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const { unit } = useLengthUnit();
  const get = useQuery(trpc.pricing.quotes.get.queryOptions({ id }));
  const invalidate = useInvalidateDocs();
  const print = usePrintQuote();
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const send = useMutation({
    mutationFn: () => trpcClient.pricing.quotes.setStatus.mutate({ id, status: "sent" }),
    onSuccess: async () => {
      toast.success(t("price.quotes.detail.sentDone"));
      await Promise.all([invalidate.quotes()]);
    },
    onError: (e) => toast.error(serverRefusal(t, e)),
  });

  if (get.isPending) {
    return (
      <>
        <PageHeader title={t("price.quotes.title")} back={{ to: "/pricing/quotes", label: t("price.quotes.title") }} />
        <Skeleton className="h-40 w-full" />
      </>
    );
  }
  if (get.isError || !get.data) {
    return (
      <>
        <PageHeader title={t("price.quotes.title")} back={{ to: "/pricing/quotes", label: t("price.quotes.title") }} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState title={t("price.quotes.loadFailed")} action={<Button onClick={() => void get.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }
  const data = get.data;
  const q = data.quote;
  const shown = quoteShownStatus({ status: q.status, expired: q.expired });
  const open = q.status === "draft" || q.status === "sent";

  if (editing && q.status === "draft") {
    return (
      <>
        <PageHeader title={t("price.quotes.detail.editTitle", { number: q.number })} back={{ to: "/pricing/quotes", label: t("price.quotes.title") }} />
        <QuoteForm
          initial={{
            quote: { id: q.id, serverSeq: q.serverSeq, quoteDate: q.quoteDate, validUntil: q.validUntil },
            customer: { id: data.customer.id, label: data.customer.name },
            note: q.note ?? "",
            lines: data.lines.map((l) => draftFromQuoteLine(nextLineKey(), l, unit)),
          }}
        />
        <div>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </>
    );
  }

  const doPrint = async () => {
    setPrinting(true);
    try {
      await print(data);
    } catch {
      toast.error(t("price.quotes.detail.printFailed"));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={q.number}
        subtitle={[data.customer.name, t("price.quotes.detail.validUntilOn", { date: fmt.day(q.validUntil) })].join(" · ")}
        back={{ to: "/pricing/quotes", label: t("price.quotes.title") }}
        actions={
          <>
            <Button variant="secondary" loading={printing} onClick={() => void doPrint()} data-quote-print="">
              <Printer aria-hidden="true" strokeWidth={2} />
              {t("price.quotes.detail.print")}
            </Button>
            <Can do="quote.manage">
              {q.status === "draft" ? (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" strokeWidth={2} />
                  {t("common.edit")}
                </Button>
              ) : null}
              {q.status === "draft" ? (
                <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate()}>
                  {t("price.quotes.detail.markSent")}
                </Button>
              ) : null}
              {open && !q.expired ? (
                <Can do="order.manage">
                  <Button size="lg" onClick={() => setConvertOpen(true)} aria-haspopup="dialog" data-quote-convert="">
                    {t("price.quotes.detail.convert")}
                  </Button>
                </Can>
              ) : null}
              {open ? (
                <Button variant="ghost" onClick={() => setCancelOpen(true)} aria-haspopup="dialog">
                  {t("price.quotes.detail.cancelQuote")}
                </Button>
              ) : null}
            </Can>
          </>
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={TONE[shown]} truncate={false}>
            {t(`price.quotes.status.${shown}`)}
          </Chip>
          <span className="text-[14px] text-muted-foreground">{t("price.quotes.detail.dated", { date: fmt.day(q.quoteDate) })}</span>
          {data.order ? (
            <Link to="/orders/$id" params={{ id: data.order.id }} className="text-[14px] font-semibold underline">
              {t("price.quotes.detail.order", { number: data.order.number })}
            </Link>
          ) : null}
          {q.status === "converted" && !data.order ? <span className="text-[14px] text-muted-foreground">{t("price.quotes.status.converted")}</span> : null}
        </div>
        {q.note ? <p className="m-0 max-w-[68ch] text-[15px] leading-6">{q.note}</p> : null}

        <section aria-label={t("price.quotes.detail.lines")} className="flex min-w-0 flex-col gap-3">
          {data.lines.map((l) => (
            <article key={l.id} data-quote-line-row={l.lineNo} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-[15px] font-semibold">{t("price.quotes.detail.lineTitle", { n: l.lineNo, section: [l.sectionCode, l.sectionName].filter(Boolean).join(" ") })}</h3>
                <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">{rupeeText(fmt, l.amountPaise)}</p>
              </header>
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">
                {[
                  fmt.q("bundle.length", l.cutLengthMm),
                  `${kgGrouped3(fmt, l.kgG)} ${massUnit(fmt)}`,
                  l.pcs != null ? `${countText(fmt, l.pcs)} ${t("units.pcs")}` : null,
                  [l.alloy, l.temper].filter(Boolean).join(" ") || null,
                  l.finish ? finishCell(l.finish, t) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="m-0 font-mono text-[14px] tabular-nums">{t("price.quotes.form.lineRate", { rate: rateText(fmt, l.ratePaise) })}</p>
              {l.note ? <p className="m-0 text-[14px]">{l.note}</p> : null}
              {l.priceBreakup ? (
                <details>
                  <summary className="min-h-11 cursor-pointer text-[14px] font-semibold leading-[44px]">{t("price.quotes.form.breakup")}</summary>
                  <BreakupView breakup={l.priceBreakup} />
                </details>
              ) : null}
            </article>
          ))}
        </section>

        <p data-quote-detail-total="" className="m-0 text-right font-mono text-[16px] font-semibold tabular-nums">
          {t("price.quotes.detail.total", { amount: rupeeText(fmt, data.totals.totalPaise) })}
        </p>

        {q.status !== "cancelled" ? <ProformaPanelBlock id={q.id} /> : null}
      </div>
      <CancelQuoteSheet open={cancelOpen} onOpenChange={setCancelOpen} quoteId={q.id} number={q.number} />
      <ConvertQuoteSheet open={convertOpen} onOpenChange={setConvertOpen} quoteId={q.id} number={q.number} />
    </>
  );
}

function ProformaPanelBlock({ id }: { id: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <MakeProformaButton source={{ source: "quote", id }} />
      </div>
      <ProformaList source={{ source: "quote", id }} />
    </div>
  );
}
