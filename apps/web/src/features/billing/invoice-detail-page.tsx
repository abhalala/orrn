/**
 * `/billing/$id`: one invoice or credit note. A draft can be issued or discarded; an issued invoice shows what was paid
 * against it, can be cancelled by asking (an approval), and takes a credit note. The IRN and e-way bill panels sit
 * under it when the document needs them.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { downloadInvoicePdf } from "@/shared/lib/exports";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText, instantText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { CreditNoteSheet } from "./credit-note-sheet";
import { EwbPanel, IrnPanel } from "./einvoice-panels";
import { docActions } from "./model";
import { InvoicePreview } from "./preview";
import { ReasonDialog } from "./reason-dialog";
import { Rupees, StatusChip, errorText } from "./ui";

export function InvoiceDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery(trpc.billing.invoices.get.queryOptions({ id }));
  const [discardOpen, setDiscardOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: trpc.billing.invoices.get.queryKey({ id }) }),
      qc.invalidateQueries({ queryKey: trpc.billing.invoices.list.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.billing.invoices.billable.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.billing.receivables.outstanding.queryKey() }),
    ]);
  };

  const issue = useMutation({
    ...trpc.billing.invoices.issue.mutationOptions(),
    onSuccess: async () => {
      setIssueOpen(false);
      await refresh();
      toast.success(t("bill.detail.issued"));
    },
    onError: (e) => {
      setIssueOpen(false);
      toast.error(errorText(e, t("errors.generic")));
    },
  });
  const discard = useMutation({
    ...trpc.billing.invoices.discard.mutationOptions(),
    onSuccess: async () => {
      setDiscardOpen(false);
      await refresh();
      toast.success(t("bill.detail.discarded"));
      await navigate({ to: "/billing" });
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });
  const askCancel = useMutation({
    ...trpc.billing.invoices.requestCancel.mutationOptions(),
    onSuccess: async () => {
      setCancelOpen(false);
      await refresh();
      toast.success(t("bill.detail.cancelAsked"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  if (q.isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (q.isError || !q.data) {
    return (
      <>
        <PageHeader title={t("bill.title")} back={{ to: "/billing", label: t("bill.title") }} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("bill.detail.loadError")}
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

  const d = q.data;
  const a = docActions({ kind: d.kind, status: d.status, needsIrn: d.needsIrn, irnStatus: d.irn.status, hasIrn: !!d.irn.irn, ewbStatus: d.ewb.status, cancelPendingApprovalId: d.cancel.pendingApprovalId, irnWindowClosed: d.cancel.irnWindowClosed });
  const credit = d.kind === "credit_note";
  const title = d.number ?? t(credit ? "bill.detail.draftCredit" : "bill.detail.draftInvoice");

  async function pdf() {
    setDownloading(true);
    try {
      await downloadInvoicePdf({ kind: d.kind, status: d.status, number: d.number, invoiceDate: d.invoiceDate, noteReason: d.noteReason, reason: d.reason, snapshot: d.snapshot, irn: { irn: d.irn.irn, ackNo: d.irn.ackNo, ackDt: d.irn.ackDt, signedQrCode: d.irn.signedQrCode } });
    } catch {
      toast.error(t("bill.detail.pdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  const facts: [string, string | null][] = [
    [t("bill.list.date"), d.invoiceDate ? bookDateText(fmt, d.invoiceDate) : null],
    [t("bill.list.customer"), d.snapshot.party.name],
    [t("bill.detail.packingLists"), d.snapshot.sources.map((s) => s.plCode).join(", ") || null],
    [t("bill.detail.poNumbers"), d.snapshot.poNumbers.join(", ") || null],
    [t("bill.detail.vehicle"), d.snapshot.vehicleNo],
  ];

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t(credit ? "bill.kind.credit_note" : "bill.kind.invoice")}
        back={{ to: "/billing", label: t("bill.title") }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={d.status} kind={d.kind} />
            <Button variant="secondary" loading={downloading} onClick={() => void pdf()}>
              <FileDown aria-hidden="true" strokeWidth={2} />
              {t("bill.detail.pdf")}
            </Button>
          </div>
        }
      />

      {d.status === "irn_pending" ? (
        <div role="status" className="rounded-card border border-border bg-card p-3 text-[14px] font-semibold">
          {t("bill.status.irn_pending")}
        </div>
      ) : null}
      {d.status === "cancelled" ? (
        <div role="status" className="rounded-card border border-border bg-card p-3 text-[14px]">
          {t("bill.detail.cancelledOn", { when: d.cancel.at ? instantText(fmt, d.cancel.at) : "", reason: d.cancel.reason ?? "" })}
        </div>
      ) : null}
      {a.cancelPending ? <div role="status" className="rounded-card border border-border bg-card p-3 text-[14px]">{t("bill.detail.cancelWaiting")}</div> : null}
      {a.cancelAtIrp ? <div role="status" className="rounded-card border border-border bg-card p-3 text-[14px]">{t("bill.detail.cancelAtIrp")}</div> : null}
      {a.creditNoteOnly ? <div role="status" className="rounded-card border border-border bg-card p-3 text-[14px]">{t("bill.detail.creditNoteOnly")}</div> : null}

      <dl className="m-0 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2 lg:grid-cols-3">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="m-0 font-semibold">{v}</dd>
            </div>
          ))}
        {d.snapshot.against ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("bill.detail.against")}</dt>
            <dd className="m-0 font-semibold">
              {d.againstInvoiceId ? (
                <Link to="/billing/$id" params={{ id: d.againstInvoiceId }} className="underline">
                  {d.snapshot.against.number}
                </Link>
              ) : (
                d.snapshot.against.number
              )}
            </dd>
          </div>
        ) : null}
        {credit && d.noteReason ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("bill.credit.reason")}</dt>
            <dd className="m-0 font-semibold">{t(`bill.credit.reasons.${d.noteReason}`)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        {a.issue ? (
          <Can do="invoice.issue">
            <Button onClick={() => setIssueOpen(true)}>{t("bill.detail.issue")}</Button>
          </Can>
        ) : null}
        {a.discard ? (
          <Can do="invoice.issue">
            <Button variant="danger" onClick={() => setDiscardOpen(true)}>
              {t("bill.detail.discard")}
            </Button>
          </Can>
        ) : null}
        {a.creditNote ? (
          <Can do="invoice.issue">
            <Button variant="secondary" onClick={() => setCreditOpen(true)}>
              {t("bill.detail.creditNote")}
            </Button>
          </Can>
        ) : null}
        {a.payment ? (
          <Can do="payment.record">
            <Button asChild variant="secondary">
              <Link to="/billing/payments" search={{ customerId: d.customerId, invoiceId: d.id }}>
                {t("bill.detail.recordPayment")}
              </Link>
            </Button>
          </Can>
        ) : null}
        {a.askCancel ? (
          <Can do="invoice.cancel">
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              {t("bill.detail.askCancel")}
            </Button>
          </Can>
        ) : null}
      </div>

      <InvoicePreview snapshot={d.snapshot} />

      {a.payment || d.allocations.length > 0 ? (
        <section aria-labelledby="bill-paid" className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
          <h2 id="bill-paid" className="m-0 text-[15px] font-semibold">
            {t("bill.detail.payments")}
          </h2>
          <dl className="m-0 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[14px]">
            <dt>{t("bill.detail.paid")}</dt>
            <dd className="m-0 text-right">
              <Rupees paise={d.paidPaise} />
            </dd>
            {d.creditedPaise > 0 ? (
              <>
                <dt>{t("bill.detail.credited")}</dt>
                <dd className="m-0 text-right">
                  <Rupees paise={d.creditedPaise} />
                </dd>
              </>
            ) : null}
            <dt className="font-semibold">{t("bill.detail.due")}</dt>
            <dd className="m-0 text-right font-semibold">
              <Rupees paise={d.outstandingPaise} />
            </dd>
          </dl>
          {d.allocations.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {d.allocations.map((p) => (
                <li key={p.paymentId} className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1">
                  <span className="font-mono">{p.number}</span>
                  <span>{bookDateText(fmt, p.receivedOn)}</span>
                  <span>{t(`bill.payments.modes.${p.mode}`)}</span>
                  <Rupees paise={p.amountPaise} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {d.credits.length > 0 ? (
        <section aria-labelledby="bill-credits" className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
          <h2 id="bill-credits" className="m-0 text-[15px] font-semibold">
            {t("bill.detail.credits")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {d.credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1">
                <Link to="/billing/$id" params={{ id: c.id }} className="font-mono underline">
                  {c.number ?? t("bill.list.notNumbered")}
                </Link>
                <StatusChip status={c.status} kind="credit_note" />
                <Rupees paise={c.totalPaise} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {a.irnPanel ? <IrnPanel doc={d} actions={a} /> : null}
      {a.ewbPanel || d.ewb.status !== "none" || a.ewbFile ? <EwbPanel doc={d} actions={a} /> : null}

      <Dialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title={t("bill.detail.issueTitle")}
        description={t(credit ? "bill.detail.issueCreditHint" : "bill.detail.issueHint")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setIssueOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button loading={issue.isPending} onClick={() => issue.mutate({ id })}>
              {t("bill.detail.issue")}
            </Button>
          </>
        }
      />
      <Dialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("bill.detail.discardTitle")}
        description={t("bill.detail.discardHint")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={discard.isPending} onClick={() => discard.mutate({ id })}>
              {t("bill.detail.discard")}
            </Button>
          </>
        }
      />
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("bill.detail.askCancel")}
        description={t("bill.detail.askCancelHint")}
        confirmLabel={t("bill.detail.sendAsk")}
        danger
        pending={askCancel.isPending}
        onConfirm={(reason) => askCancel.mutate({ id, reason })}
      />
      <CreditNoteSheet invoiceId={id} open={creditOpen} onOpenChange={setCreditOpen} />
    </>
  );
}
