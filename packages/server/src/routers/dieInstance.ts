/**
 * Die room (spec P4/P18, digest Stage 19): the physical copies ("obliques") of a catalogue
 * section, their kg/12ft readings, nitriding log, and the tier re-rank that a manager approves.
 *
 * - The `die` table is the section; `die_instance.section_id` points at it (same company is
 *   enforced here, the foreign key cannot).
 * - The oblique code `{sectionCode}-{n}` and `n` are allocated INSIDE the insert (one
 *   INSERT … SELECT), so two creates can never take the same number and a retired copy keeps its.
 * - A tier is never written directly after creation: `proposeTier` opens an approval (kind
 *   die_rerank) and `approval.decide` applies it in the decision's own batch (lib/approvalApply).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import {
  dieInstance,
  dieInstanceStatuses,
  dieTierChange,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema/dies";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, mapInChunks, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextCompanySeq } from "../lib/sequence";

/** kg/12ft in thousandths of a kg (= grams per 12 ft). 500 kg per 12 ft is far beyond any section. */
const kgPer12ftMilli = z.number().int().min(1).max(500_000);
const rank = z.number().int().min(1).max(99);
const hardness = z.number().int().min(1).max(5_000);
const grams = z.number().int().min(0).max(1_000_000_000);

const NOT_FOUND = { code: "NOT_FOUND", message: "Die not found" } as const;

/** One chemical's open / used / close, in grams; close = open - used (digest §8.6). */
const chemical = z
  .object({ openG: grams, usedG: grams, closeG: grams })
  .refine((c) => c.closeG === c.openG - c.usedG, "Close must equal open minus used");

