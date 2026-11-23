/** `/billing/outstanding`: what each customer owes, aged 0-30, 31-60, 61-90 and over 90 days, with a statement PDF per customer. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { downloadStatementPdf } from "@/shared/lib/exports";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { AGEING_BUCKETS, financialYearRange, shapeOutstanding } from "./model";
import { BillingTabs, Rupees, errorText, useToday } from "./ui";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function OutstandingPage() {
  const { t } = useT();
  const today = useToday();
  const fy = financialYearRange(today);
  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({ ...trpc.billing.receivables.outstanding.queryOptions({ asOf: YMD.test(asOf) ? asOf : undefined }), retry: false });
  const table = useMemo(() => shapeOutstanding(q.data?.rows ?? [], search), [q.data, search]);

  async function statement(customerId: string) {
    if (!YMD.test(from) || !YMD.test(to) || from > to) {
      toast.error(t("bill.outstanding.rangeBad"));
      return;
    }
    setBusy(customerId);
    try {
      const s = await trpcClient.billing.receivables.statement.query({ customerId, from, to });
      await downloadStatementPdf({
        customer: s.customer,
        plant: s.plant,
        from: s.from,
        to: s.to,
        openingPaise: s.openingPaise,
        lines: s.lines,
        debitPaise: s.debitPaise,
        creditPaise: s.creditPaise,
        closingPaise: s.closingPaise,
      });
    } catch (e) {
      toast.error(errorText(e, t("errors.generic")));
    } finally {
      setBusy(null);
    }
  }

  const th = "px-2 py-2 text-right font-medium whitespace-nowrap";
  return (
    <>
      <PageHeader title={t("bill.outstanding.title")} subtitle={t("bill.outstanding.subtitle")} back={{ to: "/billing", label: t("bill.title") }} />
      <BillingTabs current="outstanding" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("bill.outstanding.asOf")}>
          <TextInput type="date" value={asOf} onChangeText={setAsOf} />
        </Field>
        <Field label={t("bill.outstanding.statementFrom")}>
          <TextInput type="date" value={from} onChangeText={setFrom} />
        </Field>
        <Field label={t("bill.outstanding.statementTo")}>
          <TextInput type="date" value={to} onChangeText={setTo} />
        </Field>
        <Field label={t("bill.outstanding.search")}>
          <TextInput type="search" value={search} onChangeText={setSearch} />
        </Field>
      </div>

      {q.isPending ? (
        <Skeleton className="h-48 w-full rounded-card" />
      ) : q.isError ? (
        <EmptyState
          title={t("bill.outstanding.loadError")}
          action={
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : table.rows.length === 0 ? (
        <EmptyState title={t("bill.outstanding.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-card">
          <table className="w-full min-w-[860px] border-collapse text-[13px]" data-testid="outstanding-table">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">{t("bill.list.customer")}</th>
                {AGEING_BUCKETS.map((b) => (
                  <th key={b} className={th}>
                    {t(`bill.outstanding.buckets.${b}`)}
                  </th>
                ))}
                <th className={th}>{t("bill.outstanding.due")}</th>
                <th className={th}>{t("bill.outstanding.onAccount")}</th>
                <th className={th}>{t("bill.outstanding.balance")}</th>
                <th className="px-2 py-2">
                  <span className="sr-only">{t("bill.outstanding.statement")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.customerId} className="border-b border-border/60">
                  <td className="px-2 py-2 font-semibold">{r.customerName}</td>
                  {AGEING_BUCKETS.map((b) => (
                    <td key={b} className="px-2 py-2 text-right">
                      {r.buckets[b] ? <Rupees paise={r.buckets[b]} /> : <span className="text-muted-foreground">-</span>}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <Rupees paise={r.invoicesDuePaise} />
                  </td>
                  <td className="px-2 py-2 text-right">{r.onAccountPaise ? <Rupees paise={r.onAccountPaise} /> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-2 py-2 text-right font-semibold">
                    <Rupees paise={r.balancePaise} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button variant="secondary" size="sm" loading={busy === r.customerId} onClick={() => void statement(r.customerId)}>
                      <FileDown aria-hidden="true" strokeWidth={2} />
                      {t("bill.outstanding.statement")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="px-2 py-2">{t("bill.doc.total")}</td>
                {AGEING_BUCKETS.map((b) => (
                  <td key={b} className="px-2 py-2 text-right">
                    <Rupees paise={table.totals.buckets[b]} />
                  </td>
                ))}
                <td className="px-2 py-2 text-right">
                  <Rupees paise={table.totals.invoicesDuePaise} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Rupees paise={table.totals.onAccountPaise} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Rupees paise={table.totals.balancePaise} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
