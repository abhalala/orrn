/**
 * Plant reports (spec P19). PL-8 adds the monthly sales register CSV for Tally (spec P12: Tally
 * stays the invoice of record; orrn exports what left the gate with PL and invoice numbers).
 * PL-11 adds the other reports to this router.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";

import { anyActionProcedure, router } from "../index";
import { companyTimezone, zonedMidnightMs, zonedYmd } from "../lib/dayWindow";

/** Rows per register: a plant ships a few hundred loads a month; the cap keeps one call bounded. */
export const MAX_REGISTER_ROWS = 5_000;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a
 * leading apostrophe, so a customer named "=HYPERLINK(…)" stays text when the CA opens the file.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const SALES_REGISTER_COLUMNS = [
  "Date",
  "PL no",
  "Invoice no",
  "Invoice date",
  "Customer",
  "GSTIN",
  "Vehicle",
  "Transporter",
  "Bundles",
  "Pcs",
  "Kg",
  "PO numbers",
  "Dispatch",
] as const;

export const reportsRouter = router({
  /**
   * Completed dispatches of one company calendar month (by completion time on the company clock),
   * one row each: date, PL no, Tally invoice no/date, customer + GSTIN, vehicle, transporter,
   * bundles, pcs, kg (3 decimals, no grouping) and PO numbers. Reports readers and the accounts
   * export role (office, accountant) may pull it.
   */
  salesRegisterCsv: anyActionProcedure("reports.read", "export.accounts")
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") }))
    .query(async ({ ctx, input }) => {
      const [year, month] = input.month.split("-").map(Number) as [number, number];
      const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
      const tz = companyTimezone(co?.settings);
      const startMs = zonedMidnightMs(tz, { year, month, day: 1 });
      const endMs = zonedMidnightMs(tz, { year, month: month + 1, day: 1 });
      if (!(endMs > startMs)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown month" });

      const inMonth = and(
        eq(dispatch.companyId, ctx.companyId),
        eq(dispatch.status, "completed"),
        isNull(dispatch.deletedAt),
        gte(dispatch.completedAt, new Date(startMs)),
        lt(dispatch.completedAt, new Date(endMs)),
      );

      const [rows, totals, pos] = await Promise.all([
        ctx.db
          .select({
            id: dispatch.id,
            code: dispatch.code,
            completedAt: dispatch.completedAt,
            // Dispatches completed before PL-8 have no pl_number; their packing list code is the number.
            plNumber: sql<string | null>`coalesce(${dispatch.plNumber}, (select pl.code from packing_list pl where pl.company_id = ${ctx.companyId} and pl.dispatch_id = ${dispatch}.${sql.identifier("id")} order by pl.created_at desc limit 1))`,
            invoiceNumber: dispatch.invoiceNumber,
            invoiceDate: dispatch.invoiceDate,
            vehicleNo: dispatch.vehicleNo,
            transporter: dispatch.transporter,
            customerName: customer.name,
            gstin: customer.taxId,
          })
          .from(dispatch)
          .innerJoin(customer, and(eq(customer.id, dispatch.customerId), eq(customer.companyId, ctx.companyId)))
          .where(inMonth)
          .orderBy(asc(dispatch.completedAt), asc(dispatch.id))
          .limit(MAX_REGISTER_ROWS + 1),
        ctx.db
          .select({
            id: dispatchItem.dispatchId,
            bundles: sql<number>`count(*)`,
            pcs: sql<number>`coalesce(sum(${bundle.quantity}), 0)`,
            weightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          })
          .from(dispatchItem)
          .innerJoin(dispatch, and(eq(dispatch.id, dispatchItem.dispatchId), eq(dispatch.companyId, ctx.companyId)))
          .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, ctx.companyId)))
          .where(and(eq(dispatchItem.companyId, ctx.companyId), inMonth))
          .groupBy(dispatchItem.dispatchId),
        ctx.db
          .selectDistinct({
            id: dispatchItem.dispatchId,
            po: sql<string | null>`coalesce(nullif(trim(${salesOrder.poNumber}), ''), nullif(trim(${bundle.poNumber}), ''))`,
          })
          .from(dispatchItem)
          .innerJoin(dispatch, and(eq(dispatch.id, dispatchItem.dispatchId), eq(dispatch.companyId, ctx.companyId)))
          .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, ctx.companyId)))
          .leftJoin(
            salesOrderLine,
            and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, ctx.companyId)),
          )
          .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
          .where(and(eq(dispatchItem.companyId, ctx.companyId), inMonth)),
      ]);
      if (rows.length > MAX_REGISTER_ROWS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `More than ${MAX_REGISTER_ROWS} dispatches in one month; ask support for a split export` });
      }

      const byId = new Map(totals.map((t) => [t.id, t]));
      const poById = new Map<string, Set<string>>();
      for (const p of pos) {
        if (!p.po) continue;
        const set = poById.get(p.id) ?? new Set<string>();
        set.add(p.po);
        poById.set(p.id, set);
      }
      const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

      const lines = [SALES_REGISTER_COLUMNS.join(",")];
      for (const r of rows) {
        const t = byId.get(r.id);
        const at = r.completedAt instanceof Date ? r.completedAt.getTime() : Number(r.completedAt);
        const d = zonedYmd(tz, at);
        const kg = (Number(t?.weightG ?? 0) / 1000).toFixed(3);
        lines.push(
          [
            csvCell(`${d.year}-${pad2(d.month)}-${pad2(d.day)}`),
            csvCell(r.plNumber),
            csvCell(r.invoiceNumber),
            csvCell(r.invoiceDate),
            csvCell(r.customerName),
            csvCell(r.gstin),
            csvCell(r.vehicleNo),
            csvCell(r.transporter),
            csvCell(Number(t?.bundles ?? 0)),
            csvCell(Number(t?.pcs ?? 0)),
            csvCell(kg),
            csvCell([...(poById.get(r.id) ?? [])].sort((a, b) => natural.compare(a, b)).join("; ")),
            csvCell(r.code),
          ].join(","),
        );
      }
      return { filename: `sales-register-${input.month}.csv`, csv: `${lines.join("\r\n")}\r\n`, rows: rows.length };
    }),
});
