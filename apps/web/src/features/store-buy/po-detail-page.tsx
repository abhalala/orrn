import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Printer, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { qtyText, unitShort } from "@/features/store/store-labels";
import { StoreLoadError, StoreNote, StoreSection } from "@/features/store/store-ui";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText, whenText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { bpText, rupees } from "./money";
import { poActions, poTone, type PoStatus } from "./po-model";
import { useBuyAccess, useInvalidateBuy, type PoDetail } from "./use-buy";

type Line = PoDetail["lines"][number];
type Grn = PoDetail["grns"][number];
type Ask = "send" | "close" | "cancel" | null;

/** One purchase order: header, lines with what came in, totals, the GRNs against it, and the actions its status allows. */
export function PoDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const access = useBuyAccess();
  const invalidate = useInvalidateBuy();
  const query = useQuery({ ...trpc.store.po.get.queryOptions({ id }), enabled: access.readOrders, meta: INLINE_ERROR_META });
  const [ask, setAsk] = useState<Ask>(null);
  const [text, setText] = useState("");
  const [textProblem, setTextProblem] = useState(false);

  const issue = useMutation(trpc.store.po.issue.mutationOptions());
  const close = useMutation(trpc.store.po.close.mutationOptions());
  const cancel = useMutation(trpc.store.po.cancel.mutationOptions());
  const busy = issue.isPending || close.isPending || cancel.isPending;
  const error = ask === "send" ? issue.error : ask === "close" ? close.error : ask === "cancel" ? cancel.error : null;

  const back = { to: "/store/buy?tab=orders", label: t("store2.po.detail.back") };

  if (!access.readOrders) {
    return (
      <>
        <PageHeader title={t("store2.po.list.label")} back={back} />
        <StoreNote body={t("store2.po.detail.noAccess")} />
      </>
    );
  }
  if (showsQueryError(query)) {
    const notFound = (query.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("store2.po.list.label")} back={back} />
        {notFound ? <EmptyState title={t("store2.po.detail.notFound")} /> : <StoreLoadError onRetry={() => void query.refetch()} />}
      </>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <>
        <PageHeader title={t("store2.po.list.label")} back={back} />
        <Skeleton className="h-64 rounded-card" />
      </>
    );
  }

  const { po, lines, totals, grns } = data;
  const receivedAny = lines.some((l) => l.receivedMilli > 0);
  const actions = poActions(po.status, receivedAny, access.manageOrders);
  const status = po.status as PoStatus;

  const open = (what: Exclude<Ask, null>) => {
    issue.reset();
    close.reset();
    cancel.reset();
    setText("");
    setTextProblem(false);
    setAsk(what);
  };
  const done = async (key: "send.done" | "close.done" | "cancel.done") => {
    toast.success(t(`store2.po.${key}`, { number: po.number }));
    await invalidate();
    setAsk(null);
  };
  const confirm = async () => {
    if (busy || !ask) return;
    try {
      if (ask === "send") {
        await issue.mutateAsync({ id });
        await done("send.done");
        return;
      }
      if (!text.trim()) {
        setTextProblem(true);
        return;
      }
      if (ask === "close") {
        await close.mutateAsync({ id, note: text.trim() });
        await done("close.done");
      } else {
        await cancel.mutateAsync({ id, reason: text.trim() });
        await done("cancel.done");
      }
    } catch {
      // Shown in the dialog (error).
    }
  };

  const lineColumns: ResponsiveListColumn<Line>[] = [
    { key: "item", header: t("store2.po.detail.item"), cell: (l) => l.itemName },
    { key: "ordered", header: t("store2.po.detail.ordered"), align: "end", cell: (l) => qtyText(t, l.qtyMilli, l.unit, fmt) },
    { key: "received", header: t("store2.po.detail.received"), align: "end", cell: (l) => qtyText(t, l.receivedMilli, l.unit, fmt) },
    {
      key: "rate",
      header: t("store2.po.detail.rate"),
      align: "end",
      cell: (l) => (l.ratePaise > 0 ? t("store2.money.perUnit", { rate: rupees(l.ratePaise), unit: unitShort(t, l.unit, 1000) }) : t("store2.money.noRate")),
    },
    { key: "gst", header: t("store2.po.detail.gst"), align: "end", hideOnPhone: true, cell: (l) => `${bpText(l.gstBp)}%` },
    { key: "total", header: t("store2.po.detail.total"), align: "end", cell: (l) => rupees(l.totalPaise) },
  ];

  const grnColumns: ResponsiveListColumn<Grn>[] = [
    { key: "number", header: t("store2.po.detail.grnNumber"), cell: (g) => <span className="font-mono whitespace-nowrap">{g.number ?? g.grnRef ?? "-"}</span> },
    {
      key: "qty",
      header: t("store2.po.detail.grnQty"),
      align: "end",
      cell: (g) => {
        const l = lines.find((x) => x.id === g.poLineId);
        return l ? qtyText(t, g.qtyMilli, l.unit, fmt) : "";
      },
    },
    {
      key: "rejected",
      header: t("store2.po.detail.grnRejected"),
      align: "end",
      hideOnPhone: true,
      cell: (g) => {
        const l = lines.find((x) => x.id === g.poLineId);
        return l && g.rejectedMilli ? qtyText(t, g.rejectedMilli, l.unit, fmt) : "-";
      },
    },
    {
      key: "status",
      header: t("store2.po.detail.grnStatus"),
      phoneWide: true,
      cell: (g) => (
        <Chip tone={g.cancelledAt ? "red" : "green"} truncate={false}>
          {g.cancelledAt ? t("store2.po.detail.grnCancelled") : t("store2.po.detail.grnLive")}
        </Chip>
      ),
    },
  ];

  const facts: { k: string; v: string }[] = [
    { k: t("store2.po.detail.delivery"), v: po.deliveryDate ? bookDateText(fmt, po.deliveryDate) : t("store2.po.list.noDate") },
    { k: t("store2.po.detail.createdAt"), v: whenText(fmt, po.createdAt) },
    ...(po.issuedAt ? [{ k: t("store2.po.detail.sentAt"), v: whenText(fmt, po.issuedAt) }] : []),
  ];

  return (
    <>
      <PageHeader
        back={back}
        title={t("store2.po.detail.title", { number: po.number })}
        subtitle={data.vendor?.name}
        actions={
          <>
            {actions.edit ? (
              <Button asChild variant="secondary">
                <Link to="/store/po/$id/edit" params={{ id }}>
                  <Pencil aria-hidden="true" strokeWidth={2} />
                  {t("store2.po.action.edit")}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link to="/store/po/$id/print" params={{ id }}>
                <Printer aria-hidden="true" strokeWidth={2} />
                {t("store2.po.action.print")}
              </Link>
            </Button>
            {actions.cancel ? (
              <Button variant="secondary" onClick={() => open("cancel")} aria-haspopup="dialog">
                {t("store2.po.action.cancel")}
              </Button>
            ) : null}
            {actions.closeShort ? (
              <Button variant="secondary" onClick={() => open("close")} aria-haspopup="dialog">
                {t("store2.po.action.closeShort")}
              </Button>
            ) : null}
            {actions.send ? (
              <Button onClick={() => open("send")} aria-haspopup="dialog">
                <Send aria-hidden="true" strokeWidth={2} />
                {t("store2.po.action.send")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Chip tone={poTone(status)} truncate={false}>
              {t(`store2.status.po.${status}`)}
            </Chip>
            {data.vendor?.gstin ? <span className="text-[14px] text-muted-foreground">{t("store2.po.detail.gstin", { gstin: data.vendor.gstin })}</span> : null}
            {data.indent ? (
              <Link to="/store/buy" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
                {t("store2.po.detail.indent", { number: data.indent.number })}
              </Link>
            ) : null}
          </div>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.k} className="min-w-0">
                <dt className="text-[13px] text-muted-foreground">{f.k}</dt>
                <dd className="m-0 text-[15px] font-semibold break-words">{f.v}</dd>
              </div>
            ))}
          </dl>
          {po.terms ? (
            <div className="min-w-0">
              <p className="m-0 text-[13px] text-muted-foreground">{t("store2.po.detail.terms")}</p>
              <p className="m-0 text-[15px] whitespace-pre-wrap break-words">{po.terms}</p>
            </div>
          ) : null}
          {po.note ? (
            <div className="min-w-0">
              <p className="m-0 text-[13px] text-muted-foreground">{t("store2.po.detail.note")}</p>
              <p className="m-0 text-[15px] whitespace-pre-wrap break-words">{po.note}</p>
            </div>
          ) : null}
          {po.status === "closed" && po.closeNote ? <p className="m-0 text-[14px] break-words">{t("store2.po.detail.closeNote", { note: po.closeNote })}</p> : null}
          {po.status === "cancelled" && po.cancelReason ? <p className="m-0 text-[14px] break-words">{t("store2.po.detail.cancelReason", { reason: po.cancelReason })}</p> : null}
        </div>

        <StoreSection id="po-lines" title={t("store2.po.detail.lines")}>
          <ResponsiveList<Line> label={t("store2.po.detail.lines")} rows={lines} columns={lineColumns} rowKey={(l) => l.id} empty={<EmptyState title={t("store2.po.form.noLines")} />} />
          <dl className="m-0 ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[15px] tabular-nums">
            <dt className="text-muted-foreground">{t("store2.po.detail.totalsAmount")}</dt>
            <dd className="m-0 text-right">{rupees(totals.amountPaise)}</dd>
            <dt className="text-muted-foreground">{t("store2.po.detail.totalsGst")}</dt>
            <dd className="m-0 text-right">{rupees(totals.gstPaise)}</dd>
            <dt className="font-bold">{t("store2.po.detail.totalsTotal")}</dt>
            <dd className="m-0 text-right font-bold">{rupees(totals.totalPaise)}</dd>
          </dl>
        </StoreSection>

        <StoreSection id="po-grns" title={t("store2.po.detail.grns")}>
          <ResponsiveList<Grn> label={t("store2.po.detail.grns")} rows={grns} columns={grnColumns} rowKey={(g) => g.id} empty={<EmptyState title={t("store2.po.detail.noGrns")} />} />
        </StoreSection>
      </div>

      <Dialog
        open={ask !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setAsk(null);
        }}
        title={ask ? t(`store2.po.${ask}.title`, { number: po.number }) : undefined}
        description={ask ? t(`store2.po.${ask}.body`) : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsk(null)} disabled={busy}>
              {ask === "close" ? t("store2.po.close.keep") : ask === "cancel" ? t("store2.po.cancel.keep") : t("common.cancel")}
            </Button>
            <Button variant={ask === "send" ? "primary" : "danger"} onClick={() => void confirm()} loading={busy}>
              {ask ? t(`store2.po.${ask}.confirm`) : ""}
            </Button>
          </>
        }
      >
        {ask === "close" || ask === "cancel" ? (
          <Field
            label={ask === "close" ? t("store2.po.close.note") : t("store2.po.cancel.reason")}
            hint={ask === "close" ? t("store2.po.close.noteHint") : t("store2.po.cancel.reasonHint")}
            error={textProblem ? (ask === "close" ? t("store2.po.close.noteRequired") : t("store2.po.cancel.reasonRequired")) : undefined}
            required
          >
            <FieldTextArea
              value={text}
              rows={3}
              maxLength={500}
              onChangeText={(v) => {
                setText(v);
                if (v.trim()) setTextProblem(false);
              }}
            />
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {buyErrorText(t, error)}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
