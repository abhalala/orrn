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
 *
 * Every generate call is stamped (`irn_call_at`) BEFORE it leaves, under a status guard, so a cancel knows
 * whether an IRN might exist that orrn has not heard about.
 *
 * Cancel (review S1, the safe order):
 *   approve ─▶ cancel_pending (lists stay bound, number stays on the dispatch)   when an IRN exists or a call left
 *          └─▶ cancelled (lists freed)                                           when no call ever left
 *   cancel_pending ─IRN live─▶ cancel at the IRP ─ok─▶ cancelled, lists freed
 *                  ─no IRN known─▶ wait out a call in flight, look it up by document:
 *                         found ─▶ keep it, then cancel it as above;  not found (2283) ─▶ cancelled, lists freed
 *                  ─24 h past the IRN (or the call) ─▶ back to issued: "issue a credit note instead"
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { billingEvent, invoice, invoiceSource } from "@orrn/db/schema/billing";
import {
  buildInv01,
  decodeSignedInvoice,
  ewbValidUntil,
  IRN_MAX_AUTO_TRIES,
  IRN_RETRY_EVERY_MS,
  isModuleOn,
  parseAckDt,
  type RelayResponse,
} from "@orrn/domain";

import { dispatch } from "@orrn/db/schema/dispatch";
import { packingList } from "@orrn/db/schema/packing";

