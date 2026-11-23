/**
 * Complaint register (XE parity lane REG, #18 raise and reply, #34 investigation), module `complaints`.
 *
 * - `open` (complaint.open): from the bundle page or a QR scan, by bundle id or number. The trace is
 *   attached by the server (`lib/complaints.ts complaintTrace`); the client sends only what the
 *   customer said.
 * - `investigate` / `reply` / `close` (complaint.manage): the status moves only through `complaintNext`
 *   (`@orrn/domain`), and every write is guarded by the row's `server_seq` read by the caller, so a save
 *   over a newer version answers CONFLICT and writes no audit row.
 * - Reads (`list`, `get`, `forBundle`) need complaint.open or complaint.manage. The module gate covers
 *   mutations at router level (`ROUTER_MODULE.complaints`); the reads call `assertModule` themselves, so a
 *   plant without the module sees nothing.
 */
import { complaintEditable, complaintNext, type ComplaintStatusValue } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { bundle } from "@orrn/db/schema/inventory";
import { complaint, complaintKinds, complaintStatuses, type ComplaintRow } from "@orrn/db/schema/complaint";
import { customer } from "@orrn/db/schema/customers";
import { membership } from "@orrn/db/schema/tenant";

import { anyActionProcedure, actionProcedure, router } from "../index";
import { atomicBatchLast } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now } from "../lib/clock";
import { openComplaint } from "../lib/complaints";
import { assertModule } from "../lib/moduleGate";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Day as YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);

const readProcedure = anyActionProcedure("complaint.open", "complaint.manage");
const manageProcedure = actionProcedure("complaint.manage");

export const COMPLAINT_NOT_FOUND = "Complaint not found";
export const COMPLAINT_CHANGED = "This complaint changed since you opened it. Open it again.";
export const COMPLAINT_CLOSED = "This complaint is closed";
export const COMPLAINT_BAD_MOVE = "A complaint cannot move to that status from here";
export const COMPLAINT_OWNER_NOT_MEMBER = "The person for the action is not a member of this plant";

async function loadOwned(ctx: { db: import("../lib/atomic").OrrnDb; companyId: string }, complaintId: string): Promise<ComplaintRow> {
  const [row] = await ctx.db.select().from(complaint).where(and(eq(complaint.companyId, ctx.companyId), eq(complaint.id, complaintId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: COMPLAINT_NOT_FOUND });
  return row;
}

function assertSeq(row: ComplaintRow, serverSeq: number) {
  if (row.serverSeq !== serverSeq) throw new TRPCError({ code: "CONFLICT", message: COMPLAINT_CHANGED });
}

function assertMove(from: ComplaintStatusValue, to: ComplaintStatusValue) {
  if (from === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: COMPLAINT_CLOSED });
  if (from === to) return;
  if (!complaintNext(from, to)) throw new TRPCError({ code: "BAD_REQUEST", message: COMPLAINT_BAD_MOVE });
}

/**
 * One guarded UPDATE + the audit row that lands only if it did: the WHERE carries company, id and the
 * caller's `server_seq`; the audit is an INSERT … SELECT on the row at its NEW seq.
 */
async function guardedWrite(
  ctx: Parameters<typeof auditInsertGuarded>[0] & { companyId: string },
  row: ComplaintRow,
  serverSeq: number,
  set: Partial<typeof complaint.$inferInsert>,
  audit: { action: string; meta: Record<string, unknown> },
) {
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const where = (s: number): SQL => and(eq(complaint.companyId, ctx.companyId), eq(complaint.id, row.id), eq(complaint.serverSeq, s))!;
  const landed = await atomicBatchLast<{ id: string }>(ctx.db, [
    ctx.db.update(complaint).set({ ...set, serverSeq: seq, updatedAt: now() }).where(where(serverSeq)),
    auditInsertGuarded(ctx, { action: audit.action, subjectType: "complaint", subjectId: row.id, meta: { number: row.number, ...audit.meta } }, { from: complaint, where: where(seq) }),
    ctx.db.select({ id: complaint.id }).from(complaint).where(where(seq)),
  ]);
  if (landed.length === 0) throw new TRPCError({ code: "CONFLICT", message: COMPLAINT_CHANGED });
  return loadOwned(ctx, row.id);
}

