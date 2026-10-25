import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { FileSpreadsheet, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { downloadOrderBookXlsx, downloadOrderSheetXlsx, downloadPlanSheetXlsx, printOrderSheet, printPlanSheet, type OrderBookExportRow } from "@/shared/lib/exports";
import { trpcClient } from "@/shared/utils/trpc";

import { useCompanyTimeZone } from "../hooks";
import { BOOK_EXPORT_MAX, orderBookRowOf, orderSheetInputOf, planSheetInputOf, type OrderGet, type PlanGet } from "../print-model";

type Busy = "print" | "xlsx" | null;

function useRun() {
  const { t } = useT();
  const [busy, setBusy] = useState<Busy>(null);
  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      console.error("order print or export failed", err);
      toast.error(t("orders.printOut.failed"));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** FP-OP-19: print the sales order, or take it to Excel (the rate only when the server sent it). */
export function OrderPrintButtons({ data }: { data: OrderGet }) {
  const { t } = useT();
  const { data: me } = useMe();
  const { busy, run } = useRun();
  const input = () => orderSheetInputOf(data, me?.company?.name ?? null);
  return (
    <>
      <Button variant="secondary" loading={busy === "print"} onClick={() => void run("print", () => printOrderSheet(input()))} data-order-print="">
        <Printer aria-hidden="true" strokeWidth={2} />
        {t("orders.printOut.order")}
      </Button>
      <Button variant="secondary" loading={busy === "xlsx"} onClick={() => void run("xlsx", () => downloadOrderSheetXlsx(input()))} data-order-excel="">
        <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
        {t("orders.printOut.orderExcel")}
      </Button>
    </>
  );
}

/** FP-OP-19: the plan's shift die list for the press desk (no rate), printed or in Excel. */
export function PlanPrintButtons({ data, pressLine }: { data: PlanGet; pressLine: string | null }) {
  const { t } = useT();
  const { data: me } = useMe();
  const timeZone = useCompanyTimeZone();
  const { busy, run } = useRun();
  const input = () => planSheetInputOf(data, me?.company?.name ?? null, pressLine);
  return (
    <>
      <Button variant="secondary" loading={busy === "print"} onClick={() => void run("print", () => printPlanSheet(input(), { timeZone }))} data-plan-print="">
        <Printer aria-hidden="true" strokeWidth={2} />
        {t("orders.printOut.plan")}
      </Button>
      <Button variant="secondary" loading={busy === "xlsx"} onClick={() => void run("xlsx", () => downloadPlanSheetXlsx(input(), { timeZone }))} data-plan-excel="">
        <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
        {t("orders.printOut.planExcel")}
      </Button>
    </>
  );
}

/**
 * FP-OP-19: the order book of the current filter in Excel (no rate). Reads `orders.list` a page of
 * 100 at a time, up to `BOOK_EXPORT_MAX` orders; the file says so when the book is longer.
 */
export function BookExportButton({ input }: { input: Omit<Parameters<typeof trpcClient.orders.list.query>[0], "limit" | "offset"> }) {
  const { t } = useT();
  const { busy, run } = useRun();
  const exportBook = async () => {
    const rows: OrderBookExportRow[] = [];
    let offset: number | null = 0;
    while (offset !== null && rows.length < BOOK_EXPORT_MAX) {
      const page: Awaited<ReturnType<typeof trpcClient.orders.list.query>> = await trpcClient.orders.list.query({ ...input, limit: 100, offset });
      rows.push(...page.items.map(orderBookRowOf));
      offset = page.nextOffset;
    }
    const kept = rows.slice(0, BOOK_EXPORT_MAX);
    await downloadOrderBookXlsx(kept, new Date().toISOString().slice(0, 10));
    if (offset !== null) toast.message(t("orders.printOut.bookCut", { count: kept.length }));
  };
  return (
    <Button variant="secondary" loading={busy === "xlsx"} onClick={() => void run("xlsx", exportBook)} data-book-export="">
      <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
      {busy === "xlsx" ? t("orders.printOut.bookBusy") : t("orders.printOut.book")}
    </Button>
  );
}