import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { companyModules } from "../moduleGate";
import { nextCompanySeq } from "../sequence";
import { loadPartyGst, loadPlantGst } from "./facts";
import type { IrnData, IrpAdapter, RelayTarget } from "./irp";
import { einvoiceModel, plantForSnapshot, supplyFor, type InvoiceSnapshot } from "./snapshot";

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
  to: RelayTarget,
  doc: { docType: "INV" | "CRN"; docNo: string; docDate: string },
  dup: Extract<RelayResponse, { ok: false }>,
): Promise<IrnData | null> {
  const found = await adapter.irnByDocument(to, doc);
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
  // Stamp the call before it leaves, under the status guard: a cancel approved meanwhile (cancel_pending)
  // wins and no call goes; a cancel approved after this sees the stamp and waits for the IRP's answer.
  const claimed = await db
    .update(invoice)
    .set({ irnCallAt: new Date(at) })
    .where(
      and(
        eq(invoice.id, invoiceId),
        eq(invoice.companyId, companyId),
        isNull(invoice.irn),
        inArray(invoice.status, ["irn_pending", "issued"]),
        inArray(invoice.irnStatus, ["pending", "auto_retry"]),
      ),
    )
    .returning({ id: invoice.id });
  if (claimed.length === 0) return "skipped";
  const gstin = snap.plant.gstin;
  const res = await adapter.generateIrn({ companyId, gstin }, built.payload);
  if (res.ok) {
    await persistIrn(db, companyId, invoiceId, res.data, at, "ok");
    return "generated";
  }
  if (res.code === "2150") {
    const doc = { docType: row.kind === "credit_note" ? ("CRN" as const) : ("INV" as const), docNo: row.number, docDate: ddmmyyyy(row.invoiceDate) };
    const recovered = await recoverDuplicate(adapter, { companyId, gstin }, doc, res);
    if (recovered) {
      await persistIrn(db, companyId, invoiceId, recovered, at, "duplicate_recovered");
      return "generated";
    }
  }
  const attempts = row.irnAttempts + 1;
  const retry = res.retryable && attempts < IRN_MAX_AUTO_TRIES;
  // The IRP itself refused the document (a validation answer, not the relay, not the network, not a duplicate):
  // no IRN was made by this call, so a cancel need not look it up.
  const irpRefused = !res.retryable && res.code !== "2150" && !/^(relay_|upstream_)/.test(res.code);
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({
        ...(irpRefused ? { irnCallAt: null } : {}),
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

export type RefreshResult =
  | { ok: true; recovered: true }
  | { ok: true; recovered: false; changed: string[] }
  | { ok: false; message: string };

/**
 * Review S7, "fix the details, then try again": before a failed IRN is tried again, re-read the plant's and
 * the party's GST facts (letterhead, billing settings, customer GST card) into the frozen snapshot. Number,
 * date, lines and totals stay: the IRP accepts the same document number again because no IRN was made for it.
 *
 * It must be KNOWN that no IRN exists: either no call ever left (`irn_call_at` null), or the IRP says so by
 * document (2283). A found IRN is kept instead (its answer was lost). A change that would move the tax (supply
 * type or place of supply) is refused: that needs a cancel and a new invoice.
 */
export async function refreshFailedIrn(db: OrrnDb, companyId: string, invoiceId: string, adapter: IrpAdapter, at: number): Promise<RefreshResult> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row || row.status !== "irn_pending" || row.irnStatus !== "failed" || row.irn || !row.needsIrn || !row.number || !row.invoiceDate) {
    return { ok: false, message: "Only a document whose IRN failed can be tried again" };
  }
  const stored = row.snapshot as unknown as InvoiceSnapshot;
  if (row.irnCallAt) {
    const doc = { docType: row.kind === "credit_note" ? ("CRN" as const) : ("INV" as const), docNo: row.number, docDate: ddmmyyyy(row.invoiceDate) };
    const found = await adapter.irnByDocument({ companyId, gstin: stored.plant.gstin }, doc);
    if (found.ok) {
      const facts = decodeSignedInvoice(found.data.SignedInvoice);
      if (!facts) return { ok: false, message: "The IRP's signed invoice could not be read: try again in a few minutes" };
      await persistIrn(db, companyId, row.id, { ...found.data, Irn: facts.irn, AckNo: found.data.AckNo ?? facts.ackNo, AckDt: found.data.AckDt ?? facts.ackDt }, at, "found_on_retry");
      return { ok: true, recovered: true };
    }
    if (!IRN_NOT_FOUND_CODES.has(found.code) || at - row.irnCallAt.getTime() > IRP_DETAILS_MS) {
      return { ok: false, message: "The IRP could not be checked for this document: try again in a few minutes, or cancel it and issue it again" };
    }
  }
  const [plantRes, partyRes] = await Promise.all([loadPlantGst(db, companyId), loadPartyGst(db, companyId, row.customerId)]);
  const missing = [...plantRes.missing, ...partyRes.missing];
  if (!plantRes.plant || !partyRes.party) return { ok: false, message: `Billing details missing: ${[...new Set(missing)].join(", ")}` };
  const plant = plantForSnapshot(plantRes.plant);
  const party = partyRes.party;
  if (supplyFor(plantRes.plant, party) !== stored.supplyType || party.placeOfSupply !== stored.placeOfSupply) {
    return { ok: false, message: "These details change the tax on this document: cancel it and issue it again" };
  }
  const changed = [
    ...(JSON.stringify(plant) !== JSON.stringify(stored.plant) ? ["plant"] : []),
    ...(JSON.stringify(party) !== JSON.stringify(stored.party) ? ["party"] : []),
  ];
  if (changed.length > 0) {
    const next: InvoiceSnapshot = { ...stored, plant, party };
    await atomicBatch(db, [
      db
        .update(invoice)
        .set({ snapshot: next as unknown as Record<string, unknown>, updatedAt: new Date(at) })
        .where(and(eq(invoice.id, row.id), eq(invoice.companyId, companyId), eq(invoice.status, "irn_pending"), eq(invoice.irnStatus, "failed"), isNull(invoice.irn))),
      event(db, companyId, row.id, "irn.refresh", "refreshed", at, changed.join(",")),
    ]);
  }
  return { ok: true, recovered: false, changed };
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

/** How long a generate call may still be in flight (the relay's upstream timeout is 10 s per IRP request, an auth plus a call). */
export const IRN_CALL_SETTLE_MS = 2 * 60 * 1000;
export const IRN_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** IRP answers to "IRN by document" that confirm no IRN exists for it. Anything else proves nothing. */
const IRN_NOT_FOUND_CODES = new Set(["2283"]);
/** The IRP serves IRN details for 2 days only: an older "not found" proves nothing. */
export const IRP_DETAILS_MS = 2 * 24 * 60 * 60 * 1000;

export const CANCEL_TOO_LATE = "The IRN could not be cancelled within 24 hours: issue a credit note instead";
const CANCEL_UNCHECKED = "The IRP could not be checked within 24 hours of the cancel: the invoice stays. Issue a credit note if its IRN was made";

/**
 * Free what an invoice held once it is really cancelled: the dispatch number, the number on every packing
 * list of those dispatches (all revisions, also one regenerated after issue: review S6), and the sources.
 * `guard` must hold only when the invoice reached `cancelled` in this same batch.
 */
export function releaseCancelledStatements(db: OrrnDb, companyId: string, invoiceId: string, guard: SQL): SqliteBatchItem[] {
  const number = sql`(select i.number from invoice i where i.id = ${invoiceId})`;
  const dispatches = sql`(select s.dispatch_id from invoice_source s where s.company_id = ${companyId} and s.invoice_id = ${invoiceId})`;
  return [
    db
      .update(dispatch)
      .set({ invoiceNumber: null, invoiceDate: null })
      .where(and(eq(dispatch.companyId, companyId), sql`${dispatch.id} in ${dispatches}`, sql`${dispatch.invoiceNumber} = ${number}`, guard)),
    db
      .update(packingList)
      .set({ snapshot: sql`json_set(${packingList.snapshot}, '$.header.invoiceNumber', null, '$.header.invoiceDate', null)` })
      .where(
        and(
          eq(packingList.companyId, companyId),
          sql`(${packingList.dispatchId} in ${dispatches}
            or ${packingList.id} in (select pld.packing_list_id from packing_list_dispatch pld where pld.company_id = ${companyId} and pld.dispatch_id in ${dispatches}))`,
          sql`json_extract(${packingList.snapshot}, '$.version') = 2`,
          sql`json_extract(${packingList.snapshot}, '$.header.invoiceNumber') = ${number}`,
          guard,
        ),
      ),
    db.update(invoiceSource).set({ active: false }).where(and(eq(invoiceSource.companyId, companyId), eq(invoiceSource.invoiceId, invoiceId), guard)),
  ];
}

export type SettleResult =
  | { outcome: "cancelled" | "reverted" | "waiting" | "skipped" }
  | { outcome: "failed"; code: string; message: string };

/** cancel_pending -> cancelled: the IRN is cancelled at the IRP (or none was ever made); the lists go free. */
async function finishCancel(db: OrrnDb, companyId: string, invoiceId: string, at: number, irnCancelled: boolean): Promise<SettleResult> {
  const seq = await nextCompanySeq({ db }, companyId);
  const landed = sql`exists (select 1 from invoice i where i.id = ${invoiceId} and i.company_id = ${companyId} and i.status = 'cancelled' and i.server_seq = ${seq})`;
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({
        status: "cancelled",
        irnStatus: irnCancelled ? "cancelled" : sql`case when ${invoice.irn} is null then 'none' else ${invoice.irnStatus} end`,
        ...(irnCancelled ? { irnCancelledAt: new Date(at) } : {}),
        irnNextTryAt: null,
        serverSeq: seq,
        updatedAt: new Date(at),
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.status, "cancel_pending"))),
    ...releaseCancelledStatements(db, companyId, invoiceId, landed),
    event(db, companyId, invoiceId, irnCancelled ? "irn.cancel" : "invoice.cancel", "cancelled", at, irnCancelled ? null : "no_irn"),
  ]);
  return { outcome: "cancelled" };
}

