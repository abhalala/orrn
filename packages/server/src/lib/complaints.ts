/**
 * Complaint register (XE parity lane REG, #18 and #34). Shared by the staff router
 * (`routers/complaint.ts`) and the party side (`portal.complaints.*`).
 *
 * - `complaintTrace` reads the bundle's whole story at open time: section, die copy, cast, the press
 *   run and ageing batch of its trolley line (else the logged runs of its cast on its copy), the order
 *   and the completed dispatch with its PL number. It is frozen on the row (`trace_json`), so the
 *   complaint keeps what was true when it was raised. Every join is scoped by company.
 * - `openComplaint` allocates the CMP number (doc series, per financial year) and writes the row and
 *   its audit row in one batch. A failed batch leaves a gap in the series, which the numbering
 *   convention accepts (AGENTS.md "Document numbers").
 * - The party never receives the trace or the investigation: `partyView` is the only shape the portal
 *   returns (number, status, kind, bundle number, description, reply, dates).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import { complaint, type ComplaintKind, type ComplaintRow } from "@orrn/db/schema/complaint";

import type { Context } from "../context";
import { atomicBatch, type OrrnDb } from "./atomic";
import { auditInsert } from "./audit";
import { now } from "./clock";
import { nextDocNumber } from "./docNumber";
import { nextCompanySeq } from "./sequence";

export type ComplaintTrace = {
  bundle: { id: string; serial: string; partyNo: string | null; status: string; weightG: number; pcs: number; lengthMm: number; packedAt: number };
  section: { id: string; code: string; name: string | null };
  copy: { id: string; code: string } | null;
  cast: { id: string; number: string; legacyCode: string | null; alloy: string | null } | null;
  runs: { id: string; number: string; productionDay: string | null; shiftSeq: number | null; press: string | null }[];
  ageing: { batchId: string; number: string } | null;
  order: { id: string; number: string; poNumber: string | null } | null;
  dispatch: { id: string; code: string; completedAt: number | null; plNumber: string | null; invoiceNumber: string | null } | null;
  customerId: string | null;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** The bundle's trace, or null when the bundle is not this company's. */
export async function complaintTrace(db: OrrnDb, companyId: string, bundleId: string): Promise<ComplaintTrace | null> {
  const [b] = await db.all<{
    id: string;
    serial: string;
    party_no: string | null;
    status: string;
    weight_g: number;
    quantity: number;
    length_mm: number;
    created_at: number;
    die_id: string;
    section_code: string;
    section_name: string | null;
    copy_id: string | null;
    copy_code: string | null;
    cast_id: string | null;
    cast_number: string | null;
    legacy_code: string | null;
    cast_alloy: string | null;
    run_id: string | null;
    batch_id: string | null;
    batch_number: string | null;
    so_id: string | null;
    so_number: string | null;
    po_number: string | null;
    so_customer: string | null;
  }>(sql`
    select b.id, b.serial, b.party_no, b.status, b.weight_g, b.quantity, b.length_mm, b.created_at, b.die_id,
      d.section_code, d.name as section_name, di.id as copy_id, di.code as copy_code,
      c.id as cast_id, c.number as cast_number, c.legacy_code, c.alloy as cast_alloy,
      ar.press_run_id as run_id, ab.id as batch_id, ab.number as batch_number,
      so.id as so_id, so.number as so_number, so.po_number, so.customer_id as so_customer
    from bundle b
    join die d on d.id = b.die_id and d.company_id = b.company_id
    left join die_instance di on di.id = b.die_instance_id and di.company_id = b.company_id
    left join ${sql.identifier("cast")} c on c.id = b.cast_id and c.company_id = b.company_id
    left join ageing_row ar on ar.id = b.ageing_row_id and ar.company_id = b.company_id
    left join ageing_batch ab on ab.id = ar.batch_id and ab.company_id = b.company_id
    left join sales_order_line sl on sl.id = coalesce(b.sales_order_line_id, b.packed_sales_order_line_id) and sl.company_id = b.company_id
    left join sales_order so on so.id = sl.sales_order_id and so.company_id = b.company_id
    where b.company_id = ${companyId} and b.id = ${bundleId}
    limit 1`);
  if (!b) return null;

  // The run of its trolley line; else the logged runs of its cast on its copy (a bundle row has no run id).
  const runs = b.run_id
    ? await db.all<{ id: string; number: string; production_day: string | null; shift_seq: number | null; press: string | null }>(sql`
        select r.id, r.number, r.production_day, r.shift_seq, pl.code as press from press_run r
        left join press_line pl on pl.id = r.press_line_id and pl.company_id = r.company_id
        where r.company_id = ${companyId} and r.id = ${b.run_id}`)
    : b.cast_id
      ? await db.all<{ id: string; number: string; production_day: string | null; shift_seq: number | null; press: string | null }>(sql`
          select r.id, r.number, r.production_day, r.shift_seq, pl.code as press from press_run r
          left join press_line pl on pl.id = r.press_line_id and pl.company_id = r.company_id
          where r.company_id = ${companyId} and r.status = 'logged' and r.section_id = ${b.die_id}
            and (r.cast_id = ${b.cast_id} or exists (select 1 from press_billet_use u where u.company_id = r.company_id and u.press_run_id = r.id and u.cast_id = ${b.cast_id}))
            and (${b.copy_id} is null or r.die_instance_id = ${b.copy_id})
          order by r.logged_at desc limit 5`)
      : [];

  const [d] = await db.all<{ id: string; code: string; completed_at: number | null; pl_number: string | null; invoice_number: string | null; customer_id: string | null }>(sql`
    select d.id, d.code, d.completed_at, d.pl_number, d.invoice_number, d.customer_id
    from dispatch_item i join dispatch d on d.id = i.dispatch_id and d.company_id = i.company_id
    where i.company_id = ${companyId} and i.bundle_id = ${bundleId} and d.status = 'completed' and d.deleted_at is null
    order by d.completed_at desc limit 1`);

  return {
    bundle: { id: b.id, serial: b.serial, partyNo: b.party_no, status: b.status, weightG: num(b.weight_g), pcs: num(b.quantity), lengthMm: num(b.length_mm), packedAt: num(b.created_at) },
    section: { id: b.die_id, code: b.section_code, name: b.section_name },
    copy: b.copy_id ? { id: b.copy_id, code: b.copy_code ?? "" } : null,
    cast: b.cast_id ? { id: b.cast_id, number: b.cast_number ?? "", legacyCode: b.legacy_code, alloy: b.cast_alloy } : null,
    runs: runs.map((r) => ({ id: r.id, number: r.number, productionDay: r.production_day, shiftSeq: r.shift_seq == null ? null : Number(r.shift_seq), press: r.press })),
    ageing: b.batch_id ? { batchId: b.batch_id, number: b.batch_number ?? "" } : null,
    order: b.so_id ? { id: b.so_id, number: b.so_number ?? "", poNumber: b.po_number } : null,
    dispatch: d ? { id: d.id, code: d.code, completedAt: d.completed_at == null ? null : Number(d.completed_at), plNumber: d.pl_number, invoiceNumber: d.invoice_number } : null,
    customerId: d?.customer_id ?? b.so_customer ?? null,
  };
}

