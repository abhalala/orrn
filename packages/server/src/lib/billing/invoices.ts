/**
 * XE-BILL row 13: invoice and credit note operations (draft, issue, discard, ask to cancel, the cancel
 * applier) and the receivables reads (row 97). Every write is one `atomicBatch`; the number is taken inside
 * the issuing batch (numbering.ts), so a refused issue leaves no gap.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { gstHsn, invoice, invoiceSource, payment, paymentAllocation } from "@orrn/db/schema/billing";
import { customer } from "@orrn/db/schema/customers";
import { dispatch } from "@orrn/db/schema/dispatch";
import { packingList } from "@orrn/db/schema/packing";
import {
  computeInvoice,
  irnCancelRefusal,
  isModuleOn,
  type InvoiceLineInput,
  type ReceivableInvoice,
} from "@orrn/domain";

import type { Context } from "../../context";
import { approval } from "@orrn/db/schema/approval";
import { requestApprovalInsert } from "../approval";
import type { ApprovalApplier } from "../approvalApply";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { auditInsert, auditInsertGuarded } from "../audit";
import { now } from "../clock";
import { zonedYmd } from "../dayWindow";
import { docPeriod, nextDocNumber } from "../docNumber";
import { nextCompanySeq } from "../sequence";
import { buildDraft, type ChargeInput } from "./build";
import { generateIrn } from "./einvoiceFlow";
import { loadPartyGst, loadPlantGst, type PartyGst, type PlantGst } from "./facts";
import { currentIrpAdapter } from "./irp";
import { billingAbortUnless, isBillingAbort, issuedLanded, issueStatements } from "./numbering";
import { composeSnapshot, needsIrnFor, type CreditLineInput, type InvoiceSnapshot } from "./snapshot";

export type BillCtx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string; session: NonNullable<Context["session"]> };

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdText = (tz: string, ms: number) => {
  const d = zonedYmd(tz, ms);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
};

export function missingMessage(missing: string[]): string {
  return `Billing details missing: ${[...new Set(missing)].join(", ")}`;
}

function isUniqueOn(e: unknown, table: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    const m = cur instanceof Error ? cur.message : String(cur);
    if (m.includes("UNIQUE constraint failed") && m.includes(table)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Invoice draft
// ---------------------------------------------------------------------------

export type InvoiceInput = { packingListIds: string[]; rates: Record<string, number>; charges: ChargeInput[] };

/** Everything an invoice would be, without writing: the draft screen's preview, and issue's rebuild. */
export async function prepareInvoice(db: OrrnDb, companyId: string, input: InvoiceInput) {
  const build = await buildDraft(db, companyId, input);
  const plantRes = await loadPlantGst(db, companyId);
  const partyRes = await loadPartyGst(db, companyId, build.customerId);
  const missing = [...plantRes.missing, ...partyRes.missing];
  const snapshot =
    plantRes.plant && partyRes.party && build.missingRates.length === 0 && build.lines.length > 0
      ? composeSnapshot({ draftInput: input, plant: plantRes.plant, party: partyRes.party, lines: build.lines, refs: build.refs, sources: build.sources, vehicleNo: build.vehicleNo })
      : null;
  return { build, plant: plantRes.plant, party: partyRes.party, missing, snapshot, settings: plantRes.settings };
}

function invoiceValues(s: InvoiceSnapshot) {
  return {
    supplyType: s.supplyType,
    placeOfSupply: s.placeOfSupply,
    weightG: s.totals.weightG,
    taxablePaise: s.totals.taxablePaise,
    cgstPaise: s.totals.cgstPaise,
    sgstPaise: s.totals.sgstPaise,
    igstPaise: s.totals.igstPaise,
    roundOffPaise: s.totals.roundOffPaise,
    totalPaise: s.totals.totalPaise,
    snapshot: s as unknown as Record<string, unknown>,
  };
}

