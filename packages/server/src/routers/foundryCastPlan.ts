/**
 * Casting plan (XE parity lane FOUNDRY, row 46). The press plans' billet need (REG's `planBilletNeed`, which
 * runs the domain `billetNeed`) is summed per plan day and alloy, then `castingPlan` takes off what the plant
 * already holds (logs and billets on the ledger, by alloy) and what accepted plan lines will cast. The plant
 * accepts a proposal (or edits the weight), and an accepted line opens a cast in the same batch that links it.
 *
 * Reads are open to any member; accept, edit and drop are `foundry.plan`; opening a cast is `cast.enter`
 * (whoever opens casts at the plant), so the plan never opens a cast its reader could not.
 */
import { castingPlan } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { alloy, cast, furnace } from "@orrn/db/schema/foundry";
import { castPlanLine } from "@orrn/db/schema/foundryDepth";
import { pressPlan } from "@orrn/db/schema/press";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { companyTimezone, zonedMidnightMs, zonedYmd } from "../lib/dayWindow";
import { nextDocNumber } from "../lib/docNumber";
import { defaultReturnStreamStatements, foundryAbort, isFoundryAbort } from "../lib/foundry";
import { companySettings } from "../lib/press";
import { planBilletNeed } from "../lib/regReports";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-22");
const note = z.string().trim().max(300).optional();
const grams = z.number().int().min(1_000).max(500_000_000);
const num = (v: unknown) => Number(v ?? 0);
/** At most this many press plans are read for one proposal (each is a few queries). */
const PLANS_MAX = 40;
/** The longest window one proposal looks at. */
const WINDOW_DAYS_MAX = 31;

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

