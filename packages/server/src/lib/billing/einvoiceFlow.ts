/**
 * XE-BILL row 15: the IRN status machine.
 *
 *   pending ──generate ok──▶ generated (invoice status issued)
 *      │  └─retryable error─▶ auto_retry ──cron, every IRN_RETRY_EVERY_MS──▶ generate again
 *      │                         └── after IRN_MAX_AUTO_TRIES ──▶ failed
 *      └─refused / invalid──▶ failed (fix the facts, then "Try again" puts it back to pending)
 *
 * A 2150 "duplicate IRN" answer means the IRP already has this document (an earlier call landed but its
 * answer was lost): fetch it by document number, decode the signed JWT and keep it as the first success.
 * The signed invoice, QR, AckNo and AckDt are written once (`irn is null` guard), never overwritten.
 */
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { billingEvent, invoice } from "@orrn/db/schema/billing";
import {
  buildInv01,
  decodeSignedInvoice,
  ewbValidUntil,
  IRN_MAX_AUTO_TRIES,
  IRN_RETRY_EVERY_MS,
  irnCancelRefusal,
  isModuleOn,
  parseAckDt,
  type RelayResponse,
} from "@orrn/domain";

import { atomicBatch, type OrrnDb } from "../atomic";
import { companyModules } from "../moduleGate";
import type { IrnData, IrpAdapter } from "./irp";
import { einvoiceModel, type InvoiceSnapshot } from "./snapshot";

type Outcome = "generated" | "auto_retry" | "failed" | "skipped";

function event(db: OrrnDb, companyId: string, invoiceId: string, action: string, outcome: string, at: number, code: string | null = null, message: string | null = null) {
  return db.insert(billingEvent).values({ id: crypto.randomUUID(), companyId, invoiceId, action, outcome, code, message: message?.slice(0, 500) ?? null, at: new Date(at) });
}

async function loadForIrn(db: OrrnDb, companyId: string, invoiceId: string) {
  const [row] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function persistIrn(db: OrrnDb, companyId: string, invoiceId: string, data: IrnData, at: number, how: string): Promise<boolean> {
  const ackAt = parseAckDt(String(data.AckDt)) ?? at;
  const rows = await db
    .update(invoice)
    .set({
      irn: data.Irn,
      ackNo: String(data.AckNo),
      ackDt: String(data.AckDt),
      signedInvoice: data.SignedInvoice,
      signedQrCode: data.SignedQRCode,
      irnStatus: "generated",
      irnError: null,
      irnNextTryAt: null,
      irnGeneratedAt: new Date(ackAt),
      status: sql`case when ${invoice.status} = 'irn_pending' then 'issued' else ${invoice.status} end`,
      updatedAt: new Date(at),
    })
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), isNull(invoice.irn)))
    .returning({ id: invoice.id });
  await db.insert(billingEvent).values({ id: crypto.randomUUID(), companyId, invoiceId, action: "irn.generate", outcome: "generated", code: how, message: null, at: new Date(at) });
  return rows.length > 0;
}

/** A 2150 answer: get the stored IRN by document, check the JWT names this IRN, keep it. */
async function recoverDuplicate(
  adapter: IrpAdapter,
  gstin: string,
  doc: { docType: "INV" | "CRN"; docNo: string; docDate: string },
  dup: Extract<RelayResponse, { ok: false }>,
): Promise<IrnData | null> {
  const found = await adapter.irnByDocument(gstin, doc);
  if (!found.ok) return null;
  const facts = decodeSignedInvoice(found.data.SignedInvoice);
  if (!facts) return null;
  const info = (dup.info as { InfCd?: string; Desc?: { Irn?: string } }[] | undefined)?.find((i) => i.InfCd === "DUPIRN");
  if (info?.Desc?.Irn && info.Desc.Irn !== facts.irn) return null;
  return { ...found.data, Irn: facts.irn, AckNo: found.data.AckNo ?? facts.ackNo, AckDt: found.data.AckDt ?? facts.ackDt };
}