/** cancel_pending -> back to live: the IRN can no longer be cancelled. The office raises a credit note. */
async function revertCancel(db: OrrnDb, companyId: string, invoiceId: string, at: number, message: string): Promise<SettleResult> {
  const seq = await nextCompanySeq({ db }, companyId);
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({
        status: sql`case when ${invoice.irn} is not null then 'issued' else 'irn_pending' end`,
        irnStatus: sql`case when ${invoice.irn} is null and ${invoice.irnStatus} = 'auto_retry' then 'pending' else ${invoice.irnStatus} end`,
        cancelApprovalId: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        irnError: message,
        irnNextTryAt: null,
        serverSeq: seq,
        updatedAt: new Date(at),
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.status, "cancel_pending"))),
    event(db, companyId, invoiceId, "invoice.cancel", "reverted", at, "window", message),
  ]);
  return { outcome: "reverted" };
}

async function backOff(db: OrrnDb, companyId: string, invoiceId: string, at: number, action: string, code: string, message: string): Promise<SettleResult> {
  await atomicBatch(db, [
    db
      .update(invoice)
      .set({ irnNextTryAt: new Date(at + IRN_RETRY_EVERY_MS), updatedAt: new Date(at) })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.status, "cancel_pending"))),
    event(db, companyId, invoiceId, action, "failed", at, code, message),
  ]);
  return { outcome: "failed", code, message };
}

/**
 * Move one `cancel_pending` document on (review S1). Runs with no adapter too (relay not set up, or the
 * plant switched e-invoice off): then only the 24 h revert can happen, so nothing holds its lists forever.
 */