/** A row for the screens: the stored figures plus the names of the people on it. */
async function withNames(ctx: { db: import("../lib/atomic").OrrnDb; companyId: string }, row: ComplaintRow) {
  const ids = [row.createdBy, row.repliedBy, row.investigatedBy, row.actionOwnerId, row.closedBy].filter((x): x is string => !!x);
  const names = new Map<string, string>();
  if (ids.length) {
    const people = await ctx.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .innerJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, ctx.companyId)))
      .where(sql`${user.id} in (${sql.join([...new Set(ids)].map((i) => sql`${i}`), sql`, `)})`);
    for (const p of people) names.set(p.id, p.name);
  }
  const [party] = row.customerId
    ? await ctx.db.select({ name: customer.name }).from(customer).where(and(eq(customer.companyId, ctx.companyId), eq(customer.id, row.customerId))).limit(1)
    : [];
  const name = (u: string | null) => (u ? (names.get(u) ?? null) : null);
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    repliedAt: row.repliedAt?.getTime() ?? null,
    investigatedAt: row.investigatedAt?.getTime() ?? null,
    actionDoneAt: row.actionDoneAt?.getTime() ?? null,
    closedAt: row.closedAt?.getTime() ?? null,
    customerName: party?.name ?? null,
    createdByName: name(row.createdBy),
    repliedByName: name(row.repliedBy),
    investigatedByName: name(row.investigatedBy),
    actionOwnerName: name(row.actionOwnerId),
    closedByName: name(row.closedBy),
  };
}

const listInput = z
  .object({
    status: z.enum(["active", "all", ...complaintStatuses]).default("active"),
    customerId: id.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    /** Opaque cursor: `<createdAtMs>:<id>` of the last row of the previous page. */
    cursor: z.string().max(100).optional(),
  })
  .default({ status: "active", limit: 50 });