const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** One generate attempt for an invoice whose IRN is pending or auto-retrying. */
export async function generateIrn(db: OrrnDb, companyId: string, invoiceId: string, adapter: IrpAdapter, at: number): Promise<Outcome> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row || !row.needsIrn || row.irn || !row.number || !row.invoiceDate || !["pending", "auto_retry"].includes(row.irnStatus)) return "skipped";
  if (row.status !== "irn_pending" && row.status !== "issued") return "skipped";
  const snap = row.snapshot as unknown as InvoiceSnapshot;
  const built = buildInv01(einvoiceModel(snap, { kind: row.kind, number: row.number, date: row.invoiceDate }));
  if (!built.ok) {
    const message = built.problems.map((p) => `${p.field}: ${p.problem}`).join("; ");
    await atomicBatch(db, [
      db.update(invoice).set({ irnStatus: "failed", irnError: message, updatedAt: new Date(at) }).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), isNull(invoice.irn))),
      event(db, companyId, invoiceId, "irn.generate", "failed", at, "invalid", message),
    ]);
    return "failed";
  }
  const gstin = snap.plant.gstin;
  const res = await adapter.generateIrn(gstin, built.payload);
  if (res.ok) {
    await persistIrn(db, companyId, invoiceId, res.data, at, "ok");
    return "generated";
  }
  if (res.code === "2150") {
    const doc = { docType: row.kind === "credit_note" ? ("CRN" as const) : ("INV" as const), docNo: row.number, docDate: ddmmyyyy(row.invoiceDate) };
    const recovered = await recoverDuplicate(adapter, gstin, doc, res);
    if (recovered) {
      await persistIrn(db, companyId, invoiceId, recovered, at, "duplicate_recovered");
      return "generated";
    }
  }
  const attempts = row.irnAttempts + 1;
  const retry = res.retryable && attempts < IRN_MAX_AUTO_TRIES;
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({
        irnStatus: retry ? "auto_retry" : "failed",
        irnAttempts: attempts,
        irnNextTryAt: retry ? new Date(at + IRN_RETRY_EVERY_MS) : null,
        irnError: `${res.code}: ${res.message}`.slice(0, 500),
        updatedAt: new Date(at),
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), isNull(invoice.irn))),
    event(db, companyId, invoiceId, "irn.generate", retry ? "auto_retry" : "failed", at, res.code, res.message),
  ]);
  return retry ? "auto_retry" : "failed";
}

/** "Try again" on a failed IRN: back to pending with a fresh retry budget. */
export async function resetFailedIrn(db: OrrnDb, companyId: string, invoiceId: string, at: number): Promise<boolean> {
  const rows = await db
    .update(invoice)
    .set({ irnStatus: "pending", irnAttempts: 0, irnNextTryAt: null, updatedAt: new Date(at) })
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.irnStatus, "failed"), isNull(invoice.irn), eq(invoice.needsIrn, true)))
    .returning({ id: invoice.id });
  return rows.length > 0;
}

/** Cancel the IRN of a cancelled invoice (inside 24 h, no live e-way bill). */
export async function cancelIrn(
  db: OrrnDb,
  companyId: string,
  invoiceId: string,
  adapter: IrpAdapter,
  at: number,
  input: { reasonCode: string; remark: string } = { reasonCode: "2", remark: "Data entry mistake" },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row) return { ok: false, code: "not_found", message: "Not found" };
  if (row.irnStatus !== "generated" || !row.irn) return { ok: false, code: "no_irn", message: "This invoice has no live IRN" };
  const refusal = irnCancelRefusal({ ackAt: row.irnGeneratedAt?.getTime() ?? null, now: at, ewbActive: row.ewbStatus === "active" });
  if (refusal) {
    const message = refusal === "window" ? "An IRN can be cancelled only within 24 hours: issue a credit note instead" : "Cancel the e-way bill first";
    return { ok: false, code: refusal, message };
  }
  const snap = row.snapshot as unknown as InvoiceSnapshot;
  const res = await adapter.cancelIrn(snap.plant.gstin, { irn: row.irn, reasonCode: input.reasonCode, remark: input.remark });
  if (!res.ok) {
    await db.insert(billingEvent).values({ id: crypto.randomUUID(), companyId, invoiceId, action: "irn.cancel", outcome: "failed", code: res.code, message: res.message.slice(0, 500), at: new Date(at) });
    return { ok: false, code: res.code, message: res.message };
  }
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({ irnStatus: "cancelled", irnCancelledAt: new Date(at), updatedAt: new Date(at) })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.irnStatus, "generated"))),
    event(db, companyId, invoiceId, "irn.cancel", "cancelled", at),
  ]);
  return { ok: true };
}