export async function settleCancel(
  db: OrrnDb,
  companyId: string,
  invoiceId: string,
  adapter: IrpAdapter | null,
  at: number,
  input: { reasonCode: string; remark: string } = { reasonCode: "2", remark: "Data entry mistake" },
): Promise<SettleResult> {
  let row = await loadForIrn(db, companyId, invoiceId);
  if (!row || row.status !== "cancel_pending") return { outcome: "skipped" };
  const snap = row.snapshot as unknown as InvoiceSnapshot;
  if (!row.irn) {
    const calledAt = row.irnCallAt?.getTime() ?? null;
    if (calledAt === null) return finishCancel(db, companyId, row.id, at, false);
    // Give up only 24 h after the CANCEL with no answer from the IRP (an old refused call is no reason to).
    const giveUp = (row.cancelledAt?.getTime() ?? at) + IRN_CANCEL_WINDOW_MS <= at;
    // A call may still be on its way to the IRP: look only once it must have answered.
    if (at - calledAt < IRN_CALL_SETTLE_MS) return { outcome: "waiting" };
    if (!adapter || !row.number || !row.invoiceDate) return giveUp ? revertCancel(db, companyId, row.id, at, CANCEL_UNCHECKED) : { outcome: "waiting" };
    const doc = { docType: row.kind === "credit_note" ? ("CRN" as const) : ("INV" as const), docNo: row.number, docDate: ddmmyyyy(row.invoiceDate) };
    const found = await adapter.irnByDocument({ companyId, gstin: snap.plant.gstin }, doc);
    if (!found.ok) {
      // "Not found" proves nothing once the IRP has stopped serving that call's details (2 days).
      if (IRN_NOT_FOUND_CODES.has(found.code) && at - calledAt <= IRP_DETAILS_MS) return finishCancel(db, companyId, row.id, at, false);
      if (giveUp) return revertCancel(db, companyId, row.id, at, CANCEL_UNCHECKED);
      return backOff(db, companyId, row.id, at, "irn.lookup", found.code, found.message);
    }
    const facts = decodeSignedInvoice(found.data.SignedInvoice);
    if (!facts) return backOff(db, companyId, row.id, at, "irn.lookup", "undecodable", "The IRP's signed invoice could not be read");
    await persistIrn(db, companyId, row.id, { ...found.data, Irn: facts.irn, AckNo: found.data.AckNo ?? facts.ackNo, AckDt: found.data.AckDt ?? facts.ackDt }, at, "found_on_cancel");
    row = await loadForIrn(db, companyId, invoiceId);
    if (!row || row.status !== "cancel_pending" || !row.irn) return { outcome: "skipped" };
  }
  const ackAt = row.irnGeneratedAt?.getTime() ?? null;
  if (ackAt === null || at - ackAt >= IRN_CANCEL_WINDOW_MS) return revertCancel(db, companyId, row.id, at, CANCEL_TOO_LATE);
  if (row.ewbStatus === "active") return { outcome: "failed", code: "ewb_active", message: "Cancel the e-way bill first" };
  if (!adapter) return { outcome: "waiting" };
  const res = await adapter.cancelIrn({ companyId, gstin: snap.plant.gstin }, { irn: row.irn!, reasonCode: input.reasonCode, remark: input.remark });
  if (!res.ok) return backOff(db, companyId, row.id, at, "irn.cancel", res.code, res.message);
  return finishCancel(db, companyId, row.id, at, true);
}

/** "Cancel IRN" on the invoice page: settle now with the office's reason (same order as the cron). */
export async function cancelIrn(
  db: OrrnDb,
  companyId: string,
  invoiceId: string,
  adapter: IrpAdapter,
  at: number,
  input: { reasonCode: string; remark: string } = { reasonCode: "2", remark: "Data entry mistake" },
): Promise<{ ok: true; outcome: SettleResult["outcome"] } | { ok: false; code: string; message: string }> {
  const row = await loadForIrn(db, companyId, invoiceId);
  if (!row) return { ok: false, code: "not_found", message: "Not found" };
  if (row.status !== "cancel_pending") return { ok: false, code: "not_pending", message: "This invoice has no approved cancel waiting for the IRP" };
  const out = await settleCancel(db, companyId, invoiceId, adapter, at, input);
  if (out.outcome === "failed") return { ok: false, code: out.code, message: out.message };
  if (out.outcome === "reverted") return { ok: false, code: "window", message: CANCEL_TOO_LATE };
  return { ok: true, outcome: out.outcome };
}