export const complaintRouter = router({
  list: readProcedure.input(listInput).query(async ({ ctx, input }) => {
    await assertModule(ctx, "complaints");
    const where: (SQL | undefined)[] = [eq(complaint.companyId, ctx.companyId)];
    if (input.status === "active") where.push(sql`${complaint.status} <> 'closed'`);
    else if (input.status !== "all") where.push(eq(complaint.status, input.status));
    if (input.customerId) where.push(eq(complaint.customerId, input.customerId));
    if (input.cursor) {
      const [ms, cid] = input.cursor.split(":");
      const at = new Date(Number(ms));
      if (cid && Number.isFinite(at.getTime())) where.push(or(lt(complaint.createdAt, at), and(eq(complaint.createdAt, at), lt(complaint.id, cid))));
    }
    const rows = await ctx.db
      .select({
        id: complaint.id,
        number: complaint.number,
        period: complaint.period,
        status: complaint.status,
        source: complaint.source,
        kind: complaint.kind,
        bundleId: complaint.bundleId,
        serial: bundle.serial,
        customerId: complaint.customerId,
        customerName: customer.name,
        affectedPcs: complaint.affectedPcs,
        actionDue: complaint.actionDue,
        createdAt: complaint.createdAt,
      })
      .from(complaint)
      .leftJoin(bundle, and(eq(bundle.id, complaint.bundleId), eq(bundle.companyId, complaint.companyId)))
      .leftJoin(customer, and(eq(customer.id, complaint.customerId), eq(customer.companyId, complaint.companyId)))
      .where(and(...where))
      .orderBy(desc(complaint.createdAt), desc(complaint.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const counts = await ctx.db.all<{ status: string; n: number }>(sql`select status, count(*) as n from complaint where company_id = ${ctx.companyId} group by status`);
    return {
      items: page.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
      nextCursor: rows.length > input.limit && last ? `${last.createdAt.getTime()}:${last.id}` : null,
      counts: Object.fromEntries(complaintStatuses.map((s) => [s, Number(counts.find((c) => c.status === s)?.n ?? 0)])) as Record<(typeof complaintStatuses)[number], number>,
    };
  }),

  get: readProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "complaints");
    return withNames(ctx, await loadOwned(ctx, input.id));
  }),

  /** Complaints raised on one bundle (the bundle page's card). */
  forBundle: readProcedure.input(z.object({ bundleId: id })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "complaints");
    const rows = await ctx.db
      .select({ id: complaint.id, number: complaint.number, period: complaint.period, status: complaint.status, kind: complaint.kind, createdAt: complaint.createdAt })
      .from(complaint)
      .where(and(eq(complaint.companyId, ctx.companyId), eq(complaint.bundleId, input.bundleId)))
      .orderBy(desc(complaint.createdAt))
      .limit(20);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
  }),

  open: actionProcedure("complaint.open")
    .input(
      z
        .object({
          bundleId: id.optional(),
          serial: z.string().trim().min(1).max(40).optional(),
          kind: z.enum(complaintKinds),
          description: text(2000),
          affectedPcs: z.number().int().min(1).max(100_000).optional(),
        })
        .refine((v) => v.bundleId || v.serial, { message: "Give the bundle" }),
    )
    .mutation(async ({ ctx, input }) => {
      // Serial is unique per plant; a party number is not (each customer numbers its own bundles), so
      // try the serial first and refuse a party number that matches more than one bundle (review REG #2).
      const pick = (where: SQL) => ctx.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, ctx.companyId), where)).limit(2);
      let rows = input.bundleId ? await pick(eq(bundle.id, input.bundleId)) : await pick(eq(bundle.serial, input.serial!));
      if (!input.bundleId && rows.length === 0) {
        rows = await pick(eq(bundle.partyNo, input.serial!));
        if (rows.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: "More than one bundle has that number. Scan the bundle QR." });
      }
      const [b] = rows;
      if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      const row = await openComplaint(ctx, { bundleId: b.id, source: "staff", kind: input.kind, description: input.description, affectedPcs: input.affectedPcs ?? null });
      return { id: row.id, number: row.number, period: row.period };
    }),

  /**
   * #34: root cause, corrective action, who and by when, and whether the action is done. Moves an
   * open (or replied) complaint to investigating. Only the fields sent change; null clears one.
   */
  investigate: manageProcedure
    .input(
      z.object({
        id,
        serverSeq: z.number().int(),
        rootCause: z.string().trim().max(2000).nullable().optional(),
        correctiveAction: z.string().trim().max(2000).nullable().optional(),
        actionOwnerId: id.nullable().optional(),
        actionDue: day.nullable().optional(),
        actionDone: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadOwned(ctx, input.id);
      assertSeq(row, input.serverSeq);
      if (!complaintEditable(row.status)) throw new TRPCError({ code: "BAD_REQUEST", message: COMPLAINT_CLOSED });
      const to: ComplaintStatusValue = row.status === "open" || row.status === "replied" ? "investigating" : row.status;
      assertMove(row.status, to);
      if (input.actionOwnerId) {
        const [m] = await ctx.db
          .select({ id: membership.id })
          .from(membership)
          .where(and(eq(membership.companyId, ctx.companyId), eq(membership.userId, input.actionOwnerId)))
          .limit(1);
        if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: COMPLAINT_OWNER_NOT_MEMBER });
      }
      const at = now();
      const set: Partial<typeof complaint.$inferInsert> = { status: to, investigatedBy: ctx.session.user.id, investigatedAt: at };
      const blank = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v === "" ? null : v);
      if (input.rootCause !== undefined) set.rootCause = blank(input.rootCause);
      if (input.correctiveAction !== undefined) set.correctiveAction = blank(input.correctiveAction);
      if (input.actionOwnerId !== undefined) set.actionOwnerId = input.actionOwnerId;
      if (input.actionDue !== undefined) set.actionDue = input.actionDue;
      if (input.actionDone !== undefined) set.actionDoneAt = input.actionDone ? (row.actionDoneAt ?? at) : null;
      const saved = await guardedWrite(ctx, row, input.serverSeq, set, {
        action: "complaint.investigate",
        meta: { from: row.status, to, fields: Object.keys(input).filter((k) => !["id", "serverSeq"].includes(k)) },
      });
      return withNames(ctx, saved);
    }),

  /** The answer to the customer. The party sees it in the portal. */
  reply: manageProcedure
    .input(z.object({ id, serverSeq: z.number().int(), reply: text(4000) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadOwned(ctx, input.id);
      assertSeq(row, input.serverSeq);
      assertMove(row.status, "replied");
      const saved = await guardedWrite(
        ctx,
        row,
        input.serverSeq,
        { status: "replied", reply: input.reply, repliedBy: ctx.session.user.id, repliedAt: now() },
        { action: "complaint.reply", meta: { from: row.status, to: "replied" } },
      );
      return withNames(ctx, saved);
    }),

  close: manageProcedure
    .input(z.object({ id, serverSeq: z.number().int(), note: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadOwned(ctx, input.id);
      assertSeq(row, input.serverSeq);
      assertMove(row.status, "closed");
      const saved = await guardedWrite(
        ctx,
        row,
        input.serverSeq,
        { status: "closed", closedBy: ctx.session.user.id, closedAt: now(), closeNote: input.note || null },
        { action: "complaint.close", meta: { from: row.status, to: "closed" } },
      );
      return withNames(ctx, saved);
    }),
});