type WriteCtx = Pick<Context, "session"> & { db: OrrnDb; companyId: string; impersonation?: Context["impersonation"] };

/** Open a complaint on a bundle: number, row and audit in one batch. Returns the new row. */
export async function openComplaint(
  ctx: WriteCtx,
  input: {
    bundleId: string;
    source: "staff" | "portal";
    kind: ComplaintKind;
    description: string;
    affectedPcs: number | null;
    portalUserId?: string | null;
    /** The party a portal complaint comes from (must match the trace's customer; the caller checks). */
    customerId?: string | null;
  },
): Promise<ComplaintRow> {
  const trace = await complaintTrace(ctx.db, ctx.companyId, input.bundleId);
  if (!trace) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  if (input.affectedPcs != null && input.affectedPcs > trace.bundle.pcs) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "More pieces than the bundle has" });
  }
  const at = now();
  const userId = ctx.session?.user.id ?? null;
  const { number, period } = await nextDocNumber(ctx.db, ctx.companyId, "complaint", at, userId);
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const id = crypto.randomUUID();
  const row = {
    id,
    companyId: ctx.companyId,
    serverSeq: seq,
    number,
    period,
    status: "open" as const,
    source: input.source,
    kind: input.kind,
    bundleId: trace.bundle.id,
    customerId: input.customerId ?? trace.customerId,
    dispatchId: trace.dispatch?.id ?? null,
    description: input.description,
    affectedPcs: input.affectedPcs,
    traceJson: trace as unknown as Record<string, unknown>,
    portalUserId: input.portalUserId ?? null,
    createdBy: userId,
    createdAt: at,
    updatedAt: at,
  };
  await atomicBatch(ctx.db, [
    ctx.db.insert(complaint).values(row),
    auditInsert(ctx, {
      action: "complaint.open",
      subjectType: "complaint",
      subjectId: id,
      meta: { number, period, source: input.source, kind: input.kind, bundle: trace.bundle.serial },
    }),
  ]);
  const [saved] = await ctx.db.select().from(complaint).where(and(eq(complaint.companyId, ctx.companyId), eq(complaint.id, id))).limit(1);
  return saved!;
}

/** What the party may read of a complaint: never the trace, the investigation or who did what. */
export function partyView(r: ComplaintRow) {
  const trace = (r.traceJson ?? {}) as Partial<ComplaintTrace>;
  return {
    id: r.id,
    number: r.number,
    period: r.period,
    status: r.status,
    kind: r.kind,
    bundleNo: trace.bundle?.partyNo ?? trace.bundle?.serial ?? null,
    sectionCode: trace.section?.code ?? null,
    description: r.description,
    affectedPcs: r.affectedPcs,
    reply: r.reply,
    repliedAt: r.repliedAt ? r.repliedAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
    closedAt: r.closedAt ? r.closedAt.getTime() : null,
  };
}