export async function createInvoiceDraft(ctx: BillCtx, input: InvoiceInput): Promise<{ id: string }> {
  const prep = await prepareInvoice(ctx.db, ctx.companyId, input);
  if (prep.build.missingRates.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Type a rate per kg for: ${prep.build.missingRates.map((m) => m.label).join(", ")}` });
  }
  if (!prep.snapshot) throw new TRPCError({ code: "PRECONDITION_FAILED", message: missingMessage(prep.missing) });
  const id = crypto.randomUUID();
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const statements: SqliteBatchItem[] = [
    ctx.db.insert(invoice).values({
      id,
      companyId: ctx.companyId,
      serverSeq: seq,
      kind: "invoice",
      status: "draft",
      customerId: prep.build.customerId,
      vehicleNo: prep.build.vehicleNo,
      createdBy: ctx.session.user.id,
      ...invoiceValues(prep.snapshot),
    }),
  ];
  pushChunkedInserts(
    statements,
    (rows) => ctx.db.insert(invoiceSource).values(rows),
    prep.build.sources.flatMap((s) =>
      s.dispatchIds.map((dispatchId) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        invoiceId: id,
        packingListId: s.packingListId,
        plCode: s.plCode,
        plRevision: s.plRevision,
        dispatchId,
        active: true,
      })),
    ),
  );
  statements.push(
    auditInsert(ctx, {
      action: "invoice.draft",
      subjectType: "invoice",
      subjectId: id,
      meta: { packingLists: prep.build.sources.map((s) => s.plCode), totalPaise: prep.snapshot.totals.totalPaise, typedRates: Object.keys(input.rates).length },
    }),
  );
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    if (isUniqueOn(e, "invoice_source")) throw new TRPCError({ code: "CONFLICT", message: "A packing list here is already on another invoice" });
    throw e;
  }
  return { id };
}

export async function discardDraft(ctx: BillCtx, invoiceId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ id: invoice.id, status: invoice.status, kind: invoice.kind })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (row.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a draft can be discarded: an issued invoice is cancelled instead" });
  await atomicBatch(ctx.db, [
    auditInsertGuarded(ctx, { action: "invoice.discard", subjectType: "invoice", subjectId: invoiceId, meta: { kind: row.kind } }, {
      from: invoice,
      where: and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId), eq(invoice.status, "draft")),
    }),
    ctx.db.delete(invoiceSource).where(
      and(eq(invoiceSource.invoiceId, invoiceId), eq(invoiceSource.companyId, ctx.companyId), sql`exists (select 1 from invoice i where i.id = ${invoiceId} and i.status = 'draft')`),
    ),
    ctx.db.delete(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId), eq(invoice.status, "draft"))),
  ]);
}

// ---------------------------------------------------------------------------
// Credit note draft
// ---------------------------------------------------------------------------

export type CreditInput = { againstInvoiceId: string; reason: "return" | "rate_difference" | "other"; note: string; lines: CreditLineInput[] };

async function creditedSoFar(db: OrrnDb, companyId: string, invoiceId: string, exceptId?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${invoice.totalPaise}), 0)` })
    .from(invoice)
    .where(
      and(
        eq(invoice.companyId, companyId),
        eq(invoice.againstInvoiceId, invoiceId),
        eq(invoice.kind, "credit_note"),
        inArray(invoice.status, ["issued", "irn_pending"]),
        exceptId ? sql`${invoice.id} <> ${exceptId}` : undefined,
      ),
    );
  return Number(r?.n ?? 0);
}

