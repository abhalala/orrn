/**
 * Die maker (FP-DR-11, Next; table-backed slice): the maker master and the send / receive /
 * cancel of a copy. `DM-{seq}` per FY. One open (`sent`) job per copy (partial unique). Send only
 * from `available` -> `at_maker`; receive or cancel -> `available`. A trial weight on receive
 * fills `trial_kg_per_12ft_milli` only when it is empty; it is never a drift reading.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { dieInstance, dieMaker, dieMakerJob, dieMakerJobPurposes, dieMakerJobStatuses } from "@orrn/db/schema/dies";
import { dieCopyNext } from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { audit, auditCtx, dieRoomAbortUnless, errorText, isDieRoomAbort } from "../lib/dieRoom";
import { nextDocNumber } from "../lib/docNumber";
import { nameKey } from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";

const makerEditor = anyActionProcedure("die.maker", "masters.publish");

const makerFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

async function loadMaker(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db.select().from(dieMaker).where(and(eq(dieMaker.id, id), eq(dieMaker.companyId, companyId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Die maker not found" });
  return row;
}

async function loadJob(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select({ job: dieMakerJob, code: dieInstance.code })
    .from(dieMakerJob)
    .innerJoin(dieInstance, and(eq(dieInstance.id, dieMakerJob.dieInstanceId), eq(dieInstance.companyId, dieMakerJob.companyId)))
    .where(and(eq(dieMakerJob.id, id), eq(dieMakerJob.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Die maker job not found" });
  return { ...row.job, code: row.code };
}

const nameTaken = (name: string) => new TRPCError({ code: "CONFLICT", message: `A die maker named ${name} already exists` });

export const dieMakerRouter = router({
  list: companyProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(dieMaker)
        .where(and(eq(dieMaker.companyId, ctx.companyId), input.includeArchived ? undefined : eq(dieMaker.status, "active")))
        .orderBy(asc(dieMaker.name)),
    ),

  create: makerEditor.input(z.object(makerFields)).mutation(async ({ ctx, input }) => {
    const key = nameKey(input.name);
    if (!key) throw new TRPCError({ code: "BAD_REQUEST", message: "Name needs letters or digits" });
    const id = crypto.randomUUID();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(dieMaker).values({
          id, companyId: ctx.companyId, serverSeq: seq, name: input.name, nameKey: key,
          phone: input.phone ?? null, city: input.city ?? null, notes: input.notes ?? null, createdBy: ctx.session.user.id,
        }),
        audit(ctx, { action: "die_maker.create", subjectType: "die_maker", subjectId: id, meta: { name: input.name } }),
      ]);
    } catch (e) {
      if (errorText(e).includes("die_maker.")) throw nameTaken(input.name);
      throw e;
    }
    return { id };
  }),

  update: makerEditor.input(z.object({ id: z.string().min(1), ...makerFields })).mutation(async ({ ctx, input }) => {
    const maker = await loadMaker(ctx.db, ctx.companyId, input.id);
    const key = nameKey(input.name);
    if (!key) throw new TRPCError({ code: "BAD_REQUEST", message: "Name needs letters or digits" });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    try {
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dieMaker)
          .set({ name: input.name, nameKey: key, phone: input.phone ?? null, city: input.city ?? null, notes: input.notes ?? null, serverSeq: seq })
          .where(and(eq(dieMaker.id, maker.id), eq(dieMaker.companyId, ctx.companyId))),
        audit(ctx, { action: "die_maker.update", subjectType: "die_maker", subjectId: maker.id, meta: { before: maker.name, after: input.name } }),
      ]);
    } catch (e) {
      if (errorText(e).includes("die_maker.")) throw nameTaken(input.name);
      throw e;
    }
    return { success: true };
  }),

  /** Archive (never delete). Refused while a copy is with this maker. */
  archive: makerEditor.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const maker = await loadMaker(ctx.db, ctx.companyId, input.id);
    const [open] = await ctx.db
      .select({ number: dieMakerJob.number })
      .from(dieMakerJob)
      .where(and(eq(dieMakerJob.companyId, ctx.companyId), eq(dieMakerJob.dieMakerId, maker.id), eq(dieMakerJob.status, "sent")))
      .limit(1);
    if (open) throw new TRPCError({ code: "BAD_REQUEST", message: `${open.number} is still with ${maker.name}` });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ctx.db.update(dieMaker).set({ status: "archived", serverSeq: seq }).where(and(eq(dieMaker.id, maker.id), eq(dieMaker.companyId, ctx.companyId))),
      audit(ctx, { action: "die_maker.archive", subjectType: "die_maker", subjectId: maker.id, meta: { name: maker.name } }),
    ]);
    return { success: true };
  }),

  jobs: router({
    list: companyProcedure
      .input(
        z
          .object({
            dieInstanceId: z.string().min(1).optional(),
            status: z.enum(dieMakerJobStatuses).optional(),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .default({ limit: 50 }),
      )
      .query(({ ctx, input }) =>
        ctx.db
          .select({
            id: dieMakerJob.id,
            number: dieMakerJob.number,
            status: dieMakerJob.status,
            purpose: dieMakerJob.purpose,
            dieInstanceId: dieMakerJob.dieInstanceId,
            code: dieInstance.code,
            dieMakerId: dieMakerJob.dieMakerId,
            makerName: dieMaker.name,
            sentAt: dieMakerJob.sentAt,
            receivedAt: dieMakerJob.receivedAt,
            note: dieMakerJob.note,
          })
          .from(dieMakerJob)
          .innerJoin(dieInstance, and(eq(dieInstance.id, dieMakerJob.dieInstanceId), eq(dieInstance.companyId, dieMakerJob.companyId)))
          .innerJoin(dieMaker, and(eq(dieMaker.id, dieMakerJob.dieMakerId), eq(dieMaker.companyId, dieMakerJob.companyId)))
          .where(
            and(
              eq(dieMakerJob.companyId, ctx.companyId),
              input.dieInstanceId ? eq(dieMakerJob.dieInstanceId, input.dieInstanceId) : undefined,
              input.status ? eq(dieMakerJob.status, input.status) : undefined,
            ),
          )
          .orderBy(desc(dieMakerJob.sentAt))
          .limit(input.limit),
      ),

    send: actionProcedure("die.maker")
      .input(
        z.object({
          dieInstanceId: z.string().min(1),
          dieMakerId: z.string().min(1),
          purpose: z.enum(dieMakerJobPurposes),
          note: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [copy] = await ctx.db
          .select({ id: dieInstance.id, code: dieInstance.code, status: dieInstance.status })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
          .limit(1);
        if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
        const maker = await loadMaker(ctx.db, ctx.companyId, input.dieMakerId);
        if (maker.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: `${maker.name} is archived` });
        if (dieCopyNext(copy.status, "makerSend") === null) {
          const where: Record<string, string> = { in_use: "is issued to a press", at_nitriding: "is out at nitriding", at_maker: "is already at the die maker", retired: "is retired" };
          throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} ${where[copy.status] ?? `is ${copy.status}`}` });
        }
        const at = clockNow();
        const doc = await nextDocNumber(ctx.db, ctx.companyId, "die_maker_job", at, ctx.session.user.id);
        const id = crypto.randomUUID();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const I = (c: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(c)}`;
        const statements: SqliteBatchItem[] = [
          // Keys follow die_maker_job's column order (insert-select rule).
          ctx.db.insert(dieMakerJob).select(
            ctx.db
              .select({
                id: sql<string>`${id}`.as("id"),
                companyId: sql<string>`${I("company_id")}`.as("company_id"),
                serverSeq: sql<number>`${seq}`.as("server_seq"),
                number: sql<string>`${doc.number}`.as("number"),
                period: sql<string>`${doc.period}`.as("period"),
                dieInstanceId: sql<string>`${I("id")}`.as("die_instance_id"),
                dieMakerId: sql<string>`${maker.id}`.as("die_maker_id"),
                purpose: sql<string>`${input.purpose}`.as("purpose"),
                status: sql<string>`'sent'`.as("status"),
                sentAt: sql<number>`${at.getTime()}`.as("sent_at"),
                receivedAt: sql<number | null>`null`.as("received_at"),
                note: sql<string | null>`${input.note ?? null}`.as("note"),
                createdBy: sql<string>`${ctx.session.user.id}`.as("created_by"),
                receivedBy: sql<string | null>`null`.as("received_by"),
                createdAt: sql<number>`${at.getTime()}`.as("created_at"),
                updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
              })
              .from(dieInstance)
              .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "available"))),
          ),
          ctx.db
            .update(dieInstance)
            .set({ status: "at_maker", dieMakerId: maker.id, serverSeq: seq })
            .where(
              and(
                eq(dieInstance.id, copy.id),
                eq(dieInstance.companyId, ctx.companyId),
                eq(dieInstance.status, "available"),
                sql`exists (select 1 from die_maker_job j where j.id = ${id} and j.server_seq = ${seq})`,
              ),
            ),
          dieRoomAbortUnless(ctx.db, sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = 'at_maker' and i.server_seq = ${seq})`),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "die_maker_job.send", subjectType: "die_instance", subjectId: copy.id, meta: { jobId: id, number: doc.number, dieMakerId: maker.id, purpose: input.purpose } },
            { from: dieMakerJob, where: eq(dieMakerJob.id, id) },
          ),
        ];
        try {
          await atomicBatch(ctx.db, statements);
        } catch (e) {
          if (isDieRoomAbort(e) || errorText(e).includes("die_maker_job.die_instance_id")) {
            throw new TRPCError({ code: "CONFLICT", message: `${copy.code} changed meanwhile; it was not sent` });
          }
          throw e;
        }
        return { id, number: doc.number };
      }),

    receive: actionProcedure("die.maker")
      .input(z.object({ id: z.string().min(1), note: z.string().trim().max(500).optional(), trialKgPer12ftMilli: z.number().int().min(1).max(500_000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const job = await loadJob(ctx.db, ctx.companyId, input.id);
        return closeJob(ctx, job, "received", input);
      }),

    cancel: actionProcedure("die.maker")
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const job = await loadJob(ctx.db, ctx.companyId, input.id);
        return closeJob(ctx, job, "cancelled", {});
      }),
  }),
});

async function closeJob(
  ctx: Parameters<typeof auditCtx>[0] & { db: OrrnDb },
  job: Awaited<ReturnType<typeof loadJob>>,
  to: "received" | "cancelled",
  input: { note?: string; trialKgPer12ftMilli?: number },
) {
  if (job.status !== "sent") throw new TRPCError({ code: "BAD_REQUEST", message: `${job.number} is already ${job.status}` });
  const at = clockNow();
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const jobLanded = sql`exists (select 1 from die_maker_job j where j.id = ${job.id} and j.server_seq = ${seq} and j.status = ${to})`;
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(dieMakerJob)
      .set({
        status: to,
        serverSeq: seq,
        ...(to === "received" ? { receivedAt: at, receivedBy: ctx.session.user.id } : {}),
        ...(input.note ? { note: input.note } : {}),
      })
      .where(and(eq(dieMakerJob.id, job.id), eq(dieMakerJob.companyId, ctx.companyId), eq(dieMakerJob.status, "sent"))),
    ctx.db
      .update(dieInstance)
      .set({
        status: "available",
        serverSeq: seq,
        // A trial weight fills the card only when it is empty; it is not the current weight.
        ...(to === "received" && input.trialKgPer12ftMilli !== undefined
          ? { trialKgPer12ftMilli: sql`coalesce(${sql.identifier("trial_kg_per_12ft_milli")}, ${input.trialKgPer12ftMilli})` }
          : {}),
      })
      .where(and(eq(dieInstance.id, job.dieInstanceId), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "at_maker"), jobLanded)),
    dieRoomAbortUnless(ctx.db, sql`${jobLanded} and exists (select 1 from die_instance i where i.id = ${job.dieInstanceId} and i.status = 'available' and i.server_seq = ${seq})`),
    auditInsertGuarded(
      auditCtx(ctx),
      {
        action: to === "received" ? "die_maker_job.receive" : "die_maker_job.cancel",
        subjectType: "die_instance",
        subjectId: job.dieInstanceId,
        meta: { jobId: job.id, number: job.number, trialKgPer12ftMilli: input.trialKgPer12ftMilli ?? null },
      },
      { from: dieMakerJob, where: and(eq(dieMakerJob.id, job.id), eq(dieMakerJob.serverSeq, seq)) },
    ),
  ];
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    if (isDieRoomAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${job.number} changed meanwhile; nothing was changed` });
    throw e;
  }
  return { success: true };
}