/** Right after an approved cancel: settle at once when e-invoice is on and the relay is set up (the cron retries). */
export async function settleCancelNow(db: OrrnDb, companyId: string, invoiceId: string, adapter: IrpAdapter | null, at: number): Promise<void> {
  const modules = await companyModules(db, companyId);
  const on = isModuleOn(modules, "billing") && isModuleOn(modules, "einvoice");
  try {
    await settleCancel(db, companyId, invoiceId, on ? adapter : null, at);
  } catch (e) {
    console.error("cancel settle failed", e instanceof Error ? e.message : String(e));
  }
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
  const res = await adapter.ewbByIrn({ companyId, gstin: snap.plant.gstin }, payload);
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
  const res = await adapter.cancelEwb({ companyId, gstin: snap.plant.gstin }, { ewbNo: row.ewbNo, reasonCode: input.reasonCode, remark: input.remark });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  await atomicBatch(db, [
    db.update(invoice).set({ ewbStatus: "cancelled", updatedAt: new Date(at) }).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.ewbStatus, "active"))),
    event(db, companyId, invoiceId, "ewb.cancel", "cancelled", at),
  ]);
  return { ok: true };
}

/** A row that threw in the cron moves back by one retry step, so it cannot hold the head of the queue. */
async function pushBack(db: OrrnDb, companyId: string, invoiceId: string, at: number, action: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`irn cron: ${action} ${invoiceId} failed`, message);
  try {
    await atomicBatch(db, [
      db
        .update(invoice)
        .set({ irnNextTryAt: new Date(at + IRN_RETRY_EVERY_MS), updatedAt: new Date(at) })
        .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))),
      event(db, companyId, invoiceId, action, "failed", at, "error", message),
    ]);
  } catch {
    // The run goes on with the next row either way.
  }
}

const CRON_BATCH = 25;
/** At most this many rows of one plant per run (review S4): one plant's backlog never starves the others. */
const CRON_PER_COMPANY = 5;

/** SQL: the invoice's plant has both opt-in modules named (opt-in = named, never by an empty list). */
const einvoiceOnSql = sql`exists (select 1 from company c where c.id = i.company_id
    and exists (select 1 from json_each(c.modules) j where lower(trim(j.value)) = 'billing')
    and exists (select 1 from json_each(c.modules) j where lower(trim(j.value)) = 'einvoice'))`;

/**
 * Cron (every 5 minutes):
 * - generate IRNs that are due, for plants with e-invoice on (filtered in SQL), fairly: at most
 *   `CRON_PER_COMPANY` per plant, oldest `irn_next_try_at` first;
 * - move every `cancel_pending` document on (settleCancel), also with no relay or e-invoice off, so the 24 h
 *   revert always happens. A failed cancel or lookup backs off by `irn_next_try_at`.
 */
export async function runIrnCron(db: OrrnDb, adapter: IrpAdapter | null, at: number): Promise<{ tried: number; cancelled: number }> {
  let tried = 0;
  let cancelled = 0;
  if (adapter) {
    const due = await db.all<{ id: string; company_id: string }>(sql`
      select id, company_id from (
        select i.id, i.company_id, coalesce(i.irn_next_try_at, 0) as next_at,
          row_number() over (partition by i.company_id order by coalesce(i.irn_next_try_at, 0), i.id) as rn
        from invoice i
        where i.needs_irn = 1 and i.irn is null and i.status in ('irn_pending', 'issued')
          and ((i.irn_status = 'pending' and coalesce(i.irn_next_try_at, 0) <= ${at}) or (i.irn_status = 'auto_retry' and i.irn_next_try_at <= ${at}))
          and ${einvoiceOnSql}
      ) where rn <= ${CRON_PER_COMPANY} order by next_at, id limit ${CRON_BATCH}`);
    for (const r of due) {
      tried += 1;
      try {
        await generateIrn(db, r.company_id, r.id, adapter, at);
      } catch (e) {
        await pushBack(db, r.company_id, r.id, at, "irn.generate", e);
      }
    }
  }
  const pending = await db.all<{ id: string; company_id: string; on_: number }>(sql`
    select id, company_id, on_ from (
      select i.id, i.company_id, (${einvoiceOnSql}) as on_, coalesce(i.irn_next_try_at, 0) as next_at,
        row_number() over (partition by i.company_id order by coalesce(i.irn_next_try_at, 0), i.id) as rn
      from invoice i
      where i.status = 'cancel_pending' and coalesce(i.irn_next_try_at, 0) <= ${at}
    ) where rn <= ${CRON_PER_COMPANY} order by next_at, id limit ${CRON_BATCH}`);
  for (const r of pending) {
    try {
      const out = await settleCancel(db, r.company_id, r.id, Number(r.on_) ? adapter : null, at);
      if (out.outcome === "cancelled") cancelled += 1;
    } catch (e) {
      await pushBack(db, r.company_id, r.id, at, "invoice.cancel", e);
    }
  }
  return { tried, cancelled };
}