export async function prepareCreditNote(db: OrrnDb, companyId: string, input: CreditInput) {
  const [orig] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, input.againstInvoiceId), eq(invoice.companyId, companyId), eq(invoice.kind, "invoice")))
    .limit(1);
  if (!orig) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (orig.status !== "issued") throw new TRPCError({ code: "BAD_REQUEST", message: "A credit note goes against an issued invoice" });
  const origSnap = orig.snapshot as unknown as InvoiceSnapshot;
  const plantRes = await loadPlantGst(db, companyId);
  if (!plantRes.plant) throw new TRPCError({ code: "PRECONDITION_FAILED", message: missingMessage(plantRes.missing) });
  const hsnRows = await db.select().from(gstHsn).where(and(eq(gstHsn.companyId, companyId), eq(gstHsn.active, true)));
  const fallback = hsnRows.find((h) => h.isDefault) ?? null;
  const lines: InvoiceLineInput[] = input.lines.map((l, i) => {
    const hsn = (l.hsnId ? hsnRows.find((h) => h.id === l.hsnId) : null) ?? fallback;
    if (!hsn) throw new TRPCError({ code: "PRECONDITION_FAILED", message: missingMessage(["hsn"]) });
    return l.kind === "weight"
      ? { key: `credit|${i}`, description: l.description, hsn: hsn.code, uqc: hsn.uqc, gstRateBp: hsn.rateBp, kind: "weight", weightG: l.weightG, ratePaise: l.ratePaise }
      : { key: `credit|${i}`, description: l.description, hsn: hsn.code, uqc: "OTH", gstRateBp: hsn.rateBp, kind: "charge", amountPaise: l.amountPaise };
  });
  const snapshot = composeSnapshot({
    draftInput: { packingListIds: [], rates: {}, charges: [], creditLines: input.lines },
    plant: plantRes.plant,
    party: origSnap.party,
    lines,
    refs: lines.map((l) => ({ plCode: "", plRevision: 0, groupKey: l.key, orderNumber: null, lineNo: null, sectionCode: "", bundles: 0, pcs: 0, rateSource: "typed", poNumber: null })),
    sources: [],
    vehicleNo: null,
    against: { id: orig.id, number: orig.number!, date: orig.invoiceDate! },
    supplyType: origSnap.supplyType,
    placeOfSupply: origSnap.placeOfSupply,
  });
  return { orig, snapshot, plant: plantRes.plant };
}

async function assertCreditFits(db: OrrnDb, companyId: string, orig: { id: string; totalPaise: number }, creditPaise: number, exceptId?: string) {
  const prior = await creditedSoFar(db, companyId, orig.id, exceptId);
  if (prior + creditPaise > orig.totalPaise) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Credit notes against this invoice would add up to more than the invoice" });
  }
}

