/**
 * XE-BILL row 15: IRN and e-way bill through the GST relay. Opt-in module `einvoice` (needs `billing`).
 * Built but not live: with no relay configured every call answers "not set up" and invoices that need an
 * IRN stay "Draft, IRN pending".
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { invoice } from "@orrn/db/schema/billing";
import { ewbRequired, irnCancelRefusal } from "@orrn/domain";

import { router } from "../index";
import { auditInsert } from "../lib/audit";
import { cancelEwb, cancelIrn, generateEwb, generateIrn, resetFailedIrn } from "../lib/billing/einvoiceFlow";
import { einvoiceProcedure } from "../lib/billing/gate";
import { currentIrpAdapter } from "../lib/billing/irp";

const id = z.string().min(1).max(64);

const NOT_SET_UP = "E-invoicing is not set up yet: the GST relay is not configured";

function adapterOrThrow() {
  const adapter = currentIrpAdapter();
  if (!adapter) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SET_UP });
  return adapter;
}

async function owned(ctx: { db: Parameters<typeof generateIrn>[0]; companyId: string }, invoiceId: string) {
  const [row] = await ctx.db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return row;
}

export const einvoiceRouter = router({
  /** Is the relay configured (no secrets in the answer). */
  relayStatus: einvoiceProcedure("invoice.read").query(() => ({ configured: currentIrpAdapter() !== null })),
  status: einvoiceProcedure("invoice.read")
    .input(z.object({ id }))
    .query(async ({ ctx, input }) => {
      const row = await owned(ctx, input.id);
      const now = Date.now();
      return {
        needsIrn: row.needsIrn,
        irnStatus: row.irnStatus,
        irn: row.irn,
        ackNo: row.ackNo,
        ackDt: row.ackDt,
        error: row.irnError,
        attempts: row.irnAttempts,
        canCancelIrn: row.irnStatus === "generated" && irnCancelRefusal({ ackAt: row.irnGeneratedAt?.getTime() ?? null, now, ewbActive: row.ewbStatus === "active" }) === null,
        ewbStatus: row.ewbStatus,
        ewbNo: row.ewbNo,
        ewbNeeded: ewbRequired(row.totalPaise),
      };
    }),
  /** Generate now (also "Try again" after a failure). */
  generate: einvoiceProcedure("invoice.issue")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const row = await owned(ctx, input.id);
      if (!row.needsIrn) throw new TRPCError({ code: "BAD_REQUEST", message: "This document does not need an IRN" });
      if (row.irn) return { outcome: "generated" as const };
      const adapter = adapterOrThrow();
      if (row.irnStatus === "failed") await resetFailedIrn(ctx.db, ctx.companyId, row.id, Date.now());
      const outcome = await generateIrn(ctx.db, ctx.companyId, row.id, adapter, Date.now());
      await ctx.db.batch([auditInsert(ctx, { action: "invoice.irn.generate", subjectType: "invoice", subjectId: row.id, meta: { outcome } })]);
      return { outcome };
    }),
  cancelIrn: einvoiceProcedure("invoice.cancel")
    .input(z.object({ id, reasonCode: z.enum(["1", "2", "3", "4"]).default("2"), remark: z.string().trim().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const row = await owned(ctx, input.id);
      if (row.status !== "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Cancel the invoice in orrn first (it needs approval)" });
      const out = await cancelIrn(ctx.db, ctx.companyId, row.id, adapterOrThrow(), Date.now(), { reasonCode: input.reasonCode, remark: input.remark });
      if (!out.ok) throw new TRPCError({ code: "BAD_REQUEST", message: out.message });
      await ctx.db.batch([auditInsert(ctx, { action: "invoice.irn.cancel", subjectType: "invoice", subjectId: row.id })]);
      return { ok: true };
    }),
  ewbGenerate: einvoiceProcedure("invoice.issue")
    .input(z.object({ id, distanceKm: z.number().int().min(0).max(4000), vehicleNo: z.string().trim().min(4).max(15), transporterId: z.string().trim().max(15).nullish(), transporterName: z.string().trim().max(100).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const row = await owned(ctx, input.id);
      if (row.status !== "issued") throw new TRPCError({ code: "BAD_REQUEST", message: "An e-way bill goes with an issued invoice" });
      const out = await generateEwb(ctx.db, ctx.companyId, row.id, adapterOrThrow(), Date.now(), input);
      if (!out.ok) throw new TRPCError({ code: "BAD_REQUEST", message: out.message });
      await ctx.db.batch([auditInsert(ctx, { action: "invoice.ewb.generate", subjectType: "invoice", subjectId: row.id, meta: { ewbNo: out.ewbNo } })]);
      return out;
    }),
  ewbCancel: einvoiceProcedure("invoice.cancel")
    .input(z.object({ id, reasonCode: z.enum(["1", "2", "3", "4"]).default("2"), remark: z.string().trim().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const row = await owned(ctx, input.id);
      const out = await cancelEwb(ctx.db, ctx.companyId, row.id, adapterOrThrow(), Date.now(), input);
      if (!out.ok) throw new TRPCError({ code: "BAD_REQUEST", message: out.message });
      await ctx.db.batch([auditInsert(ctx, { action: "invoice.ewb.cancel", subjectType: "invoice", subjectId: row.id })]);
      return { ok: true };
    }),
});
