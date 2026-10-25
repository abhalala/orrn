import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import type { OrderBookExportRow, OrderSheetInput, PlanSheetInput } from "@/shared/lib/exports";

/**
 * FP-OP-19 print and export (W4-NEXTROWS): the server answers shaped into the document inputs.
 * Pure, so the mapping is unit-tested. The rate goes through only when the server sent it
 * (`order.price` with `priceOnSalesOrder` on); the shift list and the order book never carry one.
 */
type Outputs = inferRouterOutputs<AppRouter>;
export type OrderGet = Outputs["orders"]["get"];
export type PlanGet = Outputs["plans"]["get"];
export type BookItem = Outputs["orders"]["list"]["items"][number];

/** "12170-2", "Tier 1 or better" or "" (the die room picks); English like the rest of the paper. */
export function copyText(d: { copyCode?: string | null; dieInstanceId: string | null; tierRank: number | null } | undefined): string {
  if (!d) return "";
  if (d.dieInstanceId) return d.copyCode ?? "";
  if (d.tierRank != null) return `Tier ${d.tierRank} or better`;
  return "";
}

export function orderSheetInputOf(data: OrderGet, companyName: string | null): OrderSheetInput {
  const details = new Map(data.lineDetails.map((d) => [d.lineId, d]));
  return {
    companyName,
    order: {
      number: data.order.number,
      poNumber: data.order.poNumber,
      orderDate: data.order.orderDate,
      expectedDate: data.order.expectedDate,
      customerName: data.order.customerName,
      customerGstin: data.order.customerGstin,
      status: data.order.status,
      note: data.order.note,
    },
    lines: data.lines.map((l) => {
      const d = details.get(l.lineId);
      return {
        lineNo: l.lineNo,
        sectionCode: l.sectionCode,
        series: l.series,
        sectionName: l.sectionName,
        cutLengthMm: l.cutLengthMm,
        copy: copyText(d),
        alloy: d?.alloy ?? null,
        temper: d?.temper ?? null,
        finish: l.finish,
        orderedPcs: l.orderedPcs,
        orderedG: l.orderedG,
        dispatchedG: l.dispatchedG,
        bakiG: l.bakiG,
        note: l.note,
        ...(d && "ratePaise" in d ? { ratePaise: (d as { ratePaise: number | null }).ratePaise } : {}),
      };
    }),
  };
}

export function planSheetInputOf(data: PlanGet, companyName: string | null, pressLine: string | null): PlanSheetInput {
  return {
    companyName,
    plan: {
      number: data.plan.number,
      status: data.plan.status,
      purpose: data.plan.purpose,
      pressLine,
      windowStart: new Date(data.plan.windowStart).getTime(),
      windowEnd: new Date(data.plan.windowEnd).getTime(),
      note: data.plan.note,
    },
    dies: data.dies.map((d) => ({
      sectionCode: d.sectionCode,
      sectionName: d.sectionName,
      urgent: d.urgent,
      lines: data.lines
        .filter((l) => l.pressPlanDieId === d.id)
        .map((l) => ({
          customerName: l.customerName,
          orderNumber: l.orderNumber,
          poNumber: l.poNumber,
          lineNo: l.lineNo,
          cutLengthMm: l.cutLengthMm,
          pcs: l.pcs,
          kgG: l.kgG,
        })),
    })),
  };
}

export function orderBookRowOf(item: BookItem): OrderBookExportRow {
  return {
    number: item.number,
    customerName: item.customerName,
    city: item.city,
    poNumber: item.poNumber,
    orderDate: item.orderDate,
    expectedDate: item.expectedDate,
    status: item.status,
    lines: item.lines,
    orderedG: item.orderedG,
    dispatchedG: item.dispatchedG,
    bakiG: item.bakiG,
    inStockG: item.bar.inStockG,
    lateDays: item.lateDays,
  };
}

/** The most orders one export reads (pages of 100 from `orders.list`). */
export const BOOK_EXPORT_MAX = 2_000;