export async function createCreditDraft(ctx: BillCtx, input: CreditInput): Promise<{ id: string }> {
  if (input.lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A credit note needs at least one line" });
  const prep = await prepareCreditNote(ctx.db, ctx.companyId, input);
  await assertCreditFits(ctx.db, ctx.companyId, prep.orig, prep.snapshot.totals.totalPaise);
  const id = crypto.randomUUID();
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  await atomicBatch(ctx.db, [
    ctx.db.insert(invoice).values({
      id,
      companyId: ctx.companyId,
      serverSeq: seq,
      kind: "credit_note",
      status: "draft",
      customerId: prep.orig.customerId,
      againstInvoiceId: prep.orig.id,
      noteReason: input.reason,
      reason: input.note.trim() || null,
      createdBy: ctx.session.user.id,
      ...invoiceValues(prep.snapshot),
    }),
    auditInsert(ctx, { action: "credit_note.draft", subjectType: "invoice", subjectId: id, meta: { against: prep.orig.number, totalPaise: prep.snapshot.totals.totalPaise } }),
  ]);
  return { id };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

/** No source packing list of this invoice was regenerated or combined since the draft. */
function sourcesStillCurrent(companyId: string, invoiceId: string): SQL {
  return sql`not exists (
    select 1 from invoice_source s join packing_list p on p.id = s.packing_list_id and p.company_id = s.company_id
    where s.company_id = ${companyId} and s.invoice_id = ${invoiceId} and s.active = 1
      and (p.combined_into_id is not null or exists (select 1 from packing_list p2 where p2.company_id = ${companyId} and p2.supersedes_id = p.id)))`;
}

export async function issueDocument(ctx: BillCtx, invoiceId: string, modules: string[]): Promise<{ id: string; number: string | null; status: string; irnStatus: string }> {
  const [row] = await ctx.db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (row.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "This is already issued" });
  const stored = row.snapshot as unknown as InvoiceSnapshot;
  let snapshot: InvoiceSnapshot;
  let plant: PlantGst;
  let party: PartyGst;
  let origNeedsIrn = true;
  if (row.kind === "invoice") {
    const prep = await prepareInvoice(ctx.db, ctx.companyId, { packingListIds: stored.input.packingListIds, rates: stored.input.rates, charges: stored.input.charges });
    if (prep.build.missingRates.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Type a rate per kg for: ${prep.build.missingRates.map((m) => m.label).join(", ")}` });
    if (!prep.snapshot || !prep.plant || !prep.party) throw new TRPCError({ code: "PRECONDITION_FAILED", message: missingMessage(prep.missing) });
    if (prep.build.customerId !== row.customerId) throw new TRPCError({ code: "CONFLICT", message: "The packing lists changed customer: discard this draft" });
    ({ snapshot, plant, party } = prep);
  } else {
    const prep = await prepareCreditNote(ctx.db, ctx.companyId, {
      againstInvoiceId: row.againstInvoiceId!,
      reason: row.noteReason ?? "other",
      note: row.reason ?? "",
      lines: stored.input.creditLines ?? [],
    });
    await assertCreditFits(ctx.db, ctx.companyId, prep.orig, prep.snapshot.totals.totalPaise, row.id);
    snapshot = prep.snapshot;
    plant = prep.plant;
    party = prep.snapshot.party;
    origNeedsIrn = prep.orig.needsIrn;
  }
  const at = now();
  const invoiceDate = ymdText(plant.timezone, at.getTime());
  const needsIrn = origNeedsIrn && needsIrnFor({ einvoiceOn: isModuleOn(modules, "einvoice"), einvoiceFrom: plant.einvoiceFrom, invoiceDate, party });
  const period = docPeriod(row.kind, at, plant.timezone);
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const guard =
    row.kind === "invoice"
      ? sourcesStillCurrent(ctx.companyId, row.id)
      : sql`exists (select 1 from invoice o where o.id = ${row.againstInvoiceId} and o.company_id = ${ctx.companyId} and o.status = 'issued')
          and (select coalesce(sum(c.total_paise), 0) from invoice c where c.company_id = ${ctx.companyId} and c.against_invoice_id = ${row.againstInvoiceId}
                and c.kind = 'credit_note' and c.status in ('issued', 'irn_pending')) + ${snapshot.totals.totalPaise}
              <= (select o.total_paise from invoice o where o.id = ${row.againstInvoiceId})`;
  const landed = issuedLanded(ctx.companyId, row.id, seq);
  const numberOf = sql`(select i.number from invoice i where i.id = ${row.id})`;
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(invoice)
      .set({ ...invoiceValues(snapshot), needsIrn, updatedAt: at })
      .where(and(eq(invoice.id, row.id), eq(invoice.companyId, ctx.companyId), eq(invoice.status, "draft"))),
    ...issueStatements(ctx.db, {
      companyId: ctx.companyId,
      invoiceId: row.id,
      kind: row.kind,
      period,
      invoiceDate,
      status: needsIrn ? "irn_pending" : "issued",
      userId: ctx.session.user.id,
      seq,
      at: at.getTime(),
      irnStatus: needsIrn ? "pending" : "none",
      guard,
    }),
  ];
  if (row.kind === "invoice") {
    const sourceDispatches = sql`(select s.dispatch_id from invoice_source s where s.company_id = ${ctx.companyId} and s.invoice_id = ${row.id} and s.active = 1)`;
    const sourceLists = sql`(select s.packing_list_id from invoice_source s where s.company_id = ${ctx.companyId} and s.invoice_id = ${row.id} and s.active = 1)`;
    // The invoice number shows on the dispatch (the old Tally link fields) and on the current PL header.
    statements.push(
      ctx.db
        .update(dispatch)
        .set({ invoiceNumber: sql`${numberOf}`, invoiceDate })
        .where(and(eq(dispatch.companyId, ctx.companyId), sql`${dispatch.id} in ${sourceDispatches}`, landed)),
      ctx.db
        .update(packingList)
        .set({ snapshot: sql`json_set(${packingList.snapshot}, '$.header.invoiceNumber', ${numberOf}, '$.header.invoiceDate', ${invoiceDate})` })
        .where(and(eq(packingList.companyId, ctx.companyId), sql`${packingList.id} in ${sourceLists}`, sql`json_extract(${packingList.snapshot}, '$.version') = 2`, landed)),
    );
  }
  statements.push(
    auditInsertGuarded(
      ctx,
      { action: row.kind === "invoice" ? "invoice.issue" : "credit_note.issue", subjectType: "invoice", subjectId: row.id, meta: { totalPaise: snapshot.totals.totalPaise, needsIrn, period } },
      { from: invoice, where: and(eq(invoice.id, row.id), eq(invoice.serverSeq, seq)) },
    ),
  );
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    if (isBillingAbort(e)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: row.kind === "invoice" ? "A packing list on this draft changed while issuing: open the draft again" : "The invoice changed while issuing: open the credit note again",
      });
    }
    throw e;
  }
  if (needsIrn) {
    const adapter = currentIrpAdapter();
    if (adapter) await generateIrn(ctx.db, ctx.companyId, row.id, adapter, Date.now());
  }
  const [fresh] = await ctx.db
    .select({ id: invoice.id, number: invoice.number, status: invoice.status, irnStatus: invoice.irnStatus })
    .from(invoice)
    .where(and(eq(invoice.id, row.id), eq(invoice.companyId, ctx.companyId)))
    .limit(1);
  return fresh!;
}

// ---------------------------------------------------------------------------
// Cancel (approval invoice_cancel)
// ---------------------------------------------------------------------------

/** Why this issued document cannot be cancelled now, or null. */
export async function cancelRefusal(db: OrrnDb, companyId: string, row: typeof invoice.$inferSelect, at: number): Promise<string | null> {
  if (row.status !== "issued" && row.status !== "irn_pending") return "Only an issued invoice can be cancelled";
  if (row.kind === "invoice") {
    if ((await creditedSoFar(db, companyId, row.id)) > 0) return "A credit note is issued against this invoice: it cannot be cancelled";
    const [paid] = await db
      .select({ n: sql<number>`count(*)` })
      .from(paymentAllocation)
      .innerJoin(payment, and(eq(payment.id, paymentAllocation.paymentId), eq(payment.companyId, paymentAllocation.companyId)))
      .where(and(eq(paymentAllocation.companyId, companyId), eq(paymentAllocation.invoiceId, row.id), eq(payment.status, "active")));
    if (Number(paid?.n ?? 0) > 0) return "A payment is recorded against this invoice: void the payment first";
  }
  if (row.irnStatus === "generated") {
    const refusal = irnCancelRefusal({ ackAt: row.irnGeneratedAt?.getTime() ?? null, now: at, ewbActive: row.ewbStatus === "active" });
    if (refusal === "ewb_active") return "Cancel the e-way bill first";
    if (refusal === "window") return "The IRN is more than 24 hours old: issue a credit note instead";
  }
  return null;
}

export async function requestCancel(ctx: BillCtx, invoiceId: string, reason: string): Promise<{ approvalId: string }> {
  const [row] = await ctx.db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  const refusal = await cancelRefusal(ctx.db, ctx.companyId, row, Date.now());
  if (refusal) throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const req = requestApprovalInsert(ctx, {
    kind: "invoice_cancel",
    subjectId: row.id,
    serverSeq: seq,
    requestNote: reason,
    meta: { invoiceId: row.id, number: row.number, kind: row.kind },
    guard: { from: invoice, where: and(eq(invoice.id, row.id), eq(invoice.companyId, ctx.companyId), inArray(invoice.status, ["issued", "irn_pending"])) },
  });
  try {
    await atomicBatch(ctx.db, [
      req.statement,
      auditInsertGuarded(ctx, { action: "invoice.cancel.request", subjectType: "invoice", subjectId: row.id, meta: { number: row.number, reason } }, {
        from: approval,
        where: eq(approval.id, req.id),
      }),
    ]);
  } catch (e) {
    if (isUniqueOn(e, "approval")) throw new TRPCError({ code: "CONFLICT", message: "A cancel request for this invoice is already waiting" });
    throw e;
  }
  return { approvalId: req.id };
}

/** SQL: the document `invoiceId` may be cancelled at `atMs` (mirrors `cancelRefusal`, checked at write time). */
function cancellableSql(companyId: string, invoiceId: string, atMs: number): SQL {
  return sql`exists (select 1 from invoice i where i.id = ${invoiceId} and i.company_id = ${companyId} and i.status in ('issued', 'irn_pending')
      and not exists (select 1 from invoice c where c.company_id = ${companyId} and c.against_invoice_id = i.id and c.kind = 'credit_note' and c.status in ('issued', 'irn_pending'))
      and not exists (select 1 from payment_allocation pa join payment p on p.id = pa.payment_id where pa.company_id = ${companyId} and pa.invoice_id = i.id and p.status = 'active')
      and (i.irn_status <> 'generated' or (i.ewb_status <> 'active' and i.irn_generated_at > ${atMs - 24 * 60 * 60 * 1000})))`;
}

/**
 * The approved cancel: the document becomes cancelled (its number stays used, never reused), its packing
 * lists are free to bill again, and the dispatch and PL header lose the number. A live IRN is cancelled at
 * the IRP afterwards (einvoice.cancelIrn, or the 5-minute cron) since an applier cannot call out.
 */
export const invoiceCancelDecision: ApprovalApplier = (ctx, row, decision) => {
  if (decision === "rejected") return [];
  const { db, companyId, seq } = ctx;
  // Same as approvalApply's decisionLanded (inlined: approvalApply imports this module).
  const landed = sql`exists (select 1 from approval a where a.id = ${row.id} and a.company_id = ${companyId} and a.server_seq = ${seq} and a.status = ${decision})`;
  const at = ctx.decidedAt.getTime();
  const cancelled = sql`exists (select 1 from invoice i where i.id = ${row.subjectId} and i.company_id = ${companyId} and i.status = 'cancelled' and i.server_seq = ${seq})`;
  const number = sql`(select i.number from invoice i where i.id = ${row.subjectId})`;
  const dispatches = sql`(select s.dispatch_id from invoice_source s where s.company_id = ${companyId} and s.invoice_id = ${row.subjectId})`;
  const lists = sql`(select s.packing_list_id from invoice_source s where s.company_id = ${companyId} and s.invoice_id = ${row.subjectId})`;
  return [
    billingAbortUnless(db, companyId, sql`not (${landed}) or ${cancellableSql(companyId, row.subjectId, at)}`),
    db
      .update(invoice)
      .set({
        status: "cancelled",
        cancelApprovalId: row.id,
        cancelReason: sql`(select a.request_note from approval a where a.id = ${row.id})`,
        cancelledBy: ctx.userId,
        cancelledAt: ctx.decidedAt,
        irnStatus: sql`case when ${invoice.irnStatus} in ('pending', 'auto_retry', 'failed') then 'none' else ${invoice.irnStatus} end`,
        irnNextTryAt: null,
        serverSeq: seq,
        updatedAt: ctx.decidedAt,
      })
      .where(and(eq(invoice.id, row.subjectId), eq(invoice.companyId, companyId), inArray(invoice.status, ["issued", "irn_pending"]), landed)),
    db
      .update(dispatch)
      .set({ invoiceNumber: null, invoiceDate: null })
      .where(and(eq(dispatch.companyId, companyId), sql`${dispatch.id} in ${dispatches}`, sql`${dispatch.invoiceNumber} = ${number}`, cancelled)),
    db
      .update(packingList)
      .set({ snapshot: sql`json_set(${packingList.snapshot}, '$.header.invoiceNumber', null, '$.header.invoiceDate', null)` })
      .where(
        and(
          eq(packingList.companyId, companyId),
          sql`${packingList.id} in ${lists}`,
          sql`json_extract(${packingList.snapshot}, '$.version') = 2`,
          sql`json_extract(${packingList.snapshot}, '$.header.invoiceNumber') = ${number}`,
          cancelled,
        ),
      ),
    db.update(invoiceSource).set({ active: false }).where(and(eq(invoiceSource.companyId, companyId), eq(invoiceSource.invoiceId, row.subjectId), cancelled)),
  ];
};

/** The cancel applier's abort fired: say why, read from the current state. */
export async function explainInvoiceCancelAbort(db: OrrnDb, companyId: string, subjectId: string, e: unknown): Promise<void> {
  if (!isBillingAbort(e)) return;
  const [row] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, subjectId), eq(invoice.companyId, companyId)))
    .limit(1);
  const message = row ? ((await cancelRefusal(db, companyId, row, Date.now())) ?? "This invoice cannot be cancelled now") : "Not found";
  throw new TRPCError({ code: "BAD_REQUEST", message: `${message}. Reject this request.` });
}

// ---------------------------------------------------------------------------
// Payments received (row 97)
// ---------------------------------------------------------------------------

export type PaymentInput = {
  customerId: string;
  receivedOn: string;
  amountPaise: number;
  mode: (typeof payment.$inferInsert)["mode"];
  reference: string | null;
  note: string | null;
  allocations: { invoiceId: string; amountPaise: number }[];
};

const paidSql = (companyId: string, invoiceIdSql: SQL) =>
  sql`coalesce((select sum(pa.amount_paise) from payment_allocation pa join payment p on p.id = pa.payment_id
       where pa.company_id = ${companyId} and pa.invoice_id = ${invoiceIdSql} and p.status = 'active'), 0)`;
const creditedSql = (companyId: string, invoiceIdSql: SQL) =>
  sql`coalesce((select sum(c.total_paise) from invoice c where c.company_id = ${companyId} and c.against_invoice_id = ${invoiceIdSql}
       and c.kind = 'credit_note' and c.status = 'issued'), 0)`;

/** Issued invoices with what is paid and credited, for one customer or all. */
export async function receivableInvoices(db: OrrnDb, companyId: string, customerId?: string): Promise<(ReceivableInvoice & { customerId: string })[]> {
  const rows = await db
    .select({
      id: invoice.id,
      customerId: invoice.customerId,
      number: invoice.number,
      invoiceDate: invoice.invoiceDate,
      totalPaise: invoice.totalPaise,
      paidPaise: sql<number>`${paidSql(companyId, sql`${invoice}.${sql.identifier("id")}`)}`,
      creditedPaise: sql<number>`${creditedSql(companyId, sql`${invoice}.${sql.identifier("id")}`)}`,
    })
    .from(invoice)
    .where(and(eq(invoice.companyId, companyId), eq(invoice.kind, "invoice"), eq(invoice.status, "issued"), customerId ? eq(invoice.customerId, customerId) : undefined));
  return rows.map((r) => ({ ...r, number: r.number ?? "", invoiceDate: r.invoiceDate ?? "", paidPaise: Number(r.paidPaise), creditedPaise: Number(r.creditedPaise) }));
}

/** Payment money not allocated to any invoice (on account), per customer. */
export async function onAccountByCustomer(db: OrrnDb, companyId: string, customerId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      customerId: payment.customerId,
      n: sql<number>`sum(${payment.amountPaise} - coalesce((select sum(pa.amount_paise) from payment_allocation pa where pa.payment_id = ${payment}.${sql.identifier("id")}), 0))`,
    })
    .from(payment)
    .where(and(eq(payment.companyId, companyId), eq(payment.status, "active"), customerId ? eq(payment.customerId, customerId) : undefined))
    .groupBy(payment.customerId);
  return new Map(rows.map((r) => [r.customerId, Number(r.n ?? 0)]));
}

const MAX_ALLOCATIONS = 40;

export async function recordPayment(ctx: BillCtx, input: PaymentInput): Promise<{ id: string; number: string }> {
  const [c] = await ctx.db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId)))
    .limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (input.allocations.length > MAX_ALLOCATIONS) throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_ALLOCATIONS} invoices per payment` });
  const ids = [...new Set(input.allocations.map((a) => a.invoiceId))];
  if (ids.length !== input.allocations.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Each invoice once per payment" });
  const allocated = input.allocations.reduce((n, a) => n + a.amountPaise, 0);
  if (allocated > input.amountPaise) throw new TRPCError({ code: "BAD_REQUEST", message: "The amounts against invoices add up to more than the payment" });
  if (ids.length > 0) {
    const open = await receivableInvoices(ctx.db, ctx.companyId, input.customerId);
    const byId = new Map(open.map((i) => [i.id, i]));
    for (const a of input.allocations) {
      const inv = byId.get(a.invoiceId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (a.amountPaise > inv.totalPaise - inv.paidPaise - inv.creditedPaise) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `More than what is due on ${inv.number}` });
      }
    }
  }
  const at = now();
  const doc = await nextDocNumber(ctx.db, ctx.companyId, "payment", at, ctx.session.user.id);
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const id = crypto.randomUUID();
  const statements: SqliteBatchItem[] = [
    ctx.db.insert(payment).values({
      id,
      companyId: ctx.companyId,
      serverSeq: seq,
      period: doc.period,
      seq: doc.seq,
      number: doc.number,
      customerId: input.customerId,
      receivedOn: input.receivedOn,
      amountPaise: input.amountPaise,
      mode: input.mode,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      createdBy: ctx.session.user.id,
    }),
  ];
  pushChunkedInserts(
    statements,
    (rows) => ctx.db.insert(paymentAllocation).values(rows),
    input.allocations.map((a) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, paymentId: id, invoiceId: a.invoiceId, amountPaise: a.amountPaise })),
  );
  if (ids.length > 0) {
    // Write time: no invoice ends up paid beyond its total, even with two payments at once.
    statements.push(
      billingAbortUnless(
        ctx.db,
        ctx.companyId,
        sql`not exists (select 1 from invoice i where i.company_id = ${ctx.companyId} and i.id in (${sql.join(
          ids.map((x) => sql`${x}`),
          sql`, `,
        )}) and (i.status <> 'issued' or i.customer_id <> ${input.customerId} or i.total_paise - ${paidSql(ctx.companyId, sql`i.id`)} - ${creditedSql(ctx.companyId, sql`i.id`)} < 0))`,
      ),
    );
  }
  statements.push(auditInsert(ctx, { action: "payment.record", subjectType: "payment", subjectId: id, meta: { number: doc.number, amountPaise: input.amountPaise, invoices: ids.length } }));
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    if (isBillingAbort(e)) throw new TRPCError({ code: "CONFLICT", message: "An invoice changed meanwhile: open the payment again" });
    throw e;
  }
  return { id, number: doc.number };
}

