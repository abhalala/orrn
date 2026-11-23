/** `/billing/payments`: payments received, newest first. Record one (against open invoices or on account) and void a wrong one. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { PaymentSheet } from "./payment-sheet";
import { ReasonDialog } from "./reason-dialog";
import { BillingTabs, Rupees, errorText } from "./ui";

export function PaymentsPage({ customerId, invoiceId }: { customerId?: string; invoiceId?: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(!!customerId);
  const [voiding, setVoiding] = useState<string | null>(null);
  const list = useQuery(trpc.billing.payments.list.queryOptions({ limit: 100 }));
  type Row = NonNullable<typeof list.data>[number];

  const voidIt = useMutation({
    ...trpc.billing.payments.void.mutationOptions(),
    onSuccess: async () => {
      setVoiding(null);
      await qc.invalidateQueries({ queryKey: trpc.billing.pathKey() });
      toast.success(t("bill.payments.voided"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("bill.payments.number"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.number}</span> },
    { key: "date", header: t("bill.payments.date"), cell: (r) => bookDateText(fmt, r.receivedOn) },
    { key: "customer", header: t("bill.list.customer"), cell: (r) => r.customerName },
    { key: "mode", header: t("bill.payments.mode"), hideOnPhone: true, cell: (r) => `${t(`bill.payments.modes.${r.mode}`)}${r.reference ? ` ${r.reference}` : ""}` },
    { key: "amount", header: t("bill.payments.amount"), align: "end", cell: (r) => <Rupees paise={r.amountPaise} /> },
    {
      key: "onAccount",
      header: t("bill.payments.onAccount"),
      align: "end",
      hideOnPhone: true,
      cell: (r) => <Rupees paise={Math.max(0, r.amountPaise - r.allocatedPaise)} />,
    },
    {
      key: "status",
      header: t("bill.list.status"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone={r.status === "active" ? "green" : "red"}>{t(r.status === "active" ? "bill.payments.active" : "bill.payments.void")}</Chip>
          {r.status === "active" ? (
            <Can do="payment.record">
              <Button variant="ghost" size="sm" onClick={() => setVoiding(r.id)}>
                {t("bill.payments.voidAction")}
              </Button>
            </Can>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("bill.payments.title")}
        subtitle={t("bill.payments.subtitle")}
        back={{ to: "/billing", label: t("bill.title") }}
        actions={
          <Can do="payment.record">
            <Button onClick={() => setRecording(true)} className="max-md:h-14 max-md:w-full max-md:text-[17px]">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("bill.payments.record")}
            </Button>
          </Can>
        }
      />
      <BillingTabs current="payments" />
      {list.isError && !list.data ? (
        <EmptyState
          title={t("bill.payments.loadError")}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <ResponsiveList<Row> label={t("bill.payments.title")} rows={list.data ?? []} rowKey={(r) => r.id} columns={columns} loading={list.isPending} empty={<EmptyState title={t("bill.payments.empty")} />} />
      )}
      <Can do="payment.record">
        <PaymentSheet open={recording} onOpenChange={setRecording} initial={customerId ? { customerId, invoiceId } : null} />
      </Can>
      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={t("bill.payments.voidTitle")}
        description={t("bill.payments.voidHint")}
        confirmLabel={t("bill.payments.voidAction")}
        danger
        pending={voidIt.isPending}
        onConfirm={(reason) => voiding && voidIt.mutate({ id: voiding, reason })}
      />
    </>
  );
}