const dieCardFields = {
  supplier: z.string().trim().max(200).nullable().optional(),
  trialKgPer12ftMilli: kgPer12ftMilli.nullable().optional(),
  hardness: hardness.nullable().optional(),
  lifeG: z.number().int().min(1).max(100_000_000_000).nullable().optional(),
  ftr: z.string().trim().max(200).nullable().optional(),
  status: z.enum(dieInstanceStatuses).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

/** `die_instance` as the statement sees it, table-qualified for use inside correlated subqueries. */
const outer = (column: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(column)}`;

type Instance = typeof dieInstance.$inferSelect;

async function loadInstance(
  ctx: { db: import("../lib/atomic").OrrnDb; companyId: string },
  id: string,
): Promise<Instance> {
  const [row] = await ctx.db
    .select()
    .from(dieInstance)
    .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(NOT_FOUND);
  return row;
}

function auditCtx(ctx: {
  db: import("../lib/atomic").OrrnDb;
  companyId: string;
  session: Parameters<typeof auditInsert>[0]["session"];
  impersonation: Parameters<typeof auditInsert>[0]["impersonation"];
}) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

/** Die card fields (create/update): the die room, or masters holders (manager, admin) per ruling RP7. */
const dieCardEditor = anyActionProcedure("die.card", "masters.publish");

export const dieInstanceRouter = router({
  /** Copies, lightest section code first; filter by section and status. Any member may read. */
  list: companyProcedure
    .input(
      z
        .object({
          sectionId: z.string().min(1).optional(),
          status: z.enum(dieInstanceStatuses).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dieInstance.companyId, ctx.companyId),
        input.sectionId ? eq(dieInstance.sectionId, input.sectionId) : undefined,
        input.status ? eq(dieInstance.status, input.status) : undefined,
      );
      const [items, [totalRow]] = await Promise.all([
        ctx.db
          .select({
            id: dieInstance.id,
            companyId: dieInstance.companyId,
            sectionId: dieInstance.sectionId,
            sectionSeries: die.series,
            sectionCode: die.sectionCode,
            seqNo: dieInstance.seqNo,
            code: dieInstance.code,
            supplier: dieInstance.supplier,
            status: dieInstance.status,
            tierRank: dieInstance.tierRank,
            tierSince: dieInstance.tierSince,
            hardness: dieInstance.hardness,
            lifeG: dieInstance.lifeG,
            trialKgPer12ftMilli: dieInstance.trialKgPer12ftMilli,
            latestKgPer12ftMilli: sql<number | null>`(
              select r.kg_per_12ft_milli from die_weight_reading r
              where r.die_instance_id = ${dieInstance.id} and r.company_id = ${dieInstance.companyId}
              order by r.read_at desc limit 1
            )`,
          })
          .from(dieInstance)
          .innerJoin(die, and(eq(die.id, dieInstance.sectionId), eq(die.companyId, dieInstance.companyId)))
          .where(where)
          .orderBy(asc(die.sectionCode), asc(dieInstance.seqNo))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(dieInstance).where(where),
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /** The die card: the copy, its section and band, recent readings, nitriding and tier history. */
  get: companyProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const instance = await loadInstance(ctx, input.id);
    const [section, readings, nitriding, tierChanges] = await Promise.all([
      ctx.db
        .select({
          id: die.id,
          series: die.series,
          sectionCode: die.sectionCode,
          name: die.name,
          weightMinG: die.weightMinG,
          weightMaxG: die.weightMaxG,
        })
        .from(die)
        .where(and(eq(die.id, instance.sectionId), eq(die.companyId, ctx.companyId)))
        .limit(1),
      ctx.db
        .select()
        .from(dieWeightReading)
        .where(and(eq(dieWeightReading.companyId, ctx.companyId), eq(dieWeightReading.dieInstanceId, instance.id)))
        .orderBy(desc(dieWeightReading.readAt))
        .limit(20),
      ctx.db
        .select()
        .from(nitridingLog)
        .where(and(eq(nitridingLog.companyId, ctx.companyId), eq(nitridingLog.dieInstanceId, instance.id)))
        .orderBy(desc(nitridingLog.nitridedAt), desc(nitridingLog.createdAt))
        .limit(20),
      ctx.db
        .select()
        .from(dieTierChange)
        .where(and(eq(dieTierChange.companyId, ctx.companyId), eq(dieTierChange.dieInstanceId, instance.id)))
        .orderBy(desc(dieTierChange.createdAt), desc(dieTierChange.serverSeq))
        .limit(50),
    ]);
    return { instance, section: section[0] ?? null, readings, nitriding, tierChanges };
  }),

  /**
   * New copy of a section. The oblique code and number come from the insert itself (next per
   * section, never reused). A `tierRank` given here is the first placement: an applied history
   * row, no approval (re-ranking an existing copy always needs one).
   */
  create: dieCardEditor
    .input(z.object({ sectionId: z.string().min(1), tierRank: rank.optional(), ...dieCardFields }))
    .mutation(async ({ ctx, input }) => {
      const [section] = await ctx.db
        .select({ id: die.id, status: die.status })
        .from(die)
        .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
        .limit(1);
      if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
      if (section.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This section is archived; no new die copies" });
      }

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const userId = ctx.session.user.id;
      const dieCol = (c: string) => sql`${sql.identifier("die")}.${sql.identifier(c)}`;
      const nextNo = sql<number>`(coalesce((select max(i.seq_no) from die_instance i where i.company_id = ${dieCol("company_id")} and i.section_id = ${dieCol("id")}), 0) + 1)`;
      const ranked = input.tierRank ?? null;

      const statements: SqliteBatchItem[] = [
        // Keys follow die_instance's column order (insert-select rule).
        ctx.db.insert(dieInstance).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${dieCol("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              sectionId: sql<string>`${dieCol("id")}`.as("section_id"),
              seqNo: nextNo.as("seq_no"),
              code: sql<string>`${dieCol("section_code")} || '-' || ${nextNo}`.as("code"),
              supplier: sql<string | null>`${input.supplier ?? null}`.as("supplier"),
              trialKgPer12ftMilli: sql<number | null>`${input.trialKgPer12ftMilli ?? null}`.as("trial_kg_per_12ft_milli"),
              hardness: sql<number | null>`${input.hardness ?? null}`.as("hardness"),
              lifeG: sql<number | null>`${input.lifeG ?? null}`.as("life_g"),
              ftr: sql<string | null>`${input.ftr ?? null}`.as("ftr"),
              status: sql<string>`${input.status ?? "available"}`.as("status"),
              tierRank: sql<number | null>`${ranked}`.as("tier_rank"),
              tierSince: sql<number | null>`${ranked === null ? null : at.getTime()}`.as("tier_since"),
              notes: sql<string | null>`${input.notes ?? null}`.as("notes"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
              updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
            })
            .from(die)
            .where(
              and(
                eq(die.id, input.sectionId),
                eq(die.companyId, ctx.companyId),
                isNull(die.deletedAt),
                eq(die.status, "active"),
              ),
            ),
        ),
      ];
      if (ranked !== null) {
        statements.push(
          ctx.db.insert(dieTierChange).select(
            ctx.db
              .select({
                id: sql<string>`${crypto.randomUUID()}`.as("id"),
                companyId: sql<string>`${outer("company_id")}`.as("company_id"),
                serverSeq: sql<number>`${seq}`.as("server_seq"),
                dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
                fromRank: sql<number | null>`null`.as("from_rank"),
                toRank: sql<number>`${ranked}`.as("to_rank"),
                reason: sql<string | null>`'initial'`.as("reason"),
                status: sql<string>`'applied'`.as("status"),
                approvalId: sql<string | null>`null`.as("approval_id"),
                effectiveAt: sql<number>`${at.getTime()}`.as("effective_at"),
                createdBy: sql<string>`${userId}`.as("created_by"),
                createdAt: sql<number>`${at.getTime()}`.as("created_at"),
                updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
              })
              .from(dieInstance)
              .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId))),
          ),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_instance.create",
            subjectType: "die_instance",
            subjectId: id,
            meta: { sectionId: input.sectionId, tierRank: ranked },
          },
          { from: dieInstance, where: and(eq(dieInstance.id, id), eq(dieInstance.serverSeq, seq)) },
        ),
      );
      await atomicBatch(ctx.db, statements);

      const [created] = await ctx.db
        .select()
        .from(dieInstance)
        .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId)))
        .limit(1);
      // The section was deleted or archived between the read and the write.
      if (!created) throw new TRPCError({ code: "CONFLICT", message: "The section changed; try again" });
      return { id, code: created.code, seqNo: created.seqNo };
    }),

  /** Die card fields only. The code and section are permanent; the tier changes only by approval. */
  update: dieCardEditor
    .input(z.object({ id: z.string().min(1), ...dieCardFields }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadInstance(ctx, input.id);
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof dieInstance.$inferInsert
      >;
      if (Object.keys(patch).length === 0) return { success: true };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dieInstance)
          .set({ ...patch, serverSeq: seq })
          .where(and(eq(dieInstance.id, existing.id), eq(dieInstance.companyId, ctx.companyId))),
        auditInsert(auditCtx(ctx), {
          action: "die_instance.update",
          subjectType: "die_instance",
          subjectId: existing.id,
          meta: {
            before: Object.fromEntries(Object.keys(patch).map((k) => [k, existing[k as keyof Instance]])),
            patch,
          },
        }),
      ]);
      return { success: true };
    }),

  /**
   * A kg/12ft reading of a copy (press, supervisor, die room). The previous reading of the same
   * copy is stored beside it as `last`, read at write time; `readAt` is strictly after the copy's
   * previous reading, so ordering by time equals ordering by write.
   */
  addReading: actionProcedure("die.reading")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        pressRunId: z.string().trim().min(1).max(64).optional(),
        kgPer12ftMilli,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired; it takes no readings` });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const nowMs = clockNow().getTime();
      const userId = ctx.session.user.id;
      // The copy's previous reading and the instant to stay after, both read at write time.
      const lastValue = sql`select r.kg_per_12ft_milli from die_weight_reading r where r.die_instance_id = ${outer("id")} order by r.read_at desc limit 1`;
      const afterLast = sql`select max(r.read_at) + 1 from die_weight_reading r where r.die_instance_id = ${outer("id")}`;
      await atomicBatch(ctx.db, [
        ctx.db.insert(dieWeightReading).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${outer("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
              pressRunId: sql<string | null>`${input.pressRunId ?? null}`.as("press_run_id"),
              kgPer12ftMilli: sql<number>`${input.kgPer12ftMilli}`.as("kg_per_12ft_milli"),
              lastKgPer12ftMilli: sql<number | null>`(${lastValue})`.as("last_kg_per_12ft_milli"),
              readAt: sql<number>`max(${nowMs}, coalesce((${afterLast}), 0))`.as("read_at"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${nowMs}`.as("created_at"),
            })
            .from(dieInstance)
            .where(
              and(
                eq(dieInstance.id, instance.id),
                eq(dieInstance.companyId, ctx.companyId),
                ne(dieInstance.status, "retired"),
              ),
            ),
        ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_reading.add",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: { code: instance.code, kgPer12ftMilli: input.kgPer12ftMilli, pressRunId: input.pressRunId ?? null },
          },
          { from: dieWeightReading, where: and(eq(dieWeightReading.id, id), eq(dieWeightReading.serverSeq, seq)) },
        ),
      ]);
      const [row] = await ctx.db
        .select()
        .from(dieWeightReading)
        .where(and(eq(dieWeightReading.id, id), eq(dieWeightReading.companyId, ctx.companyId)))
        .limit(1);
      // Retired between the read and the write.
      if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired; it takes no readings` });
      }
      return {
        id,
        kgPer12ftMilli: row.kgPer12ftMilli,
        lastKgPer12ftMilli: row.lastKgPer12ftMilli,
        readAt: row.readAt,
      };
    }),

  /**
   * One nitriding treatment (die room). Each chemical is optional but, when given, must have all of
   * open / used / close with close = open - used. Chemicals are plain numbers for now; the
   * store issue link (`store_txn_id`) is filled once the central store exists.
   */
  addNitriding: actionProcedure("die.card")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        nitridedAt: z.number().int().positive().optional(),
        hardness: hardness.optional(),
        cr4: chemical.optional(),
        cr2: chemical.optional(),
        k2s: chemical.optional(),
        caustic: chemical.optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      }
      const at = clockNow().getTime();
      // The paper sheet is often filled in later, never ahead of time (a day of clock slack).
      if (input.nitridedAt !== undefined && input.nitridedAt > at + 86_400_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The nitriding date is in the future" });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const n = <T extends number | string | null>(v: T | undefined) => sql<T | null>`${v ?? null}`;
      await atomicBatch(ctx.db, [
        ctx.db.insert(nitridingLog).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${outer("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
              nitridedAt: sql<number>`${input.nitridedAt ?? at}`.as("nitrided_at"),
              hardness: n(input.hardness).as("hardness"),
              cr4OpenG: n(input.cr4?.openG).as("cr4_open_g"),
              cr4UsedG: n(input.cr4?.usedG).as("cr4_used_g"),
              cr4CloseG: n(input.cr4?.closeG).as("cr4_close_g"),
              cr2OpenG: n(input.cr2?.openG).as("cr2_open_g"),
              cr2UsedG: n(input.cr2?.usedG).as("cr2_used_g"),
              cr2CloseG: n(input.cr2?.closeG).as("cr2_close_g"),
              k2sOpenG: n(input.k2s?.openG).as("k2s_open_g"),
              k2sUsedG: n(input.k2s?.usedG).as("k2s_used_g"),
              k2sCloseG: n(input.k2s?.closeG).as("k2s_close_g"),
              causticOpenG: n(input.caustic?.openG).as("caustic_open_g"),
              causticUsedG: n(input.caustic?.usedG).as("caustic_used_g"),
              causticCloseG: n(input.caustic?.closeG).as("caustic_close_g"),
              storeTxnId: sql<string | null>`null`.as("store_txn_id"),
              notes: n(input.notes).as("notes"),
              signedBy: sql<string>`${userId}`.as("signed_by"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at}`.as("created_at"),
            })
            .from(dieInstance)
            .where(
              and(
                eq(dieInstance.id, instance.id),
                eq(dieInstance.companyId, ctx.companyId),
                ne(dieInstance.status, "retired"),
              ),
            ),
        ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "nitriding.add",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: { code: instance.code, nitridingId: id, hardness: input.hardness ?? null },
          },
          { from: nitridingLog, where: and(eq(nitridingLog.id, id), eq(nitridingLog.serverSeq, seq)) },
        ),
      ]);
      const [row] = await ctx.db
        .select({ id: nitridingLog.id })
        .from(nitridingLog)
        .where(and(eq(nitridingLog.id, id), eq(nitridingLog.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      return { id };
    }),

  /**
   * Die room proposes a tier for one copy. Nothing changes until a manager approves the
   * `die_rerank` request (approval.decide applies it); one open proposal per copy.
   */
  proposeTier: actionProcedure("die.rerank")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        rank,
        reason: z.string().trim().min(1, "Give a reason").max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      }
      if (instance.tierRank === input.rank) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is already tier ${input.rank}` });
      }
      const [open] = await ctx.db
        .select({ id: dieTierChange.id })
        .from(dieTierChange)
        .where(and(eq(dieTierChange.dieInstanceId, instance.id), eq(dieTierChange.status, "pending")))
        .limit(1);
      if (open) {
        throw new TRPCError({ code: "CONFLICT", message: `${instance.code} already has a tier change waiting for approval` });
      }

      const tierChangeId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const request = requestApprovalInsert(ctx, {
        kind: "die_rerank",
        subjectId: tierChangeId,
        serverSeq: seq,
        requestNote: input.reason,
        meta: {
          dieInstanceId: instance.id,
          sectionId: instance.sectionId,
          code: instance.code,
          fromRank: instance.tierRank,
          toRank: input.rank,
        },
      });
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(dieTierChange).values({
            id: tierChangeId,
            companyId: ctx.companyId,
            serverSeq: seq,
            dieInstanceId: instance.id,
            fromRank: instance.tierRank,
            toRank: input.rank,
            reason: input.reason,
            status: "pending",
            createdBy: ctx.session.user.id,
          }),
          request.statement,
          auditInsert(auditCtx(ctx), {
            action: "die_tier.propose",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: { code: instance.code, fromRank: instance.tierRank, toRank: input.rank, approvalId: request.id },
          }),
        ]);
      } catch (e) {
        if (errorText(e).includes("die_tier_change.die_instance_id")) {
          throw new TRPCError({ code: "CONFLICT", message: `${instance.code} already has a tier change waiting for approval` });
        }
        throw e;
      }
      return { tierChangeId, approvalId: request.id };
    }),

  /**
   * Drift of a section's copies against its weight band: each copy's latest kg/12ft, whether it
   * is in band, the trend over its last `readings` readings, and `suggestFirst` = the lightest
   * in-band copy that is on the rack or in use (not out for nitriding, not retired). Lightest
   * first; copies never weighed last.
   */
  drift: companyProcedure
    .input(
      z.object({
        sectionId: z.string().min(1),
        readings: z.number().int().min(2).max(20).default(5),
        includeRetired: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [section] = await ctx.db
        .select({
          id: die.id,
          series: die.series,
          sectionCode: die.sectionCode,
          weightMinG: die.weightMinG,
          weightMaxG: die.weightMaxG,
        })
        .from(die)
        .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
        .limit(1);
      if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });

      const instances = await ctx.db
        .select({
          id: dieInstance.id,
          code: dieInstance.code,
          seqNo: dieInstance.seqNo,
          status: dieInstance.status,
          tierRank: dieInstance.tierRank,
        })
        .from(dieInstance)
        .where(
          and(
            eq(dieInstance.companyId, ctx.companyId),
            eq(dieInstance.sectionId, section.id),
            input.includeRetired ? undefined : ne(dieInstance.status, "retired"),
          ),
        )
        .orderBy(asc(dieInstance.seqNo))
        .limit(500);

      // Last N readings per copy (newest first), in id chunks to stay under the bound-parameter cap.
      const windowed = (ids: string[]) => {
        const ranked = ctx.db
          .select({
            dieInstanceId: dieWeightReading.dieInstanceId,
            kgPer12ftMilli: dieWeightReading.kgPer12ftMilli,
            readAt: dieWeightReading.readAt,
            n: sql<number>`row_number() over (partition by ${dieWeightReading.dieInstanceId} order by ${dieWeightReading.readAt} desc)`.as("n"),
          })
          .from(dieWeightReading)
          .where(and(eq(dieWeightReading.companyId, ctx.companyId), inArray(dieWeightReading.dieInstanceId, ids)))
          .as("ranked");
        return ctx.db
          .select({
            dieInstanceId: ranked.dieInstanceId,
            kgPer12ftMilli: ranked.kgPer12ftMilli,
            readAt: ranked.readAt,
          })
          .from(ranked)
          .where(sql`${ranked.n} <= ${input.readings}`)
          .orderBy(asc(ranked.readAt));
      };
      const readingRows = await mapInChunks(
        instances.map((i) => i.id),
        windowed,
        80,
      );
      const byInstance = new Map<string, { kgPer12ftMilli: number; readAt: Date }[]>();
      for (const r of readingRows) {
        const list = byInstance.get(r.dieInstanceId) ?? [];
        list.push({ kgPer12ftMilli: r.kgPer12ftMilli, readAt: r.readAt });
        byInstance.set(r.dieInstanceId, list);
      }

      const items = instances.map((i) => {
        const recent = byInstance.get(i.id) ?? []; // oldest first
        const last = recent[recent.length - 1] ?? null;
        const first = recent[0] ?? null;
        const latest = last ? { kgPer12ftMilli: last.kgPer12ftMilli, readAt: last.readAt } : null;
        let band: "in" | "above" | "below" | null = null;
        let offBandMilli: number | null = null;
        if (latest) {
          if (latest.kgPer12ftMilli > section.weightMaxG) {
            band = "above";
            offBandMilli = latest.kgPer12ftMilli - section.weightMaxG;
          } else if (latest.kgPer12ftMilli < section.weightMinG) {
            band = "below";
            offBandMilli = latest.kgPer12ftMilli - section.weightMinG;
          } else {
            band = "in";
            offBandMilli = 0;
          }
        }
        const deltaMilli = last && first && recent.length >= 2 ? last.kgPer12ftMilli - first.kgPer12ftMilli : null;
        // Steady = within half a percent of the latest weight (at least 1 g).
        const noise = latest ? Math.max(1, Math.round(latest.kgPer12ftMilli * 0.005)) : 1;
        const trend: "heavier" | "lighter" | "steady" | "unknown" =
          deltaMilli === null ? "unknown" : deltaMilli > noise ? "heavier" : deltaMilli < -noise ? "lighter" : "steady";
        return {
          dieInstanceId: i.id,
          code: i.code,
          status: i.status,
          tierRank: i.tierRank,
          latest,
          band,
          offBandMilli,
          deltaMilli,
          trend,
          recent,
        };
      });

      items.sort((a, b) => {
        if (a.latest && b.latest) {
          return a.latest.kgPer12ftMilli - b.latest.kgPer12ftMilli || a.code.localeCompare(b.code, "en", { numeric: true });
        }
        if (a.latest) return -1;
        if (b.latest) return 1;
        return a.code.localeCompare(b.code, "en", { numeric: true });
      });

      const candidates = items
        .filter((i) => i.band === "in" && (i.status === "in_use" || i.status === "available"))
        .sort(
          (a, b) =>
            a.latest!.kgPer12ftMilli - b.latest!.kgPer12ftMilli ||
            (a.tierRank ?? 1_000) - (b.tierRank ?? 1_000) ||
            a.code.localeCompare(b.code, "en", { numeric: true }),
        );
      const pick = candidates[0];
      return {
        section,
        readings: input.readings,
        items,
        suggestFirst: pick
          ? { dieInstanceId: pick.dieInstanceId, code: pick.code, kgPer12ftMilli: pick.latest!.kgPer12ftMilli }
          : null,
      };
    }),
});