export async function voidPayment(ctx: BillCtx, paymentId: string, reason: string): Promise<void> {
  const [row] = await ctx.db
    .select({ id: payment.id, status: payment.status, number: payment.number })
    .from(payment)
    .where(and(eq(payment.id, paymentId), eq(payment.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (row.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "This payment is already void" });
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const at = now();
  await atomicBatch(ctx.db, [
    ctx.db
      .update(payment)
      .set({ status: "void", voidReason: reason, voidedBy: ctx.session.user.id, voidedAt: at, serverSeq: seq })
      .where(and(eq(payment.id, paymentId), eq(payment.companyId, ctx.companyId), eq(payment.status, "active"))),
    auditInsertGuarded(ctx, { action: "payment.void", subjectType: "payment", subjectId: paymentId, meta: { number: row.number, reason } }, {
      from: payment,
      where: and(eq(payment.id, paymentId), eq(payment.serverSeq, seq)),
    }),
  ]);
}

/** Customer names for a set of ids (company scoped). */
export async function customerNames(db: OrrnDb, companyId: string, ids: string[]): Promise<Map<string, { name: string; gstin: string | null }>> {
  const rows = await mapInChunks([...new Set(ids)], (chunkIds) =>
    db
      .select({ id: customer.id, name: customer.name, gstin: customer.taxId })
      .from(customer)
      .where(and(eq(customer.companyId, companyId), inArray(customer.id, chunkIds))),
  );
  return new Map(rows.map((r) => [r.id, { name: r.name, gstin: r.gstin }]));
}

export { computeInvoice };
