import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { downloadStockOnOrderPdf, downloadStockOnOrderXlsx, printStockOnOrder } from "@/shared/lib/exports";
import { trpc } from "@/shared/utils/trpc";

import { orderKgText, pcsText } from "../format";
import { useCompanyTimeZone } from "../hooks";

/**
 * Stock held on this order (FP-OP-19): the order's in-yard bundles by line with a total, from
 * `orders.stockOn` (the bundle's own line, not PO text), with Print, PDF and Excel made from that
 * snapshot in the browser. No rates.
 */
export function StockOnSheet({ open, onOpenChange, orderId, orderNumber }: { open: boolean; onOpenChange(open: boolean): void; orderId: string; orderNumber: string }) {
  const { t } = useT();
  const timeZone = useCompanyTimeZone();
  const data = useQuery({ ...trpc.orders.stockOn.queryOptions({ id: orderId }), enabled: open });
  const [busy, setBusy] = useState<"print" | "pdf" | "xlsx" | null>(null);

  async function run(kind: "print" | "pdf" | "xlsx") {
    if (!data.data) return;
    setBusy(kind);
    try {
      const snapshot = data.data;
      if (kind === "print") await printStockOnOrder(snapshot, { timeZone });
      else if (kind === "pdf") await downloadStockOnOrderPdf(snapshot, { timeZone });
      else await downloadStockOnOrderXlsx(snapshot, { timeZone });
    } catch (err) {
      console.error("stock on order export failed", err);
      toast.error(t("orders.stockOn.failed"));
    } finally {
      setBusy(null);
    }
  }

  const lines = (data.data?.lines ?? []).filter((l) => l.bundles.length > 0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("orders.stockOn.title", { number: orderNumber })} description={t("orders.stockOn.hint")}>
      <div className="flex min-w-0 flex-col gap-4" data-stock-on="">
        {data.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : data.isError ? (
          <div role="alert">
            <EmptyState title={t("errors.generic")} action={<Button variant="secondary" onClick={() => void data.refetch()}>{t("common.retry")}</Button>} />
          </div>
        ) : (
          <>
            <p className="m-0 font-mono text-[15px] font-semibold tabular-nums" data-stock-on-total="">
              {t("units.bundles", { count: data.data.total.bundles })} · {pcsText(data.data.total.pcs)} {t("units.pcs")} · {orderKgText(data.data.total.weightG)} {t("units.kg")}
            </p>
            {lines.length === 0 ? (
              <p className="m-0 text-[14px] text-muted-foreground" data-stock-on-empty="">
                {t("orders.stockOn.empty")}
              </p>
            ) : (
              lines.map((l) => (
                <section key={l.lineId} className="flex min-w-0 flex-col gap-1" data-stock-line={l.lineNo}>
                  <h3 className="m-0 text-[14px] font-semibold">
                    {t("orders.detail.lineShort", { n: l.lineNo })} · {l.sectionCode} {l.sectionName ?? l.series}
                  </h3>
                  <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                    {l.bundles.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                        <span className="font-mono text-[14px] font-semibold">{b.serial}</span>
                        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                          {b.copyCode ? `${b.copyCode} · ` : ""}
                          {pcsText(b.pcs)} {t("units.pcs")} · {orderKgText(b.weightG)} {t("units.kg")}
                          {b.yard ? ` · ${b.yard}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
            {data.data.truncated ? <p className="m-0 text-[13px] text-muted-foreground">{t("orders.stockOn.cut")}</p> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button variant="secondary" loading={busy === "print"} disabled={busy !== null} onClick={() => void run("print")} data-stock-print="">
                <Printer aria-hidden="true" strokeWidth={2} />
                {t("orders.stockOn.print")}
              </Button>
              <Button variant="secondary" loading={busy === "pdf"} disabled={busy !== null} onClick={() => void run("pdf")} data-stock-pdf="">
                <FileDown aria-hidden="true" strokeWidth={2} />
                {t("orders.stockOn.pdf")}
              </Button>
              <Button variant="secondary" loading={busy === "xlsx"} disabled={busy !== null} onClick={() => void run("xlsx")} data-stock-xlsx="">
                <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
                {t("orders.stockOn.excel")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