const ymdParts = (d: string) => {
  const [year, month, dd] = d.split("-").map(Number) as [number, number, number];
  return { year, month, day: dd };
};
const ymdText = (p: { year: number; month: number; day: number }) => `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

async function loadLine(ctx: { db: import("../lib/atomic").OrrnDb; companyId: string }, lineId: string) {
  const [l] = await ctx.db
    .select()
    .from(castPlanLine)
    .where(and(eq(castPlanLine.id, lineId), eq(castPlanLine.companyId, ctx.companyId)))
    .limit(1);
  if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Plan line not found" });
  return l;
}

/** Abort the batch unless the line is still accepted (a second tap, or someone else, got there first). */
function stillAccepted(db: import("../lib/atomic").OrrnDb, companyId: string, lineId: string) {
  return foundryAbort(db, companyId, sql`not exists (select 1 from ${castPlanLine} x where x.id = ${lineId} and x.company_id = ${companyId} and x.status = 'accepted')`);
}

export const foundryCastPlanRouter = {
  castPlan: router({
    /**
     * The proposal for plant days [from, to]: production press plans (draft or released) whose window
     * starts in the range, each plan's billet need on its first day, minus stock and accepted lines.
     * Also the plan lines of those days, so the screen shows what was accepted next to what is proposed.
     */
    propose: companyProcedure.input(z.object({ from: day, to: day })).query(async ({ ctx, input }) => {
      if (input.to < input.from) bad("The end day is before the start day");
      const settings = await companySettings(ctx.db, ctx.companyId);
      const tz = companyTimezone(settings);
      const startMs = zonedMidnightMs(tz, ymdParts(input.from));
      const to = ymdParts(input.to);
      const endMs = zonedMidnightMs(tz, { ...to, day: to.day + 1 });
      if (endMs - startMs > WINDOW_DAYS_MAX * 86_400_000 + 3_600_000) bad("Look at 31 days or fewer at a time");

      const plans = await ctx.db
        .select({ id: pressPlan.id, number: pressPlan.number, status: pressPlan.status, windowStart: pressPlan.windowStart })
        .from(pressPlan)
        .where(
          and(
            eq(pressPlan.companyId, ctx.companyId),
            inArray(pressPlan.status, ["draft", "released"]),
            eq(pressPlan.purpose, "production"),
            gte(pressPlan.windowStart, new Date(startMs)),
            sql`${pressPlan.windowStart} < ${endMs}`,
          ),
        )
        .orderBy(asc(pressPlan.windowStart))
        .limit(PLANS_MAX + 1);
      const truncated = plans.length > PLANS_MAX;
      const used = plans.slice(0, PLANS_MAX);

      const needs: { day: string; alloy: string; billetKgG: number }[] = [];
      const planRows: { id: string; number: string; status: string; day: string; billetKgG: number; noAlloyG: number }[] = [];
      for (const p of used) {
        const d = ymdText(zonedYmd(tz, p.windowStart.getTime()));
        const need = await planBilletNeed(ctx.db, ctx.companyId, p.id);
        let billetKgG = 0;
        let noAlloyG = 0;
        for (const r of need.rows) {
          if (r.alloy == null) noAlloyG += r.billetKgG;
          else needs.push({ day: d, alloy: r.alloy, billetKgG: r.billetKgG });
          billetKgG += r.billetKgG;
        }
        planRows.push({ id: p.id, number: p.number, status: p.status, day: d, billetKgG, noAlloyG });
      }

      // Logs and billets on hand by alloy (every place the billet item sits: store, rack, press floors).
      const stock = await ctx.db.all<{ alloy: string; g: number }>(sql`
        select c.alloy, coalesce(sum(l.qty_g), 0) as g
        from stock_ledger l join ${cast} c on c.id = l.item_ref and c.company_id = l.company_id
        where l.company_id = ${ctx.companyId} and l.item_kind = 'billet'
        group by c.alloy`);
      // Metal still to come from the plan: accepted lines in full; an opened line until its cast puts
      // logs on the ledger (what is on the ledger is already in the stock above).
      const coming = await ctx.db.all<{ alloy: string; g: number }>(sql`
        select x.alloy, coalesce(sum(case
          when x.status = 'accepted' then x.kg_g
          when x.status = 'opened' and c.status in ('open', 'closing') then max(0, x.kg_g - coalesce((
            select sum(l.qty_g) from stock_ledger l where l.company_id = x.company_id and l.item_kind = 'billet' and l.item_ref = x.cast_id and l.qty_g > 0
          ), 0))
          else 0 end), 0) as g
        from ${castPlanLine} x left join ${cast} c on c.id = x.cast_id and c.company_id = x.company_id
        where x.company_id = ${ctx.companyId} and x.status in ('accepted', 'opened')
        group by x.alloy`);
      const [size] = await ctx.db
        .select({ g: sql<number>`max(${furnace.capacityG})` })
        .from(furnace)
        .where(and(eq(furnace.companyId, ctx.companyId), eq(furnace.status, "active"), eq(furnace.kind, "melting")));
      const castSizeG = size?.g ? num(size.g) : null;

      const plan = castingPlan({
        needs,
        stockByAlloy: new Map(stock.map((s) => [s.alloy, num(s.g)])),
        acceptedByAlloy: new Map(coming.map((s) => [s.alloy, num(s.g)])),
        castSizeG,
      });

      const lines = await ctx.db
        .select({
          id: castPlanLine.id,
          day: castPlanLine.day,
          alloyId: castPlanLine.alloyId,
          alloy: castPlanLine.alloy,
          kgG: castPlanLine.kgG,
          proposedG: castPlanLine.proposedG,
          status: castPlanLine.status,
          castId: castPlanLine.castId,
          castNumber: cast.number,
          castStatus: cast.status,
          note: castPlanLine.note,
        })
        .from(castPlanLine)
        .leftJoin(cast, and(eq(cast.id, castPlanLine.castId), eq(cast.companyId, castPlanLine.companyId)))
        .where(and(eq(castPlanLine.companyId, ctx.companyId), gte(castPlanLine.day, input.from), lte(castPlanLine.day, input.to)))
        .orderBy(asc(castPlanLine.day), asc(castPlanLine.alloy), asc(castPlanLine.createdAt))
        .limit(500);

      const alloys = await ctx.db
        .select({ id: alloy.id, code: alloy.code })
        .from(alloy)
        .where(and(eq(alloy.companyId, ctx.companyId), eq(alloy.status, "active")));
      const alloyIdOf = new Map(alloys.map((a) => [a.code, a.id]));

      return {
        from: input.from,
        to: input.to,
        castSizeG,
        truncated,
        plans: planRows,
        rows: plan.rows.map((r) => ({ ...r, alloyId: alloyIdOf.get(r.alloy) ?? null })),
        totals: plan.totals,
        lines,
      };
    }),

    /** Accept a proposal line (the weight may be edited before it is accepted). */
    accept: actionProcedure("foundry.plan")
      .input(z.object({ day, alloyId: id, kgG: grams, proposedG: z.number().int().min(0).max(500_000_000), note }))
      .mutation(async ({ ctx, input }) => {
        const [a] = await ctx.db
          .select({ id: alloy.id, code: alloy.code, status: alloy.status })
          .from(alloy)
          .where(and(eq(alloy.id, input.alloyId), eq(alloy.companyId, ctx.companyId)))
          .limit(1);
        if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Alloy not found" });
        if (a.status !== "active") bad(`Alloy ${a.code} is retired`);
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const rowId = crypto.randomUUID();
        await atomicBatch(ctx.db, [
          ctx.db.insert(castPlanLine).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            day: input.day,
            alloyId: a.id,
            alloy: a.code,
            kgG: input.kgG,
            proposedG: input.proposedG,
            status: "accepted",
            note: input.note || null,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "foundry.castPlan.accept", subjectType: "cast_plan_line", subjectId: rowId, meta: { day: input.day, alloy: a.code, kgG: input.kgG, proposedG: input.proposedG } }),
        ]);
        return { id: rowId };
      }),

    /** Change an accepted line's weight, day or note. An opened or dropped line stays as it is. */
    update: actionProcedure("foundry.plan")
      .input(z.object({ id, kgG: grams, day, note }))
      .mutation(async ({ ctx, input }) => {
        const l = await loadLine(ctx, input.id);
        if (l.status !== "accepted") bad("Only an accepted plan line can be changed");
        try {
          await atomicBatch(ctx.db, [
            stillAccepted(ctx.db, ctx.companyId, l.id),
            ctx.db
              .update(castPlanLine)
              .set({ kgG: input.kgG, day: input.day, note: input.note || null })
              .where(and(eq(castPlanLine.id, l.id), eq(castPlanLine.companyId, ctx.companyId))),
            auditInsert(ctx, { action: "foundry.castPlan.update", subjectType: "cast_plan_line", subjectId: l.id, meta: { alloy: l.alloy, from: { day: l.day, kgG: l.kgG }, to: { day: input.day, kgG: input.kgG } } }),
          ]);
        } catch (e) {
          if (isFoundryAbort(e)) bad("Only an accepted plan line can be changed");
          throw e;
        }
        return { id: l.id };
      }),

    /** Drop an accepted line (it no longer counts as metal to come). */
    drop: actionProcedure("foundry.plan")
      .input(z.object({ id, note }))
      .mutation(async ({ ctx, input }) => {
        const l = await loadLine(ctx, input.id);
        if (l.status !== "accepted") bad("Only an accepted plan line can be dropped");
        try {
          await atomicBatch(ctx.db, [
            stillAccepted(ctx.db, ctx.companyId, l.id),
            ctx.db
              .update(castPlanLine)
              .set({ status: "dropped", note: input.note || l.note })
              .where(and(eq(castPlanLine.id, l.id), eq(castPlanLine.companyId, ctx.companyId))),
            auditInsert(ctx, { action: "foundry.castPlan.drop", subjectType: "cast_plan_line", subjectId: l.id, meta: { day: l.day, alloy: l.alloy, kgG: l.kgG, note: input.note ?? null } }),
          ]);
        } catch (e) {
          if (isFoundryAbort(e)) bad("Only an accepted plan line can be dropped");
          throw e;
        }
        return { id: l.id };
      }),

    /**
     * Open a cast from an accepted line: the cast (its number from the doc series, as `casts.open` does),
     * the line marked opened with the cast, and both audit rows, in one batch that aborts if the line was
     * opened or dropped meanwhile.
     */
    open: actionProcedure("cast.enter")
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        const l = await loadLine(ctx, input.id);
        if (l.status !== "accepted") bad("Only an accepted plan line can open a cast");
        let alloyId: string | null = null;
        if (l.alloyId) {
          const [a] = await ctx.db
            .select({ id: alloy.id, code: alloy.code, status: alloy.status })
            .from(alloy)
            .where(and(eq(alloy.id, l.alloyId), eq(alloy.companyId, ctx.companyId)))
            .limit(1);
          if (a && a.status !== "active") bad(`Alloy ${a.code} is retired`);
          alloyId = a?.id ?? null;
        }
        const userId = ctx.session.user.id;
        const at = clockNow();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const doc = await nextDocNumber(ctx.db, ctx.companyId, "cast", at, userId);
        const castId = crypto.randomUUID();
        try {
          await atomicBatch(ctx.db, [
            stillAccepted(ctx.db, ctx.companyId, l.id),
            ctx.db.insert(cast).values({
              id: castId,
              companyId: ctx.companyId,
              serverSeq: seq,
              number: doc.number,
              period: doc.period,
              year: Number(doc.period.slice(0, 4)),
              month: Number(doc.period.slice(5, 7)),
              seq: doc.seq,
              alloy: l.alloy,
              alloyId,
              status: "open",
              notes: l.note,
              openedAt: at,
              createdBy: userId,
            }),
            ...defaultReturnStreamStatements(ctx.db, ctx.companyId, { userId, seq }),
            ctx.db
              .update(castPlanLine)
              .set({ status: "opened", castId })
              .where(and(eq(castPlanLine.id, l.id), eq(castPlanLine.companyId, ctx.companyId))),
            auditInsert(ctx, { action: "cast.open", subjectType: "cast", subjectId: castId, meta: { number: doc.number, period: doc.period, alloy: l.alloy, planLineId: l.id } }),
            auditInsert(ctx, { action: "foundry.castPlan.open", subjectType: "cast_plan_line", subjectId: l.id, meta: { cast: doc.number, day: l.day, alloy: l.alloy, kgG: l.kgG } }),
          ]);
        } catch (e) {
          if (isFoundryAbort(e)) bad("Only an accepted plan line can open a cast");
          throw e;
        }
        return { castId, number: doc.number };
      }),
  }),
};