/** E-way bill by IRN: Part-A from the invoice, Part-B (vehicle) from the dispatch. */
export async function generateEwb(
  db: OrrnDb,
  companyId: string,
  invoiceId: string,
  adapter: IrpAdapter,
  at: number,
  input: { distanceKm: number; vehicleNo: string; transporterId?: string | null; transporterName?: string | null },
): Promise<{ ok: true; ewbNo: string } | { ok: false; code: string; message: string }> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row) return { ok: false, code: "not_found", message: "Not found" };
  if (row.irnStatus !== "generated" || !row.irn) return { ok: false, code: "no_irn", message: "Generate the IRN first" };
  if (row.ewbStatus === "active") return { ok: false, code: "ewb_active", message: "This invoice already has an e-way bill" };
  const snap = row.snapshot as unknown as InvoiceSnapshot;
  const to = snap.party.shipTo;
  const payload: Record<string, unknown> = {
    Irn: row.irn,
    Distance: input.distanceKm,
    TransMode: "1",
    VehNo: input.vehicleNo.replace(/[^A-Z0-9]/gi, "").toUpperCase(),
    VehType: "R",
    ...(input.transporterId ? { TransId: input.transporterId } : {}),
    ...(input.transporterName ? { TransName: input.transporterName } : {}),
    ...(to ? { ExpShipDtls: { Addr1: to.address1, Loc: to.place, Pin: Number(to.pincode), Stcd: to.stateCode } } : {}),
  };
  const res = await adapter.ewbByIrn(snap.plant.gstin, payload);
  if (!res.ok) {
    await db.insert(billingEvent).values({ id: crypto.randomUUID(), companyId, invoiceId, action: "ewb.generate", outcome: "failed", code: res.code, message: res.message.slice(0, 500), at: new Date(at) });
    return { ok: false, code: res.code, message: res.message };
  }
  const ewbNo = String(res.data.EwbNo);
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({
        ewbStatus: "active",
        ewbNo,
        ewbDate: new Date(at),
        ewbValidUntil: new Date(ewbValidUntil(at, input.distanceKm)),
        distanceKm: input.distanceKm,
        vehicleNo: payload.VehNo as string,
        updatedAt: new Date(at),
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), sql`${invoice.ewbStatus} <> 'active'`)),
    event(db, companyId, invoiceId, "ewb.generate", "active", at, ewbNo),
  ]);
  return { ok: true, ewbNo };
}

export async function cancelEwb(
  db: OrrnDb,
  companyId: string,
  invoiceId: string,
  adapter: IrpAdapter,
  at: number,
  input: { reasonCode: string; remark: string },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row) return { ok: false, code: "not_found", message: "Not found" };
  if (row.ewbStatus !== "active" || !row.ewbNo) return { ok: false, code: "no_ewb", message: "This invoice has no live e-way bill" };
  const snap = row.snapshot as unknown as InvoiceSnapshot;
  const res = await adapter.cancelEwb(snap.plant.gstin, { ewbNo: row.ewbNo, reasonCode: input.reasonCode, remark: input.remark });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  await atomicBatch(db, [
    db.update(invoice).set({ ewbStatus: "cancelled", updatedAt: new Date(at) }).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.ewbStatus, "active"))),
    event(db, companyId, invoiceId, "ewb.cancel", "cancelled", at),
  ]);
  return { ok: true };
}

const CRON_BATCH = 25;

/**
 * Cron (every 5 minutes): retry IRNs that are due, and cancel the IRN of invoices cancelled in orrn while
 * the 24 h window is still open. Does nothing when the relay is not configured.
 */
export async function runIrnCron(db: OrrnDb, adapter: IrpAdapter | null, at: number): Promise<{ tried: number; cancelled: number }> {
  if (!adapter) return { tried: 0, cancelled: 0 };
  const due = await db
    .select({ id: invoice.id, companyId: invoice.companyId })
    .from(invoice)
    .where(
      and(
        eq(invoice.needsIrn, true),
        isNull(invoice.irn),
        inArray(invoice.status, ["irn_pending", "issued"]),
        or(eq(invoice.irnStatus, "pending"), and(eq(invoice.irnStatus, "auto_retry"), lte(invoice.irnNextTryAt, new Date(at)))),
      ),
    )
    .limit(CRON_BATCH);
  const toCancel = await db
    .select({ id: invoice.id, companyId: invoice.companyId })
    .from(invoice)
    .where(and(eq(invoice.status, "cancelled"), eq(invoice.irnStatus, "generated"), sql`${invoice.irnGeneratedAt} > ${at - 24 * 60 * 60 * 1000}`, sql`${invoice.ewbStatus} <> 'active'`))
    .limit(CRON_BATCH);
  const on = new Map<string, boolean>();
  const einvoiceOn = async (companyId: string) => {
    if (!on.has(companyId)) {
      const modules = await companyModules(db, companyId);
      on.set(companyId, isModuleOn(modules, "billing") && isModuleOn(modules, "einvoice"));
    }
    return on.get(companyId)!;
  };
  let tried = 0;
  let cancelled = 0;
  for (const r of due) {
    if (!(await einvoiceOn(r.companyId))) continue;
    tried += 1;
    await generateIrn(db, r.companyId, r.id, adapter, at);
  }
  for (const r of toCancel) {
    if (!(await einvoiceOn(r.companyId))) continue;
    const out = await cancelIrn(db, r.companyId, r.id, adapter, at);
    if (out.ok) cancelled += 1;
  }
  return { tried, cancelled };
}
