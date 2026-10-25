/**
 * Ageing (FP-AG, W3-AG-S): ovens, trolleys and cycle recipes; the trolley batch from load to close;
 * the temperature log (typed, collector, simulator); hardness; release, hold, override, rework,
 * discard, split, void; the order view, the bundle trace and pack's source list.
 *
 * Contracts: `lib/ageingContracts.ts` (inputs, answers, procedure → permission). Rules: `@orrn/domain`
 * ageing (pure). Sentences: `lib/ageingRefusals.ts` (`ageingRefusal(code)`; the router never writes its
 * own). D1 has no transactions: every write reads first, then lands as one `atomicBatch` whose guards
 * sit in the WHERE clauses plus `ageingAbortUnless` statements, so a write that lost a race leaves
 * nothing behind. Replays: `clientMutationId` on load / start / out / hardness / release is the audit
 * row's id (`lib/requestReplay.ts`); a typed reading's is the temp_log row's own unique key.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import {
  ageingBatch,
  ageingHardness,
  ageingOven,
  ageingRecipe,
  ageingRow,
  ageingTempLog,
  trolley,
  type AgeingBatchRow,
  type AgeingRowRow,
} from "@orrn/db/schema/ageing";
import { die } from "@orrn/db/schema/catalog";
import { cast as castTable } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { env } from "@orrn/env/server";
import {
  AGEING_OPEN_BATCH_STATUSES,
  AGEING_RECIPE_SUGGESTIONS,
  ageingAnyMoved,
  ageingAnyPacked,
  ageingDiscardGate,
  ageingGasWarning,
  ageingHardnessGates,
  ageingHoldGates,
  ageingLoadGates,
  ageingLoadKgG,
  ageingReadingGates,
  ageingRecipeErrors,
  ageingReleasePlan,
  ageingReworkPlan,
  ageingRowRemaining,
  ageingSplitPlan,
  ageingStartGates,
  ageingTakeOutGates,
  ageingUnholdPlan,
  ageingVoidGates,
  bundleAgeingState,
  bundleEligibility,
  hardnessSamplePass,
  hardnessSummary,
  normalizeAgeingCode,
  pressLineEligibility,
  readFloorSettings,
  type AgeingRefusalCode,
  type AgeingRejectCode,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { ageingAbortUnless, ageingReopenBlocker, closeEmptyStatements, isAgeingAbort, isUniqueOn, lineLoadedPcsSql, openBundleRows, pressLinesLoaded, pressLinesNotOverloadedSql, remainingOf } from "../lib/ageing";
import {
  ageingAvailableBundlesInput,
  ageingAvailableLinesInput,
  ageingBatchIdInput,
  ageingBundleTraceInput,
  ageingDiscardRemainingInput,
  ageingForOrderInput,
  ageingHardnessInput,
  ageingHoldInput,
  ageingListInput,
  ageingLoadInput,
  ageingOutInput,
  ageingOvenSaveInput,
  ageingOverrideRequestInput,
  ageingPackSourceInput,
  ageingRecipeSaveInput,
  ageingReworkInput,
  ageingSimulateInput,
  ageingSplitInput,
  ageingStartInput,
  ageingTempInput,
  ageingUnholdInput,
  ageingVoidInput,
  idInput,
  masterListInput,
  trolleySaveInput,
  type AgeingAvailableLine,
  type AgeingBundleTrace,
  type AgeingForOrderLine,
  type AgeingPackSourceRow,
} from "../lib/ageingContracts";
import { ageingRefusal } from "../lib/ageingRefusals";
import {
  activeRecipe,
  afterReleaseStatements,
  batchDetail,
  batchNames,
  ingestAgeingReadings,
  readBatch,
  readReadings,
  readRows,
  readSamples,
  reasonOfKind,
  rejectReasonIds,
  releaseBundleRowStatements,
  rowHardness,
  ruleOf,
  sectionLabel,
  soakOf,
  soakStartStatement,
  summaryOf,
  type RowRead,
} from "../lib/ageingServer";
import { ovenSimulatorEnabled, ovenSimulatorProfile, simulatedReadings } from "../lib/ageingSimulator";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, chunk, IN_LIST_CHUNK, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { can } from "../lib/permissions";
import { registerReopenBlocker } from "../lib/press/reopenBlockers";
import { companySettings, shiftAt } from "../lib/press";
import { ensureDefaultReasonCodes } from "../lib/reasonCodes";
import { lostReplayRace, openReplay, readReplay, replayMeta, type Replay, type ReplayKind } from "../lib/requestReplay";
import { nextCompanySeq } from "../lib/sequence";

// A press run with pieces on a live trolley row is not reopened (press.runs.reopen → CONFLICT).
registerReopenBlocker(ageingReopenBlocker);

const ms = (v: Date | number | null | undefined) => (v == null ? null : v instanceof Date ? v.getTime() : Number(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));

type Ctx = {
  db: OrrnDb;
  companyId: string;
  role: string;
  session: { user: { id: string } };
  impersonation?: unknown;
};
const meOf = (ctx: { role: string }) => ({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }) as Parameters<typeof can>[0];
const userOf = (ctx: Ctx) => ctx.session.user.id;
const audit = (ctx: Ctx) => ctx as unknown as Parameters<typeof auditInsert>[0];
const simulatorOn = () => ovenSimulatorEnabled(env as never);

function forbid(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
}

/** Throws the first refusal of a gate list (screen order); `vars` fill the sentence. */
function refuse(codes: readonly AgeingRefusalCode[], vars: Record<string, string | number> = {}): void {
  if (codes.length > 0) throw ageingRefusal(codes[0]!, vars);
}

async function detail(ctx: Ctx, batchId: string) {
  return batchDetail(ctx.db, ctx.companyId, await readBatch(ctx.db, ctx.companyId, batchId), { nowMs: clockNow().getTime(), simulator: simulatorOn() });
}

/** Opens the replay record of a floor write (null when the caller sent no id). */
async function replayOf(ctx: Ctx, kind: ReplayKind, clientMutationId: string | undefined, content: unknown): Promise<Replay | null> {
  return clientMutationId ? openReplay(ctx.db, ctx.companyId, kind, clientMutationId, content) : null;
}

/** Run the batch; an identical replay that landed first answers its own result. */
async function runWrite<T>(ctx: Ctx, statements: SqliteBatchItem[], replay: Replay | null, onReplay: (subjectId: string) => Promise<T>, onAbort?: () => Promise<never>): Promise<T | null> {
  try {
    await atomicBatch(ctx.db, statements);
    return null;
  } catch (e) {
    if (lostReplayRace(e, replay)) {
      const again = await readReplay(ctx.db, ctx.companyId, replay!);
      if (again.priorSubjectId) return onReplay(again.priorSubjectId);
    }
    if (onAbort && isAgeingAbort(e)) await onAbort();
    throw e;
  }
}

/** The sentence for a batch whose status moved under this write. */
async function statusRace(ctx: Ctx, batchId: string): Promise<never> {
  const b = await readBatch(ctx.db, ctx.companyId, batchId);
  throw ageingRefusal("wrong_status", { batch: b.number, status: b.status });
}

const batchLanded = (companyId: string, batchId: string, seq: number, statuses: readonly string[]) =>
  sql`exists (select 1 from ageing_batch b where b.company_id = ${companyId} and b.id = ${batchId} and b.server_seq = ${seq}
    and b.status in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)}))`;

// ---------------------------------------------------------------------------
// Masters (FP-AG-01..03)
// ---------------------------------------------------------------------------

/** masters.draft saves a draft; anything else (activate, archive, out of service, edit a live row) is masters.publish. */
function assertMasterAction(ctx: Ctx, nextStatus: string, prevStatus: string | null) {
  const publish = nextStatus !== "draft" || (prevStatus != null && prevStatus !== "draft");
  if (publish && !can(meOf(ctx), "masters.publish")) forbid();
  if (!publish && !can(meOf(ctx), "masters.draft") && !can(meOf(ctx), "masters.publish")) forbid();
}

function codeOf(raw: string): string {
  const c = normalizeAgeingCode(raw);
  if (!c) throw ageingRefusal("code_invalid");
  return c;
}

const masterRead = anyActionProcedure("ageing.view", "masters.draft");
const masterWrite = anyActionProcedure("masters.draft", "masters.publish");

const ovensRouter = router({
  list: masterRead.input(masterListInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(ageingOven)
      .where(and(eq(ageingOven.companyId, ctx.companyId), input.includeInactive ? undefined : eq(ageingOven.status, "active")))
      .orderBy(asc(ageingOven.sortOrder), asc(ageingOven.code));
    const busy = await ctx.db
      .select({ ovenId: ageingBatch.ovenId, number: ageingBatch.number, id: ageingBatch.id })
      .from(ageingBatch)
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.status, "in_oven")));
    const byOven = new Map(busy.map((b) => [b.ovenId, b]));
    return { items: rows.map((o) => ({ ...o, busyBatchId: byOven.get(o.id)?.id ?? null, busyBatchNumber: byOven.get(o.id)?.number ?? null })) };
  }),
  get: masterRead.input(idInput).query(async ({ ctx, input }) => {
    const [o] = await ctx.db.select().from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, input.id))).limit(1);
    if (!o) throw ageingRefusal("oven_not_found");
    return o;
  }),
  save: masterWrite.input(ageingOvenSaveInput).mutation(async ({ ctx, input }) => {
    const code = codeOf(input.code);
    const prev = input.id
      ? (await ctx.db.select().from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, input.id))).limit(1))[0]
      : undefined;
    if (input.id && !prev) throw ageingRefusal("oven_not_found");
    assertMasterAction(ctx, input.status, prev?.status ?? null);
    const [taken] = await ctx.db
      .select({ id: ageingOven.id })
      .from(ageingOven)
      .where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.code, code), input.id ? ne(ageingOven.id, input.id) : undefined))
      .limit(1);
    if (taken) throw ageingRefusal("code_taken", { code });
    if (prev && input.status !== "active") {
      const [inOven] = await ctx.db
        .select({ number: ageingBatch.number })
        .from(ageingBatch)
        .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.ovenId, prev.id), eq(ageingBatch.status, "in_oven")))
        .limit(1);
      if (inOven) throw ageingRefusal("oven_in_use", { oven: prev.code });
    }
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const id = prev?.id ?? crypto.randomUUID();
    const values = {
      code,
      name: input.name ?? null,
      capacityG: input.capacityG ?? null,
      maxTempX10: input.maxTempX10 ?? null,
      meterUnit: input.meterUnit,
      status: input.status,
      note: input.note ?? null,
      sortOrder: input.sortOrder ?? prev?.sortOrder ?? 0,
      serverSeq: seq,
    };
    try {
      await atomicBatch(ctx.db, [
        prev
          ? ctx.db.update(ageingOven).set(values).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, id)))
          : ctx.db.insert(ageingOven).values({ id, companyId: ctx.companyId, createdBy: userOf(ctx), ...values }),
        // Review m6: a start that put a batch in this oven after the read fails the status change whole.
        ...(prev && input.status !== "active"
          ? [ageingAbortUnless(ctx.db, sql`not exists (select 1 from ageing_batch b where b.company_id = ${ctx.companyId} and b.oven_id = ${prev.id} and b.status = 'in_oven')`)]
          : []),
        auditInsert(audit(ctx), { action: prev ? "ageing.oven.update" : "ageing.oven.create", subjectType: "ageing_oven", subjectId: id, meta: { code, status: input.status, from: prev?.status ?? null } }),
      ]);
    } catch (e) {
      if (prev && isAgeingAbort(e)) throw ageingRefusal("oven_in_use", { oven: prev.code });
      throw e;
    }
    return { id, code, status: input.status };
  }),
});

const trolleysRouter = router({
  list: masterRead.input(masterListInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(trolley)
      .where(and(eq(trolley.companyId, ctx.companyId), input.includeInactive ? undefined : eq(trolley.status, "active")))
      .orderBy(asc(trolley.sortOrder), asc(trolley.code));
    const open = await ctx.db
      .select({ trolleyId: ageingBatch.trolleyId, id: ageingBatch.id, number: ageingBatch.number, status: ageingBatch.status })
      .from(ageingBatch)
      .where(and(eq(ageingBatch.companyId, ctx.companyId), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES])));
    const byTrolley = new Map(open.map((b) => [b.trolleyId, b]));
    return {
      items: rows.map((t) => ({
        ...t,
        openBatchId: byTrolley.get(t.id)?.id ?? null,
        openBatchNumber: byTrolley.get(t.id)?.number ?? null,
        openBatchStatus: byTrolley.get(t.id)?.status ?? null,
      })),
    };
  }),
  get: masterRead.input(idInput).query(async ({ ctx, input }) => {
    const [t] = await ctx.db.select().from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, input.id))).limit(1);
    if (!t) throw ageingRefusal("trolley_not_found");
    return t;
  }),
  save: masterWrite.input(trolleySaveInput).mutation(async ({ ctx, input }) => {
    const code = codeOf(input.code);
    const prev = input.id
      ? (await ctx.db.select().from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, input.id))).limit(1))[0]
      : undefined;
    if (input.id && !prev) throw ageingRefusal("trolley_not_found");
    assertMasterAction(ctx, input.status, prev?.status ?? null);
    const [taken] = await ctx.db
      .select({ id: trolley.id })
      .from(trolley)
      .where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.code, code), input.id ? ne(trolley.id, input.id) : undefined))
      .limit(1);
    if (taken) throw ageingRefusal("code_taken", { code });
    if (prev && input.status !== "active") {
      const [open] = await ctx.db
        .select({ number: ageingBatch.number })
        .from(ageingBatch)
        .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, prev.id), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES])))
        .limit(1);
      if (open) throw ageingRefusal("trolley_in_use", { code: prev.code, batch: open.number });
    }
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const id = prev?.id ?? crypto.randomUUID();
    const values = { code, capacityG: input.capacityG ?? null, status: input.status, note: input.note ?? null, sortOrder: input.sortOrder ?? prev?.sortOrder ?? 0, serverSeq: seq };
    try {
      await atomicBatch(ctx.db, [
        prev
          ? ctx.db.update(trolley).set(values).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, id)))
          : ctx.db.insert(trolley).values({ id, companyId: ctx.companyId, createdBy: userOf(ctx), ...values }),
        // Review m6: a load that opened a batch on this trolley after the read fails the status change whole.
        ...(prev && input.status !== "active"
          ? [
              ageingAbortUnless(
                ctx.db,
                sql`not exists (select 1 from ageing_batch b where b.company_id = ${ctx.companyId} and b.trolley_id = ${prev.id} and b.status in ('loading','in_oven','out','released','held'))`,
              ),
            ]
          : []),
        auditInsert(audit(ctx), { action: prev ? "ageing.trolley.update" : "ageing.trolley.create", subjectType: "trolley", subjectId: id, meta: { code, status: input.status, from: prev?.status ?? null } }),
      ]);
    } catch (e) {
      if (prev && isAgeingAbort(e)) {
        const [open] = await ctx.db.select({ number: ageingBatch.number }).from(ageingBatch).where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, prev.id), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES]))).limit(1);
        throw ageingRefusal("trolley_in_use", { code: prev.code, batch: open?.number ?? "" });
      }
      throw e;
    }
    return { id, code, status: input.status };
  }),
});

const RECIPE_NUMBERS = ["alloy", "temper", "kind", "targetTempX10", "toleranceX10", "soakMin", "maxSoakMin", "hardnessMethod", "hardnessMinX10", "hardnessMaxX10", "sampleCount"] as const;

const recipesRouter = router({
  list: masterRead.input(masterListInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(ageingRecipe)
      .where(and(eq(ageingRecipe.companyId, ctx.companyId), input.includeInactive ? undefined : eq(ageingRecipe.status, "active")))
      .orderBy(asc(ageingRecipe.alloy), asc(ageingRecipe.temper), asc(ageingRecipe.kind), desc(ageingRecipe.createdAt));
    return { items: rows };
  }),
  get: masterRead.input(idInput).query(async ({ ctx, input }) => {
    const [r] = await ctx.db.select().from(ageingRecipe).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, input.id))).limit(1);
    if (!r) throw ageingRefusal("recipe_not_found");
    return r;
  }),
  /** Spec §3 suggested drafts; writes nothing (the office saves the ones it wants as drafts). */
  suggest: actionProcedure("masters.draft").query(() => ({ items: [...AGEING_RECIPE_SUGGESTIONS] })),
  save: masterWrite.input(ageingRecipeSaveInput).mutation(async ({ ctx, input }) => {
    const prev = input.id
      ? (await ctx.db.select().from(ageingRecipe).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, input.id))).limit(1))[0]
      : undefined;
    if (input.id && !prev) throw ageingRefusal("recipe_not_found");
    assertMasterAction(ctx, input.status, prev?.status ?? null);
    const numbers = {
      alloy: input.alloy.trim().toUpperCase(),
      temper: input.temper.trim().toUpperCase(),
      kind: input.kind,
      targetTempX10: input.targetTempX10,
      toleranceX10: input.toleranceX10,
      soakMin: input.soakMin,
      maxSoakMin: input.maxSoakMin ?? null,
      hardnessMethod: input.hardnessMethod,
      hardnessMinX10: input.hardnessMinX10,
      hardnessMaxX10: input.hardnessMaxX10 ?? null,
      sampleCount: input.sampleCount,
    };
    refuse(ageingRecipeErrors(numbers));
    // An active (or archived) recipe's numbers never change in place: snapshots stay honest.
    if (prev && prev.status !== "draft" && RECIPE_NUMBERS.some((k) => (prev[k] ?? null) !== (numbers[k] ?? null))) throw ageingRefusal("recipe_active_locked");
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const id = prev?.id ?? crypto.randomUUID();
    const statements: SqliteBatchItem[] = [];
    if (input.status === "active") {
      // Publishing archives the live recipe of the same alloy, temper and kind in the same batch.
      statements.push(
        ctx.db
          .update(ageingRecipe)
          .set({ status: "archived", serverSeq: seq })
          .where(
            and(
              eq(ageingRecipe.companyId, ctx.companyId),
              eq(ageingRecipe.alloy, numbers.alloy),
              eq(ageingRecipe.temper, numbers.temper),
              eq(ageingRecipe.kind, numbers.kind),
              eq(ageingRecipe.status, "active"),
              ne(ageingRecipe.id, id),
            ),
          ),
      );
    }
    const values = { ...numbers, status: input.status, note: input.note ?? null, serverSeq: seq };
    statements.push(
      prev
        ? ctx.db.update(ageingRecipe).set(values).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, id)))
        : ctx.db.insert(ageingRecipe).values({ id, companyId: ctx.companyId, createdBy: userOf(ctx), ...values }),
      auditInsert(audit(ctx), {
        action: prev ? "ageing.recipe.update" : "ageing.recipe.create",
        subjectType: "ageing_recipe",
        subjectId: id,
        meta: { ...numbers, status: input.status, from: prev?.status ?? null },
      }),
    );
    await atomicBatch(ctx.db, statements);
    return { id, status: input.status };
  }),
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

type LineRead = {
  id: string;
  run_id: string;
  run_number: string;
  run_status: string;
  section_id: string;
  die_instance_id: string | null;
  die_instance_code: string | null;
  cast_id: string | null;
  cast_code: string | null;
  alloy: string | null;
  temper: string | null;
  cut_length_mm: number;
  pcs: number;
  good_g: number;
  sales_order_line_id: string | null;
  sales_order_id: string | null;
  sales_order_number: string | null;
  customer_name: string | null;
  die_name: string | null;
  series: string | null;
  section_code: string | null;
};

const lineSelect = (companyId: string, where: SQL) => sql`
  select l.id, r.id as run_id, r.number as run_number, r.status as run_status, r.section_id, r.die_instance_id, di.code as die_instance_code,
    r.cast_id, c.number as cast_code, c.alloy, coalesce(sol.temper, d.temper) as temper, l.cut_length_mm, l.pcs, l.good_g,
    l.sales_order_line_id, sol.sales_order_id, so.number as sales_order_number, cu.name as customer_name,
    d.name as die_name, d.series, d.section_code
  from press_run_line l
  join press_run r on r.id = l.press_run_id and r.company_id = l.company_id
  join die d on d.id = r.section_id and d.company_id = r.company_id
  left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
  left join cast c on c.id = r.cast_id and c.company_id = r.company_id
  left join sales_order_line sol on sol.id = l.sales_order_line_id and sol.company_id = l.company_id
  left join sales_order so on so.id = sol.sales_order_id and so.company_id = l.company_id
  left join customer cu on cu.id = so.customer_id and cu.company_id = l.company_id
  where l.company_id = ${companyId} and ${where}`;

async function readLines(db: OrrnDb, companyId: string, ids: readonly string[]): Promise<Map<string, LineRead>> {
  const out = new Map<string, LineRead>();
  for (const part of chunk([...new Set(ids)], IN_LIST_CHUNK)) {
    const rows = await db.all<LineRead>(lineSelect(companyId, sql`l.id in (${sql.join(part.map((i) => sql`${i}`), sql`, `)})`));
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

const ROW_DEFAULTS = {
  pressRunId: null,
  pressRunLineId: null,
  bundleId: null,
  dieInstanceId: null,
  castId: null,
  salesOrderId: null,
  salesOrderLineId: null,
  customerPo: null,
  packedPcs: 0,
  scrapPcs: 0,
  reworkPcs: 0,
  status: "pending" as const,
  holdReasonCodeId: null,
  holdNote: null,
  hardnessMethod: null,
  hardnessReadingX10: null,
  hardnessPass: null,
  reworkRowId: null,
};

type NewRow = Omit<typeof ageingRow.$inferInsert, "createdAt" | "updatedAt">;

const loadProcedure = actionProcedure("ageing.load")
  .input(ageingLoadInput)
  .mutation(async ({ ctx, input }) => {
    const { clientMutationId, ...content } = input;
    const replay = await replayOf(ctx, "ageing.load", clientMutationId, content);
    if (replay?.priorSubjectId) return { ...(await detail(ctx, replay.priorSubjectId)), replayed: true };
    const settings = await companySettings(ctx.db, ctx.companyId);
    const floor = readFloorSettings(settings);

    const [t] = await ctx.db.select().from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, input.trolleyId))).limit(1);
    if (!t) throw ageingRefusal("trolley_not_found");
    const [open] = await ctx.db
      .select()
      .from(ageingBatch)
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, t.id), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES])))
      .limit(1);
    let batch: AgeingBatchRow | null = null;
    if (input.batchId) {
      batch = await readBatch(ctx.db, ctx.companyId, input.batchId);
      if (batch.trolleyId !== t.id) throw ageingRefusal("trolley_busy", { code: t.code, batch: open?.number ?? batch.number });
    } else if (open?.status === "loading") batch = open;
    const trolleyBusy = !batch && open != null;
    const rowCount = input.rows.length + input.manual.length + input.bundles.length;
    refuse(
      ageingLoadGates({ batchStatus: batch?.status ?? null, trolleyStatus: t.status, trolleyBusy, rowCount, manualRows: input.manual.length, manualLoad: floor.ageing.manualLoad }),
      { code: t.code, batch: (batch ?? open)?.number ?? "", status: batch?.status ?? "" },
    );
    const recipeId = input.recipeId ?? batch?.recipeId ?? null;
    const recipe = recipeId
      ? (await ctx.db.select().from(ageingRecipe).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, recipeId))).limit(1))[0]
      : null;
    if (recipeId && !recipe) throw ageingRefusal("recipe_not_found");
    const match = recipe ? { alloy: recipe.alloy, temper: recipe.temper } : null;

    const userId = userOf(ctx);
    const batchId = batch?.id ?? crypto.randomUUID();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const [maxSort] = batch
      ? await ctx.db.all<{ n: number }>(sql`select coalesce(max(sort_order), 0) as n from ageing_row where company_id = ${ctx.companyId} and batch_id = ${batch.id}`)
      : [{ n: 0 }];
    let sort = num(maxSort?.n);
    const rows: NewRow[] = [];

    // Press lines: logged, pieces within what the line has left, grams prorated so a fully loaded line sums back.
    const lines = await readLines(ctx.db, ctx.companyId, input.rows.map((r) => r.pressRunLineId));
    const loaded = await pressLinesLoaded(ctx.db, ctx.companyId, input.rows.map((r) => r.pressRunLineId));
    for (const r of input.rows) {
      const l = lines.get(r.pressRunLineId);
      if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
      const was = loaded.get(l.id) ?? { pcs: 0, kgG: 0 };
      const gate = pressLineEligibility({ runStatus: l.run_status, linePcs: num(l.pcs), loadedPcs: was.pcs, takePcs: r.pcs, alloy: l.alloy, temper: l.temper, recipe: match });
      if (gate) throw ageingRefusal(gate, { run: l.run_number, n: Math.max(0, num(l.pcs) - was.pcs), cast: l.cast_code ?? "", alloy: l.alloy ?? "", recipeAlloy: match?.alloy ?? "", temper: l.temper ?? "", recipeTemper: match?.temper ?? "" });
      const kgG = ageingLoadKgG({ lineGoodG: num(l.good_g), linePcs: num(l.pcs), loadedPcs: was.pcs, loadedKgG: was.kgG, takePcs: r.pcs });
      loaded.set(l.id, { pcs: was.pcs + r.pcs, kgG: was.kgG + kgG });
      const solId = r.salesOrderLineId ?? l.sales_order_line_id;
      sort += 1;
      rows.push({
        ...ROW_DEFAULTS,
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        batchId,
        source: "press",
        pressRunId: l.run_id,
        pressRunLineId: l.id,
        dieId: l.section_id,
        dieInstanceId: l.die_instance_id,
        castId: l.cast_id,
        salesOrderId: solId === l.sales_order_line_id ? l.sales_order_id : null,
        salesOrderLineId: solId,
        lengthMm: num(l.cut_length_mm),
        pcs: r.pcs,
        kgG,
        sortOrder: sort,
        createdBy: userId,
      });
    }

    // Typed lines (setting ageing.manualLoad): marked manual, never a press line.
    for (const m of input.manual) {
      const [d] = await ctx.db.select({ id: die.id }).from(die).where(and(eq(die.companyId, ctx.companyId), eq(die.id, m.dieId))).limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      if (m.castId && match) {
        const [c] = await ctx.db.select({ alloy: castTable.alloy, number: castTable.number }).from(castTable).where(and(eq(castTable.companyId, ctx.companyId), eq(castTable.id, m.castId))).limit(1);
        if (c?.alloy && c.alloy.trim().toUpperCase() !== match.alloy.trim().toUpperCase()) throw ageingRefusal("alloy_mismatch", { cast: c.number, alloy: c.alloy, recipeAlloy: match.alloy });
      }
      sort += 1;
      rows.push({
        ...ROW_DEFAULTS,
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        batchId,
        source: "manual",
        dieId: m.dieId,
        dieInstanceId: m.dieInstanceId ?? null,
        castId: m.castId ?? null,
        salesOrderLineId: m.salesOrderLineId ?? null,
        customerPo: m.customerPo ?? null,
        lengthMm: m.lengthMm,
        pcs: m.pcs,
        kgG: m.kgG,
        sortOrder: sort,
        createdBy: userId,
      });
    }

    // Whole bundles: in stock, never aged, not on another trolley; packed_pcs starts at 0 (review I3).
    const bundleIds = input.bundles.map((b) => b.bundleId);
    if (new Set(bundleIds).size !== bundleIds.length) throw ageingRefusal("bundle_on_batch", { serial: "", batch: batch?.number ?? "" });
    const onTrolley = await openBundleRows(ctx.db, ctx.companyId, bundleIds);
    for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
      const found = await ctx.db.all<{
        id: string;
        serial: string;
        status: string;
        ageing_row_id: string | null;
        die_id: string;
        die_instance_id: string | null;
        cast_id: string | null;
        alloy: string | null;
        temper: string | null;
        length_mm: number | null;
        quantity: number;
        weight_g: number;
        sol_id: string | null;
        so_id: string | null;
        po_number: string | null;
      }>(sql`select b.id, b.serial, b.status, b.ageing_row_id, b.die_id, b.die_instance_id, b.cast_id, c.alloy, coalesce(sol.temper, d.temper) as temper,
          b.length_mm, b.quantity, b.weight_g, coalesce(b.packed_sales_order_line_id, b.sales_order_line_id) as sol_id, sol.sales_order_id as so_id, b.po_number
        from bundle b join die d on d.id = b.die_id and d.company_id = b.company_id
        left join cast c on c.id = b.cast_id and c.company_id = b.company_id
        left join sales_order_line sol on sol.id = coalesce(b.packed_sales_order_line_id, b.sales_order_line_id) and sol.company_id = b.company_id
        where b.company_id = ${ctx.companyId} and b.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      const byId = new Map(found.map((b) => [b.id, b]));
      for (const bid of ids) {
        const b = byId.get(bid);
        if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
        const other = onTrolley.get(b.id);
        const gate = bundleEligibility({ status: b.status, ageingRowId: b.ageing_row_id, onOpenBatch: other != null, alloy: b.alloy, temper: b.temper, recipe: match });
        if (gate) throw ageingRefusal(gate, { serial: b.serial, batch: other?.batchNumber ?? "", cast: b.cast_id ?? "", alloy: b.alloy ?? "", recipeAlloy: match?.alloy ?? "", temper: b.temper ?? "", recipeTemper: match?.temper ?? "" });
        sort += 1;
        rows.push({
          ...ROW_DEFAULTS,
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          batchId,
          source: "bundle",
          bundleId: b.id,
          dieId: b.die_id,
          dieInstanceId: b.die_instance_id,
          castId: b.cast_id,
          salesOrderId: b.so_id,
          salesOrderLineId: b.sol_id,
          customerPo: b.po_number,
          lengthMm: num(b.length_mm) || 1,
          pcs: num(b.quantity),
          kgG: num(b.weight_g),
          sortOrder: sort,
          createdBy: userId,
        });
      }
    }

    const statements: SqliteBatchItem[] = [];
    let number = batch?.number ?? "";
    if (!batch) {
      number = (await nextDocNumber(ctx.db, ctx.companyId, "ageing", clockNow(), userId)).number;
      statements.push(
        ctx.db.insert(ageingBatch).values({
          id: batchId,
          companyId: ctx.companyId,
          serverSeq: seq,
          number,
          status: "loading",
          trolleyId: t.id,
          recipeId,
          clientMutationId: clientMutationId ?? null,
          createdBy: userId,
        }),
      );
    } else {
      if (input.recipeId && input.recipeId !== batch.recipeId) {
        statements.push(ctx.db.update(ageingBatch).set({ recipeId: input.recipeId, serverSeq: seq }).where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, batch.id))));
      }
      statements.push(ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_batch b where b.company_id = ${ctx.companyId} and b.id = ${batch.id} and b.status = 'loading')`));
    }
    pushChunkedInserts(statements, (part) => ctx.db.insert(ageingRow).values(part), rows);
    // Review m6: the trolley is still in service at write time (an out-of-service save after the read fails the load).
    statements.push(ageingAbortUnless(ctx.db, sql`exists (select 1 from trolley t where t.company_id = ${ctx.companyId} and t.id = ${t.id} and t.status = 'active')`));
    const lineIds = [...new Set(input.rows.map((r) => r.pressRunLineId))];
    for (const part of chunk(lineIds, IN_LIST_CHUNK - 5)) statements.push(ageingAbortUnless(ctx.db, pressLinesNotOverloadedSql(ctx.companyId, part)));
    for (const part of chunk(bundleIds, IN_LIST_CHUNK - 5)) {
      statements.push(
        ageingAbortUnless(
          ctx.db,
          sql`not exists (select 1 from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
            where r.company_id = ${ctx.companyId} and r.source = 'bundle' and r.status <> 'void' and b.status in ('loading','in_oven','out','released','held')
              and r.bundle_id in (${sql.join(part.map((i) => sql`${i}`), sql`, `)})
            group by r.bundle_id having count(*) > 1)`,
        ),
        // Review m6: still in stock at write time (a dispatch that reserved one after the read fails the load).
        ageingAbortUnless(
          ctx.db,
          sql`not exists (select 1 from bundle b where b.company_id = ${ctx.companyId} and b.id in (${sql.join(part.map((i) => sql`${i}`), sql`, `)}) and b.status <> 'available')`,
        ),
      );
    }
    statements.push(
      auditInsert(audit(ctx), {
        id: replay?.id,
        action: "ageing.load",
        subjectType: "ageing_batch",
        subjectId: batchId,
        meta: { number, trolley: t.code, press: input.rows.length, manual: input.manual.length, bundles: input.bundles.length, pcs: rows.reduce((a, r) => a + r.pcs, 0), ...replayMeta(replay, clientMutationId) },
      }),
    );
    try {
      const replayed = await runWrite(ctx, statements, replay, async (id) => ({ ...(await detail(ctx, id)), replayed: true }));
      if (replayed) return replayed;
    } catch (e) {
      if (isUniqueOn(e, "trolley_id")) {
        const [now] = await ctx.db.select({ number: ageingBatch.number }).from(ageingBatch).where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, t.id), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES]))).limit(1);
        throw ageingRefusal("trolley_busy", { code: t.code, batch: now?.number ?? "" });
      }
      if (isAgeingAbort(e)) {
        const [tNow] = await ctx.db.select({ status: trolley.status }).from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, t.id))).limit(1);
        if (tNow?.status !== "active") throw ageingRefusal("trolley_not_active", { code: t.code });
        if (batch) {
          const b = await readBatch(ctx.db, ctx.companyId, batch.id);
          if (b.status !== "loading") throw ageingRefusal("wrong_status", { batch: b.number, status: b.status });
        }
        for (const ids of chunk(bundleIds, IN_LIST_CHUNK)) {
          const gone = await ctx.db.select({ serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids), ne(bundle.status, "available"))).limit(1);
          if (gone[0]) throw ageingRefusal("bundle_not_available", { serial: gone[0].serial });
        }
        if (bundleIds.length > 0) {
          const now = await openBundleRows(ctx.db, ctx.companyId, bundleIds);
          const hit = [...now.values()].find((r) => r.batchId !== batchId);
          if (hit) throw ageingRefusal("bundle_on_batch", { serial: "", batch: hit.batchNumber });
        }
        const again = await pressLinesLoaded(ctx.db, ctx.companyId, lineIds);
        const l = lines.get(lineIds[0] ?? "");
        throw ageingRefusal("over_line", { n: l ? Math.max(0, num(l.pcs) - (again.get(l.id)?.pcs ?? 0)) : 0 });
      }
      throw e;
    }
    return { ...(await detail(ctx, batchId)), replayed: false };
  });

// ---------------------------------------------------------------------------
// Cycle: start, readings, take out
// ---------------------------------------------------------------------------

const startProcedure = actionProcedure("ageing.load")
  .input(ageingStartInput)
  .mutation(async ({ ctx, input }) => {
    const { clientMutationId, ...content } = input;
    const replay = await replayOf(ctx, "ageing.start", clientMutationId, content);
    if (replay?.priorSubjectId) return { batch: await detail(ctx, replay.priorSubjectId), warning: null, replayed: true };
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    const rows = (await readRows(ctx.db, ctx.companyId, [b.id])).filter((r) => r.status !== "void");
    const [oven] = await ctx.db.select().from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, input.ovenId))).limit(1);
    const [busy] = oven
      ? await ctx.db.select({ id: ageingBatch.id }).from(ageingBatch).where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.ovenId, oven.id), eq(ageingBatch.status, "in_oven"))).limit(1)
      : [];
    const [recipe] = await ctx.db.select().from(ageingRecipe).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, input.recipeId))).limit(1);
    const [t] = await ctx.db.select().from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, b.trolleyId))).limit(1);
    const settings = await companySettings(ctx.db, ctx.companyId);
    const { shifts } = readFloorSettings(settings);
    const shift = shifts.find((s) => s.id === input.shiftId);
    const nowMs = clockNow().getTime();
    const inAt = input.inAt ?? nowMs;
    // Alloy from the row's cast; temper from its order line, else the section.
    const castIds = [...new Set(rows.flatMap((r) => (r.castId ? [r.castId] : [])))];
    const alloyByCast = new Map<string, string | null>();
    for (const ids of chunk(castIds, IN_LIST_CHUNK)) {
      for (const c of await ctx.db.select({ id: castTable.id, alloy: castTable.alloy }).from(castTable).where(and(eq(castTable.companyId, ctx.companyId), inArray(castTable.id, ids)))) alloyByCast.set(c.id, c.alloy);
    }
    const temperRows = await ctx.db.all<{ id: string; temper: string | null }>(
      sql`select r.id, coalesce(sol.temper, d.temper) as temper from ageing_row r join die d on d.id = r.die_id and d.company_id = r.company_id
          left join sales_order_line sol on sol.id = r.sales_order_line_id and sol.company_id = r.company_id
          where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.status <> 'void'`,
    );
    const temperOf = new Map(temperRows.map((r) => [r.id, r.temper]));
    const gates = ageingStartGates({
      batchStatus: b.status,
      rowCount: rows.length,
      oven: oven ? { status: oven.status, busy: busy != null, maxTempX10: oven.maxTempX10 } : null,
      recipe: recipe ? { status: recipe.status, alloy: recipe.alloy, temper: recipe.temper, targetTempX10: recipe.targetTempX10, toleranceX10: recipe.toleranceX10 } : null,
      trolleyStatus: t?.status ?? "out_of_service",
      shiftsConfigured: shifts.length > 0,
      shiftKnown: shift != null,
      rows: rows.map((r) => ({ alloy: r.castId ? (alloyByCast.get(r.castId) ?? null) : null, temper: temperOf.get(r.id) ?? null })),
      inAt,
      now: nowMs,
    });
    const mismatch = rows.find((r) => r.castId && alloyByCast.get(r.castId) && recipe && alloyByCast.get(r.castId)!.toUpperCase() !== recipe.alloy.toUpperCase());
    const temperBad = rows.find((r) => temperOf.get(r.id) && recipe && temperOf.get(r.id)!.toUpperCase() !== recipe.temper.toUpperCase());
    refuse(gates, {
      batch: b.number,
      status: b.status,
      oven: oven?.code ?? "",
      code: t?.code ?? "",
      cast: mismatch?.castCode ?? "",
      alloy: mismatch?.castId ? (alloyByCast.get(mismatch.castId) ?? "") : "",
      recipeAlloy: recipe?.alloy ?? "",
      temper: temperBad ? (temperOf.get(temperBad.id) ?? "") : "",
      recipeTemper: recipe?.temper ?? "",
    });
    const [last] = await ctx.db
      .select({ gasEndMilli: ageingBatch.gasEndMilli })
      .from(ageingBatch)
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.ovenId, oven!.id), sql`${ageingBatch.gasEndMilli} is not null`))
      .orderBy(desc(ageingBatch.inAt))
      .limit(1);
    const warning = ageingGasWarning({ gasStartMilli: input.gasStartMilli, lastGasEndMilli: last?.gasEndMilli ?? null, meterReset: input.meterReset });
    const day = shiftAt(settings, inAt);
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [
      ctx.db
        .update(ageingBatch)
        .set({
          status: "in_oven",
          ovenId: oven!.id,
          recipeId: recipe!.id,
          alloy: recipe!.alloy,
          temper: recipe!.temper,
          targetTempX10: recipe!.targetTempX10,
          toleranceX10: recipe!.toleranceX10,
          soakMin: recipe!.soakMin,
          maxSoakMin: recipe!.maxSoakMin,
          hardnessMethod: recipe!.hardnessMethod,
          hardnessMinX10: recipe!.hardnessMinX10,
          hardnessMaxX10: recipe!.hardnessMaxX10,
          sampleCount: recipe!.sampleCount,
          tempCX10: recipe!.targetTempX10,
          shiftId: shift!.id,
          productionDay: day.productionDay,
          shiftSeq: shift!.seq,
          gasStartMilli: input.gasStartMilli,
          meterReset: input.meterReset,
          inAt: new Date(inAt),
          startedBy: userOf(ctx),
          serverSeq: seq,
        })
        .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, "loading"))),
      ageingAbortUnless(ctx.db, batchLanded(ctx.companyId, b.id, seq, ["in_oven"])),
      // Review m6: the oven and the trolley are still in service at write time.
      ageingAbortUnless(
        ctx.db,
        sql`exists (select 1 from ageing_oven o where o.company_id = ${ctx.companyId} and o.id = ${oven!.id} and o.status = 'active')
          and exists (select 1 from trolley t where t.company_id = ${ctx.companyId} and t.id = ${b.trolleyId} and t.status = 'active')`,
      ),
      // Readings typed before a backdated start count from in_at (none exist yet; kept for symmetry).
      soakStartStatement(ctx.db, ctx.companyId, b.id, seq),
      auditInsert(audit(ctx), {
        id: replay?.id,
        action: "ageing.start",
        subjectType: "ageing_batch",
        subjectId: b.id,
        meta: { number: b.number, oven: oven!.code, recipe: `${recipe!.alloy} ${recipe!.temper} ${recipe!.kind}`, gasStartMilli: input.gasStartMilli, meterReset: input.meterReset, warning, inAt, ...replayMeta(replay, clientMutationId) },
      }),
    ];
    try {
      const replayed = await runWrite(ctx, statements, replay, async (id) => ({ batch: await detail(ctx, id), warning: null, replayed: true }), async () => {
        const [o] = await ctx.db.select({ status: ageingOven.status }).from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, oven!.id))).limit(1);
        if (o?.status !== "active") throw ageingRefusal("oven_not_active", { oven: oven!.code });
        const [tr] = await ctx.db.select({ status: trolley.status, code: trolley.code }).from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, b.trolleyId))).limit(1);
        if (tr && tr.status !== "active") throw ageingRefusal("trolley_not_active", { code: tr.code });
        return statusRace(ctx, b.id);
      });
      if (replayed) return replayed;
    } catch (e) {
      if (isUniqueOn(e, "oven_id")) throw ageingRefusal("oven_busy", { oven: oven!.code });
      throw e;
    }
    return { batch: await detail(ctx, b.id), warning, replayed: false };
  });

const tempProcedure = actionProcedure("ageing.record")
  .input(ageingTempInput)
  .mutation(async ({ ctx, input }) => {
    if (input.clientMutationId) {
      const [prior] = await ctx.db
        .select({ id: ageingTempLog.id, batchId: ageingTempLog.batchId })
        .from(ageingTempLog)
        .where(and(eq(ageingTempLog.companyId, ctx.companyId), eq(ageingTempLog.clientMutationId, input.clientMutationId)))
        .limit(1);
      if (prior) return { id: prior.id, replayed: true, soakStartedAt: ms((await readBatch(ctx.db, ctx.companyId, prior.batchId)).soakStartedAt) };
    }
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    const nowMs = clockNow().getTime();
    const at = input.at ?? nowMs;
    refuse(ageingReadingGates({ batchStatus: b.status, inAt: ms(b.inAt), outAt: ms(b.outAt), at, now: nowMs, source: "typed" }), { batch: b.number, status: b.status });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const id = crypto.randomUUID();
    try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(ageingTempLog).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          batchId: b.id,
          at: new Date(at),
          tempCX10: input.tempCX10,
          source: "typed",
          deviceId: "",
          note: input.note ?? null,
          clientMutationId: input.clientMutationId ?? null,
          createdBy: userOf(ctx),
        }),
        soakStartStatement(ctx.db, ctx.companyId, b.id, seq),
        // Review m3: a typed reading is audited (a replay fails on the reading's unique key, audit row and all).
        auditInsert(audit(ctx), { action: "ageing.temp", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, readingId: id, tempCX10: input.tempCX10, at, note: input.note ?? null } }),
      ]);
    } catch (e) {
      if (input.clientMutationId && isUniqueOn(e, "client_mutation_id")) {
        const [prior] = await ctx.db.select({ id: ageingTempLog.id }).from(ageingTempLog).where(and(eq(ageingTempLog.companyId, ctx.companyId), eq(ageingTempLog.clientMutationId, input.clientMutationId))).limit(1);
        return { id: prior!.id, replayed: true, soakStartedAt: ms((await readBatch(ctx.db, ctx.companyId, b.id)).soakStartedAt) };
      }
      throw e;
    }
    return { id, replayed: false, soakStartedAt: ms((await readBatch(ctx.db, ctx.companyId, b.id)).soakStartedAt) };
  });

const outProcedure = actionProcedure("ageing.load")
  .input(ageingOutInput)
  .mutation(async ({ ctx, input }) => {
    const { clientMutationId, ...content } = input;
    const replay = await replayOf(ctx, "ageing.out", clientMutationId, content);
    if (replay?.priorSubjectId) return { ...(await detail(ctx, replay.priorSubjectId)), replayed: true };
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    const readings = await readReadings(ctx.db, ctx.companyId, b.id);
    const nowMs = clockNow().getTime();
    const outAt = input.outAt ?? nowMs;
    refuse(
      ageingTakeOutGates({ batchStatus: b.status, readingCount: readings.length, gasStartMilli: b.gasStartMilli, gasEndMilli: input.gasEndMilli, inAt: ms(b.inAt), outAt, now: nowMs }),
      { batch: b.number, status: b.status },
    );
    const soak = soakOf({ ...b, outAt: new Date(outAt) }, readings, nowMs);
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [
      ctx.db
        .update(ageingBatch)
        .set({ status: "out", gasEndMilli: input.gasEndMilli, outAt: new Date(outAt), soakVerdict: soak?.verdict ?? null, soakInBandMin: soak?.inBandMin ?? null, serverSeq: seq })
        .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, "in_oven"))),
      ageingAbortUnless(ctx.db, batchLanded(ctx.companyId, b.id, seq, ["out"])),
      auditInsert(audit(ctx), {
        id: replay?.id,
        action: "ageing.out",
        subjectType: "ageing_batch",
        subjectId: b.id,
        meta: { number: b.number, gasEndMilli: input.gasEndMilli, outAt, soak: soak?.verdict ?? null, inBandMin: soak?.inBandMin ?? null, ...replayMeta(replay, clientMutationId) },
      }),
    ];
    const replayed = await runWrite(ctx, statements, replay, async (id) => ({ ...(await detail(ctx, id)), replayed: true }), () => statusRace(ctx, b.id));
    if (replayed) return replayed;
    return { ...(await detail(ctx, b.id)), replayed: false };
  });

// ---------------------------------------------------------------------------
// Hardness, release, override, hold, unhold
// ---------------------------------------------------------------------------

const overrideApproved = (b: AgeingBatchRow) => b.overrideApprovalId != null;
/** Status the release rules see: a released trolley with QC-held lines is judged again like a held one. */
const judgeStatus = (b: AgeingBatchRow, rows: readonly RowRead[]) =>
  b.status === "released" && rows.some((r) => r.status === "held" && r.holdKind === "ageing_reject") ? "held" : b.status;

/** Row moves for release / retest: status, the reject reason, and the batch landing guard. */
function rowMoveStatements(
  ctx: Ctx,
  moves: readonly { id: string; from: string; to: "pending" | "released" | "held"; rejectCode: AgeingRejectCode | null }[],
  rejectIds: Map<string, string>,
  seq: number,
): SqliteBatchItem[] {
  return moves.map((m) =>
    ctx.db
      .update(ageingRow)
      .set({
        status: m.to,
        holdReasonCodeId: m.to === "held" ? (rejectIds.get(m.rejectCode ?? "other") ?? rejectIds.get("other") ?? null) : null,
        // Review m8: a line held again keeps the supervisor's note; a line that leaves the hold clears it.
        ...(m.to === "held" ? {} : { holdNote: null }),
        serverSeq: seq,
      })
      .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, m.id), eq(ageingRow.status, m.from as never))),
  );
}

const hardnessProcedure = actionProcedure("ageing.record")
  .input(ageingHardnessInput)
  .mutation(async ({ ctx, input }) => {
    const { clientMutationId, ...content } = input;
    const replay = await replayOf(ctx, "ageing.hardness", clientMutationId, content);
    const [row] = await ctx.db.select().from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, input.rowId))).limit(1);
    if (!row) throw ageingRefusal("batch_not_found");
    if (replay?.priorSubjectId) return { ...(await detail(ctx, row.batchId)), replayed: true };
    const b = await readBatch(ctx.db, ctx.companyId, row.batchId);
    refuse(ageingHardnessGates({ batchStatus: b.status, rowStatus: row.status }), { batch: b.number, status: b.status });
    const rule = ruleOf(b)!;
    const prior = (await readSamples(ctx.db, ctx.companyId, [row.id])).get(row.id) ?? [];
    const fresh = input.readingsX10.map((readingX10) => ({ method: input.method, readingX10 }));
    const summary = hardnessSummary([...prior, ...fresh], rule);
    await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    const me = rows.find((r) => r.id === row.id)!;
    const readings = await readReadings(ctx.db, ctx.companyId, b.id);
    const soak = soakOf(b, readings, clockNow().getTime());
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const userId = userOf(ctx);
    const statements: SqliteBatchItem[] = [];
    pushChunkedInserts(
      statements,
      (part) => ctx.db.insert(ageingHardness).values(part),
      fresh.map((s) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        batchId: b.id,
        rowId: row.id,
        method: s.method,
        readingX10: s.readingX10,
        // Review m4 (0040): a sample of the other method is not deciding, stored as null; the line summary never counts it.
        pass: s.method === rule.method ? hardnessSamplePass(s, rule) : null,
        testedBy: userId,
      })),
    );
    statements.push(
      ctx.db
        .update(ageingRow)
        .set({ hardnessMethod: summary.method, hardnessReadingX10: summary.medianX10, hardnessPass: summary.pass, serverSeq: seq })
        .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, row.id), ne(ageingRow.status, "void"), ne(ageingRow.status, "closed"))),
      ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.id = ${row.id} and r.server_seq = ${seq})`),
    );
    // Spec §4: a line held only for its hardness that now passes goes back to pending (batch out) or is
    // released (batch released / held, soak met or overridden). A hand hold is never cleared here.
    let moved: "pending" | "released" | null = null;
    if (me.status === "held" && me.holdKind === "ageing_reject" && (me.holdCode === "hardness_low" || me.holdCode === "too_few_samples") && summary.pass === true) {
      if (b.status === "out") moved = "pending";
      else if ((b.status === "released" || b.status === "held") && (soak?.verdict === "ok" || overrideApproved(b))) moved = "released";
    }
    if (moved) {
      statements.push(...rowMoveStatements(ctx, [{ id: row.id, from: "held", to: moved, rejectCode: null }], new Map(), seq));
      if (moved === "released") {
        // Every other live line passed too: the batch's QC verdict turns to pass (an override stays).
        const allPass = rows.filter((r) => r.id !== row.id && r.status !== "void").every((r) => r.hardnessPass === true);
        const qcVerdict = b.qcVerdict === "override" ? "override" : allPass ? "pass" : b.qcVerdict;
        statements.push(
          ctx.db
            .update(ageingBatch)
            .set({ status: "released", qcVerdict, releasedAt: b.releasedAt ?? clockNow(), releasedBy: b.releasedBy ?? userId, serverSeq: seq })
            .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), inArray(ageingBatch.status, ["held", "released"]))),
          ...(me.source === "bundle" ? releaseBundleRowStatements(ctx.db, ctx.companyId, [row.id], seq) : []),
          ...closeEmptyStatements(ctx.db, ctx.companyId, b.id, userId, seq),
        );
      }
    }
    statements.push(
      auditInsert(audit(ctx), {
        id: replay?.id,
        action: "ageing.hardness",
        subjectType: "ageing_batch",
        subjectId: b.id,
        meta: { number: b.number, rowId: row.id, method: input.method, readingsX10: input.readingsX10, medianX10: summary.medianX10, pass: summary.pass, moved, ...replayMeta(replay, clientMutationId) },
      }),
    );
    const replayed = await runWrite(ctx, statements, replay, async (id) => ({ ...(await detail(ctx, id)), replayed: true }), () => statusRace(ctx, b.id));
    if (replayed) return replayed;
    return { ...(await detail(ctx, b.id)), replayed: false };
  });

const releaseProcedure = actionProcedure("ageing.release")
  .input(ageingBatchIdInput.extend({ clientMutationId: z.string().trim().min(1).max(64).optional() }))
  .mutation(async ({ ctx, input }) => {
    const { clientMutationId, ...content } = input;
    const replay = await replayOf(ctx, "ageing.release", clientMutationId, content);
    if (replay?.priorSubjectId) return { ...(await detail(ctx, replay.priorSubjectId)), overrideWouldHelp: false, replayed: true };
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    const readings = await readReadings(ctx.db, ctx.companyId, b.id);
    const soak = soakOf(b, readings, clockNow().getTime());
    const samples = await readSamples(ctx.db, ctx.companyId, rows.map((r) => r.id));
    const rule = ruleOf(b);
    const status = judgeStatus(b, rows);
    const plan = ageingReleasePlan({
      batchStatus: status,
      soak: soak?.verdict ?? "no_readings",
      overrideApproved: overrideApproved(b),
      rows: rows.map((r) => ({ id: r.id, status: r.status, holdKind: r.holdKind, hardness: rowHardness(samples.get(r.id), rule) })),
    });
    if (!plan.ok) throw ageingRefusal(plan.code, { batch: b.number, status: b.status });
    await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
    const rejectIds = await rejectReasonIds(ctx.db, ctx.companyId);
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const userId = userOf(ctx);
    const fromOf = new Map(rows.map((r) => [r.id, r.status]));
    const released = plan.moves.filter((m) => m.to === "released").map((m) => m.id);
    const bundleRows = rows.filter((r) => r.source === "bundle" && released.includes(r.id)).map((r) => r.id);
    const statements: SqliteBatchItem[] = [
      ...rowMoveStatements(ctx, plan.moves.map((m) => ({ ...m, from: fromOf.get(m.id)! })), rejectIds, seq),
      ctx.db
        .update(ageingBatch)
        .set({
          status: plan.batchStatus,
          qcVerdict: plan.qcVerdict,
          soakVerdict: soak?.verdict ?? "no_readings",
          soakInBandMin: soak?.inBandMin ?? 0,
          releasedAt: plan.batchStatus === "released" ? (b.releasedAt ?? clockNow()) : b.releasedAt,
          releasedBy: plan.batchStatus === "released" ? (b.releasedBy ?? userId) : b.releasedBy,
          serverSeq: seq,
        })
        .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, b.status))),
      ageingAbortUnless(ctx.db, batchLanded(ctx.companyId, b.id, seq, [plan.batchStatus])),
      ...afterReleaseStatements(ctx.db, ctx.companyId, b.id, bundleRows, seq, userId),
      auditInsert(audit(ctx), {
        id: replay?.id,
        action: "ageing.release",
        subjectType: "ageing_batch",
        subjectId: b.id,
        meta: {
          number: b.number,
          to: plan.batchStatus,
          qcVerdict: plan.qcVerdict,
          soak: soak?.verdict ?? "no_readings",
          inBandMin: soak?.inBandMin ?? 0,
          moves: plan.moves.map((m) => ({ rowId: m.id, to: m.to, reject: m.rejectCode })),
          overrideApprovalId: b.overrideApprovalId,
          ...replayMeta(replay, clientMutationId),
        },
      }),
    ];
    const replayed = await runWrite(ctx, statements, replay, async (id) => ({ ...(await detail(ctx, id)), overrideWouldHelp: false, replayed: true }), () => statusRace(ctx, b.id));
    if (replayed) return replayed;
    return { ...(await detail(ctx, b.id)), overrideWouldHelp: plan.overrideWouldHelp, replayed: false };
  });

const requestOverrideProcedure = actionProcedure("ageing.release")
  .input(ageingOverrideRequestInput)
  .mutation(async ({ ctx, input }) => {
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    if (b.status !== "out" && b.status !== "held" && b.status !== "released") throw ageingRefusal("wrong_status", { batch: b.number, status: b.status });
    const [pending] = await ctx.db
      .select({ id: approval.id })
      .from(approval)
      .where(and(eq(approval.companyId, ctx.companyId), eq(approval.kind, "ageing_override"), eq(approval.subjectId, b.id), eq(approval.status, "pending")))
      .limit(1);
    if (pending) throw ageingRefusal("override_pending", { batch: b.number });
    if (overrideApproved(b)) throw ageingRefusal("override_not_needed", { batch: b.number });
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    const readings = await readReadings(ctx.db, ctx.companyId, b.id);
    const soak = soakOf(b, readings, clockNow().getTime());
    const samples = await readSamples(ctx.db, ctx.companyId, rows.map((r) => r.id));
    const plan = ageingReleasePlan({
      batchStatus: judgeStatus(b, rows),
      soak: soak?.verdict ?? "no_readings",
      overrideApproved: false,
      rows: rows.map((r) => ({ id: r.id, status: r.status, holdKind: r.holdKind, hardness: rowHardness(samples.get(r.id), ruleOf(b)) })),
    });
    if (!plan.ok || !plan.overrideWouldHelp) throw ageingRefusal("override_not_needed", { batch: b.number });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const req = requestApprovalInsert(
      { db: ctx.db, companyId: ctx.companyId, session: ctx.session },
      { kind: "ageing_override", subjectId: b.id, serverSeq: seq, requestNote: input.reason, meta: { number: b.number, soak: soak?.verdict ?? "no_readings", inBandMin: soak?.inBandMin ?? 0 } },
    );
    await atomicBatch(ctx.db, [
      req.statement,
      auditInsert(audit(ctx), { action: "ageing.override.request", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, approvalId: req.id, reason: input.reason } }),
    ]);
    return { approvalId: req.id };
  });

const holdProcedure = actionProcedure("ageing.release")
  .input(ageingHoldInput)
  .mutation(async ({ ctx, input }) => {
    let batchId = input.batchId ?? null;
    let row: AgeingRowRow | undefined;
    if (input.rowId) {
      [row] = await ctx.db.select().from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, input.rowId))).limit(1);
      if (!row) throw ageingRefusal("batch_not_found");
      batchId = row.batchId;
    }
    const b = await readBatch(ctx.db, ctx.companyId, batchId!);
    const reason = await reasonOfKind(ctx.db, ctx.companyId, input.reasonCodeId, "ageing_hold");
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    refuse(
      ageingHoldGates({ scope: row ? "row" : "batch", batchStatus: b.status, rows: rows.map((r) => ({ status: r.status, packedPcs: r.packedPcs, source: r.source })), rowStatus: row?.status }),
      { batch: b.number, status: b.status },
    );
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const set = { status: "held" as const, holdReasonCodeId: reason.id, holdNote: input.note ?? null, serverSeq: seq };
    const statements: SqliteBatchItem[] = row
      ? [
          ctx.db.update(ageingRow).set(set).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, row.id), eq(ageingRow.status, row.status))),
          ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.id = ${row.id} and r.server_seq = ${seq})`),
          // A released trolley with no released line left is held (nothing on it may be packed).
          ctx.db
            .update(ageingBatch)
            .set({ status: "held", serverSeq: seq })
            .where(
              and(
                eq(ageingBatch.companyId, ctx.companyId),
                eq(ageingBatch.id, b.id),
                eq(ageingBatch.status, "released"),
                sql`not exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.status = 'released' and ${remainingOf("r")} > 0)`,
              ),
            ),
        ]
      : [
          ctx.db
            .update(ageingRow)
            .set(set)
            .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.batchId, b.id), inArray(ageingRow.status, ["pending", "released", "held"]))),
          ctx.db
            .update(ageingBatch)
            .set({ status: b.status === "out" ? "out" : "held", serverSeq: seq })
            .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, b.status))),
          ageingAbortUnless(ctx.db, batchLanded(ctx.companyId, b.id, seq, [b.status === "out" ? "out" : "held"])),
          // Nothing may have been taken by pack meanwhile (a whole-trolley hold is before any pack).
          ageingAbortUnless(ctx.db, sql`not exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.source <> 'bundle' and r.status <> 'void' and r.packed_pcs > 0)`),
        ];
    statements.push(
      auditInsert(audit(ctx), { action: "ageing.hold", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, rowId: row?.id ?? null, reason: reason.code, note: input.note ?? null } }),
    );
    await runWrite(ctx, statements, null, async () => null, async () => {
      if (row) {
        const [now] = await ctx.db.select({ status: ageingRow.status }).from(ageingRow).where(eq(ageingRow.id, row.id)).limit(1);
        if (now?.status === "held") throw ageingRefusal("already_held");
      }
      const again = await readRows(ctx.db, ctx.companyId, [b.id]);
      if (ageingAnyPacked(again)) throw ageingRefusal("hold_after_pack");
      return statusRace(ctx, b.id);
    });
    return detail(ctx, b.id);
  });

const unholdProcedure = actionProcedure("ageing.release")
  .input(ageingUnholdInput)
  .mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, input.rowId))).limit(1);
    if (!row) throw ageingRefusal("batch_not_found");
    const b = await readBatch(ctx.db, ctx.companyId, row.batchId);
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    const me = rows.find((r) => r.id === row.id)!;
    const readings = await readReadings(ctx.db, ctx.companyId, b.id);
    const soak = soakOf(b, readings, clockNow().getTime());
    const samples = await readSamples(ctx.db, ctx.companyId, [row.id]);
    const plan = ageingUnholdPlan({
      batchStatus: b.status,
      rowStatus: me.status,
      holdKind: me.holdKind,
      soak: soak?.verdict ?? "no_readings",
      overrideApproved: overrideApproved(b),
      hardness: rowHardness(samples.get(row.id), ruleOf(b)),
    });
    if (!plan.ok) throw ageingRefusal(plan.code, { batch: b.number, status: b.status });
    await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
    const rejectIds = await rejectReasonIds(ctx.db, ctx.companyId);
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const userId = userOf(ctx);
    const statements: SqliteBatchItem[] = [
      // Review m7: the batch is still where the plan read it (a release, void or rework meanwhile fails this whole).
      ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_batch b where b.company_id = ${ctx.companyId} and b.id = ${b.id} and b.status = ${b.status})`),
      ...rowMoveStatements(ctx, [{ id: row.id, from: "held", to: plan.to, rejectCode: plan.rejectCode }], rejectIds, seq),
      ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.id = ${row.id} and r.server_seq = ${seq})`),
    ];
    if (plan.to === "released") {
      statements.push(
        ctx.db
          .update(ageingBatch)
          .set({ status: "released", releasedAt: b.releasedAt ?? clockNow(), releasedBy: b.releasedBy ?? userId, serverSeq: seq })
          .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, "held"))),
        ...afterReleaseStatements(ctx.db, ctx.companyId, b.id, me.source === "bundle" ? [row.id] : [], seq, userId),
      );
    }
    statements.push(
      auditInsert(audit(ctx), { action: "ageing.unhold", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, rowId: row.id, to: plan.to, reject: plan.rejectCode, note: input.note ?? null } }),
    );
    await runWrite(ctx, statements, null, async () => null, async () => {
      const [now] = await ctx.db.select({ status: ageingRow.status }).from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, row.id))).limit(1);
      if (now?.status !== "held") throw ageingRefusal("not_held");
      return statusRace(ctx, b.id);
    });
    return detail(ctx, b.id);
  });

// ---------------------------------------------------------------------------
// Rework, discard, split, void
// ---------------------------------------------------------------------------

const reworkProcedure = actionProcedure("ageing.release")
  .input(ageingReworkInput)
  .mutation(async ({ ctx, input }) => {
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
    const plan = ageingReworkPlan({ batchStatus: b.status, rows });
    if (!plan.ok) throw ageingRefusal(plan.code, { batch: b.number, status: b.status });
    const trolleyId = input.trolleyId ?? b.trolleyId;
    const [t] = await ctx.db.select().from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, trolleyId))).limit(1);
    if (!t) throw ageingRefusal("trolley_not_found");
    if (t.status !== "active") throw ageingRefusal("trolley_not_active", { code: t.code });
    const [open] = await ctx.db
      .select({ id: ageingBatch.id, number: ageingBatch.number })
      .from(ageingBatch)
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, t.id), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES])))
      .limit(1);
    // The same trolley is free only when this rework closes the original (review m9: close before insert).
    if (open && !(open.id === b.id && plan.closesBatch)) throw ageingRefusal("trolley_busy", { code: t.code, batch: open.number });
    let recipeId = input.recipeId ?? null;
    if (!recipeId && b.alloy && b.temper) recipeId = (await activeRecipe(ctx.db, ctx.companyId, b.alloy, b.temper, "top_up"))?.id ?? b.recipeId;
    const userId = userOf(ctx);
    const number = (await nextDocNumber(ctx.db, ctx.companyId, "ageing", clockNow(), userId)).number;
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const successorId = crypto.randomUUID();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const statements: SqliteBatchItem[] = [];
    const successorRows: NewRow[] = [];
    let sort = 0;
    for (const m of plan.moves) {
      const r = byId.get(m.rowId)!;
      const newId = crypto.randomUUID();
      statements.push(
        ctx.db
          .update(ageingRow)
          .set({ reworkPcs: sql`${ageingRow.reworkPcs} + ${m.pcs}`, reworkRowId: newId, status: "closed", serverSeq: seq })
          .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, r.id), eq(ageingRow.status, "held"), sql`${remainingOf("ageing_row")} = ${m.pcs}`)),
      );
      sort += 1;
      successorRows.push({
        ...ROW_DEFAULTS,
        id: newId,
        companyId: ctx.companyId,
        serverSeq: seq,
        batchId: successorId,
        source: r.source,
        pressRunId: r.pressRunId,
        pressRunLineId: r.pressRunLineId,
        bundleId: r.bundleId,
        dieId: r.dieId,
        dieInstanceId: r.dieInstanceId,
        castId: r.castId,
        salesOrderId: r.salesOrderId,
        salesOrderLineId: r.salesOrderLineId,
        customerPo: r.customerPo,
        lengthMm: r.lengthMm,
        pcs: m.pcs,
        kgG: m.kgG,
        sortOrder: sort,
        createdBy: userId,
      });
    }
    statements.push(
      ageingAbortUnless(
        ctx.db,
        sql`(select count(*) from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.server_seq = ${seq}) = ${plan.moves.length}`,
      ),
    );
    if (plan.closesBatch) {
      statements.push(
        ctx.db
          .update(ageingBatch)
          .set({ status: "closed", disposition: "rework", closedBy: userId, serverSeq: seq })
          .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, b.status))),
      );
    } else {
      // What is left is released lines (or nothing held): the trolley is released, marked rework.
      statements.push(
        ctx.db
          .update(ageingBatch)
          .set({ status: sql`case when exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.status = 'released') then 'released' else ageing_batch.status end`, disposition: "rework", serverSeq: seq })
          .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, b.status))),
        ...closeEmptyStatements(ctx.db, ctx.companyId, b.id, userId, seq),
      );
    }
    statements.push(
      ctx.db.insert(ageingBatch).values({
        id: successorId,
        companyId: ctx.companyId,
        serverSeq: seq,
        number,
        status: "loading",
        trolleyId: t.id,
        recipeId,
        reworkOfBatchId: b.id,
        createdBy: userId,
      }),
    );
    pushChunkedInserts(statements, (part) => ctx.db.insert(ageingRow).values(part), successorRows);
    statements.push(
      auditInsert(audit(ctx), {
        action: "ageing.rework",
        subjectType: "ageing_batch",
        subjectId: b.id,
        meta: { number: b.number, successor: number, successorId, trolley: t.code, moves: plan.moves, closes: plan.closesBatch },
      }),
    );
    try {
      await runWrite(ctx, statements, null, async () => null, () => statusRace(ctx, b.id));
    } catch (e) {
      if (isUniqueOn(e, "trolley_id")) throw ageingRefusal("trolley_busy", { code: t.code, batch: b.number });
      throw e;
    }
    return { original: await detail(ctx, b.id), successor: await detail(ctx, successorId) };
  });

/** The pieces pack or the QC desk throws away from a line (scrap_pcs only; any weighed scrap is pack's posting). */
export function discardStatements(ctx: Ctx, row: { id: string; batchId: string }, pcs: number, seq: number): SqliteBatchItem[] {
  return [
    ctx.db
      .update(ageingRow)
      .set({ scrapPcs: sql`${ageingRow.scrapPcs} + ${pcs}`, serverSeq: seq })
      .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, row.id), inArray(ageingRow.status, ["pending", "held", "released"]), sql`${remainingOf("ageing_row")} >= ${pcs}`)),
    ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.id = ${row.id} and r.server_seq = ${seq})`),
    ...closeEmptyStatements(ctx.db, ctx.companyId, row.batchId, ctx.session.user.id, seq),
  ];
}

const discardProcedure = actionProcedure("ageing.release")
  .input(ageingDiscardRemainingInput)
  .mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, input.rowId))).limit(1);
    if (!row) throw ageingRefusal("batch_not_found");
    const b = await readBatch(ctx.db, ctx.companyId, row.batchId);
    const reason = await reasonOfKind(ctx.db, ctx.companyId, input.reasonCodeId, "ageing_scrap");
    // A whole bundle is not thinned on the trolley; void or repack the bundle.
    if (row.source === "bundle" || b.status === "loading" || b.status === "in_oven") throw ageingRefusal("wrong_status", { batch: b.number, status: b.status });
    const remaining = ageingRowRemaining(row);
    const gate = ageingDiscardGate({ rowStatus: row.status, remainingPcs: remaining, pcs: input.pcs });
    if (gate) throw ageingRefusal(gate, { n: remaining, batch: b.number, status: b.status });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await runWrite(
      ctx,
      [
        ...discardStatements(ctx, row, input.pcs, seq),
        auditInsert(audit(ctx), { action: "ageing.discard", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, rowId: row.id, pcs: input.pcs, reason: reason.code, note: input.note ?? null } }),
      ],
      null,
      async () => null,
      async () => {
        const [now] = await ctx.db.select().from(ageingRow).where(eq(ageingRow.id, row.id)).limit(1);
        throw ageingRefusal("discard_over", { n: now ? ageingRowRemaining(now) : 0 });
      },
    );
    return detail(ctx, b.id);
  });

const splitProcedure = actionProcedure("ageing.release")
  .input(ageingSplitInput)
  .mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, input.rowId))).limit(1);
    if (!row) throw ageingRefusal("batch_not_found");
    const b = await readBatch(ctx.db, ctx.companyId, row.batchId);
    const floor = readFloorSettings(await companySettings(ctx.db, ctx.companyId));
    const plan = ageingSplitPlan({ splitOn: floor.ageing.split, row, cuts: input.cuts, batchStatus: b.status });
    if (!plan.ok) throw ageingRefusal(plan.code, { batch: b.number, status: b.status });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const [first, ...rest] = plan.parts;
    const statements: SqliteBatchItem[] = [
      ctx.db
        .update(ageingRow)
        .set({ lengthMm: first!.lengthMm, pcs: first!.pcs, kgG: first!.kgG, serverSeq: seq })
        .where(
          and(
            eq(ageingRow.companyId, ctx.companyId),
            eq(ageingRow.id, row.id),
            eq(ageingRow.status, row.status),
            eq(ageingRow.pcs, row.pcs),
            eq(ageingRow.packedPcs, 0),
            eq(ageingRow.scrapPcs, 0),
            eq(ageingRow.reworkPcs, 0),
          ),
        ),
      ageingAbortUnless(ctx.db, sql`exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.id = ${row.id} and r.server_seq = ${seq})`),
    ];
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = row;
    pushChunkedInserts(
      statements,
      (part) => ctx.db.insert(ageingRow).values(part),
      rest.map((p, i) => ({ ...base, id: crypto.randomUUID(), serverSeq: seq, lengthMm: p.lengthMm, pcs: p.pcs, kgG: p.kgG, sortOrder: row.sortOrder + i + 1, createdBy: userOf(ctx) })),
    );
    statements.push(auditInsert(audit(ctx), { action: "ageing.split", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, rowId: row.id, cuts: plan.parts } }));
    await runWrite(ctx, statements, null, async () => null, async () => {
      throw ageingRefusal("split_after_pack");
    });
    return detail(ctx, b.id);
  });

const voidProcedure = companyProcedure.input(ageingVoidInput).mutation(async ({ ctx, input }) => {
  const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
  // Review m5: a rework successor still loading (nothing aged, packed or moved on it) can be voided; that
  // undoes the rework (a supervisor's decision, so ageing.release): its pieces go back on the original lines.
  const undoRework = b.reworkOfBatchId != null && b.status === "loading";
  // ageing.load voids a batch still loading; after take-out it is the QC verdict's (ageing.release).
  if (!can(meOf(ctx), b.status === "loading" && !undoRework ? "ageing.load" : "ageing.release")) forbid();
  const rows = await readRows(ctx.db, ctx.companyId, [b.id]);
  const reason = input.reasonCodeId ? await reasonOfKind(ctx.db, ctx.companyId, input.reasonCodeId, "ageing_abort") : null;
  const reasonText = input.reason?.trim() || null;
  refuse(
    ageingVoidGates({ batchStatus: b.status, anyPacked: ageingAnyPacked(rows), reasonGiven: reason != null, anyMoved: ageingAnyMoved(rows) || (b.reworkOfBatchId != null && !undoRework) }),
    { batch: b.number, status: b.status },
  );
  if (reason?.requiresNote && !reasonText) throw ageingRefusal("void_reason_missing");
  // Review r2 n3: a successor that took an extra load or a split no longer maps one-to-one onto the original lines.
  if (undoRework && (await reworkUndoChanged(ctx, b.reworkOfBatchId!, rows.filter((r) => r.status !== "void")))) throw ageingRefusal("void_rework_changed", { batch: b.number });
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const userId = userOf(ctx);
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(ageingBatch)
      .set({ status: "void", voidReasonCodeId: reason?.id ?? null, voidReason: reasonText ?? reason?.label ?? null, voidedAt: clockNow(), voidedBy: userId, serverSeq: seq })
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, b.id), eq(ageingBatch.status, b.status))),
    ageingAbortUnless(ctx.db, batchLanded(ctx.companyId, b.id, seq, ["void"])),
    // Nothing packed, reworked or discarded meanwhile (the pieces go back to their press lines once).
    ageingAbortUnless(
      ctx.db,
      sql`not exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id} and r.status <> 'void'
        and ((r.source <> 'bundle' and r.packed_pcs > 0) or r.scrap_pcs + r.rework_pcs > 0))`,
    ),
    ctx.db.update(ageingRow).set({ status: "void", serverSeq: seq }).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.batchId, b.id), ne(ageingRow.status, "void"))),
    // A bundle marked aged by this batch is not aged any more.
    ctx.db
      .update(bundle)
      .set({ ageingRowId: null, serverSeq: seq })
      .where(and(eq(bundle.companyId, ctx.companyId), sql`${bundle.ageingRowId} in (select r.id from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${b.id})`)),
    auditInsert(audit(ctx), { action: "ageing.void", subjectType: "ageing_batch", subjectId: b.id, meta: { number: b.number, from: b.status, reason: reason?.code ?? null, note: reasonText, undoRework } }),
  ];
  if (undoRework) statements.push(...undoReworkStatements(ctx, b.id, b.reworkOfBatchId!, rows.filter((r) => r.status !== "void"), seq));
  let original: { trolleyId: string; number: string } | null = null;
  if (undoRework) {
    const o = await readBatch(ctx.db, ctx.companyId, b.reworkOfBatchId!);
    original = { trolleyId: o.trolleyId, number: o.number };
  }
  try {
    await runWrite(ctx, statements, null, async () => null, async () => {
      const again = await readRows(ctx.db, ctx.companyId, [b.id]);
      if (ageingAnyMoved(again) || undoRework) {
        const now = await readBatch(ctx.db, ctx.companyId, b.id);
        if (now.status !== b.status) return statusRace(ctx, b.id);
        if (undoRework && (await reworkUndoChanged(ctx, b.reworkOfBatchId!, again.filter((r) => r.status !== "void")))) throw ageingRefusal("void_rework_changed", { batch: b.number });
        throw ageingRefusal("void_after_rework", { batch: b.number });
      }
      if (ageingAnyPacked(again)) throw ageingRefusal("void_after_pack", { batch: b.number });
      return statusRace(ctx, b.id);
    });
  } catch (e) {
    // The original trolley took another load meanwhile: it cannot carry the original lines again.
    if (original && isUniqueOn(e, "trolley_id")) {
      const [busy] = await ctx.db.select({ number: ageingBatch.number }).from(ageingBatch).where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.trolleyId, original.trolleyId), inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES]))).limit(1);
      const [t] = await ctx.db.select({ code: trolley.code }).from(trolley).where(and(eq(trolley.companyId, ctx.companyId), eq(trolley.id, original.trolleyId))).limit(1);
      throw ageingRefusal("trolley_busy", { code: t?.code ?? "", batch: busy?.number ?? original.number });
    }
    throw e;
  }
  return detail(ctx, b.id);
});

/**
 * Review r2 n3: true when a rework successor's lines no longer map one-to-one onto the original lines that
 * gave them (an extra load or a split added lines, or an original line gave fewer pieces): its undo would
 * fail the whole batch, so it is refused with its own sentence.
 */
async function reworkUndoChanged(ctx: Ctx, originalId: string, successorRows: readonly RowRead[]): Promise<boolean> {
  const originals = await ctx.db
    .select({ reworkRowId: ageingRow.reworkRowId, reworkPcs: ageingRow.reworkPcs, status: ageingRow.status })
    .from(ageingRow)
    .where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.batchId, originalId), sql`${ageingRow.reworkRowId} is not null`));
  const byLink = new Map(originals.map((o) => [o.reworkRowId, o]));
  return successorRows.some((r) => {
    const o = byLink.get(r.id);
    return !o || o.status !== "closed" || num(o.reworkPcs) < num(r.pcs);
  });
}

/**
 * Review m5: voiding a rework successor that is still loading puts its pieces back where the rework took
 * them: each original line (the one whose `rework_row_id` names the successor line) gets its rework
 * pieces back and is held again (its hold reason never left it); an original batch the rework closed is
 * held again (its trolley must be free: the successor on it is voided first, in this same batch). Lands
 * only when the successor's void landed, and every original line must move (else the batch fails whole).
 */
function undoReworkStatements(ctx: Ctx, successorId: string, originalId: string, successorRows: readonly RowRead[], seq: number): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  const landed = batchLanded(ctx.companyId, successorId, seq, ["void"]);
  for (const r of successorRows) {
    out.push(
      ctx.db
        .update(ageingRow)
        .set({ reworkPcs: sql`${ageingRow.reworkPcs} - ${r.pcs}`, reworkRowId: null, status: "held", serverSeq: seq })
        .where(
          and(
            eq(ageingRow.companyId, ctx.companyId),
            eq(ageingRow.batchId, originalId),
            eq(ageingRow.reworkRowId, r.id),
            eq(ageingRow.status, "closed"),
            sql`${ageingRow.reworkPcs} >= ${r.pcs}`,
            sql`${landed}`,
          ),
        ),
    );
  }
  out.push(
    ageingAbortUnless(
      ctx.db,
      sql`(select count(*) from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${originalId} and r.server_seq = ${seq}) = ${successorRows.length}`,
    ),
    ctx.db
      .update(ageingBatch)
      .set({
        status: sql`case when ${ageingBatch.status} = 'closed' then 'held' else ${ageingBatch.status} end`,
        disposition: sql`case when exists (select 1 from ageing_row r where r.company_id = ${ctx.companyId} and r.batch_id = ${originalId} and r.status <> 'void' and r.rework_pcs > 0) then ${ageingBatch.disposition} else null end`,
        closedBy: sql`case when ${ageingBatch.status} = 'closed' then null else ${ageingBatch.closedBy} end`,
        serverSeq: seq,
      })
      .where(and(eq(ageingBatch.companyId, ctx.companyId), eq(ageingBatch.id, originalId), sql`${landed}`)),
    auditInsert(audit(ctx), { action: "ageing.rework.undo", subjectType: "ageing_batch", subjectId: originalId, meta: { successorId, lines: successorRows.map((r) => ({ rowId: r.id, pcs: r.pcs })) } }),
  );
  return out;
}

const simulateProcedure = actionProcedure("ageing.record")
  .input(ageingSimulateInput)
  .mutation(async ({ ctx, input }) => {
    if (!simulatorOn()) throw ageingRefusal("simulator_off");
    const b = await readBatch(ctx.db, ctx.companyId, input.batchId);
    if ((b.status !== "in_oven" && b.status !== "out") || b.inAt == null || b.targetTempX10 == null) throw ageingRefusal("wrong_status", { batch: b.number, status: b.status });
    const nowMs = clockNow().getTime();
    const readings = simulatedReadings({
      batchId: b.id,
      snapshot: { targetTempX10: b.targetTempX10, toleranceX10: b.toleranceX10 ?? 100, soakMin: b.soakMin ?? 60 },
      inAt: ms(b.inAt)!,
      outAt: ms(b.outAt),
      now: nowMs,
      profile: input.profile ?? ovenSimulatorProfile(env as never),
    });
    if (readings.length === 0) return { inserted: 0, refused: [] };
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    return ingestAgeingReadings(ctx.db, ctx.companyId, { batchId: b.id, source: "simulator", deviceId: "", readings }, { userId: userOf(ctx), nowMs, seq });
  });

// ---------------------------------------------------------------------------
// Board and lists
// ---------------------------------------------------------------------------

const listProcedure = actionProcedure("ageing.view")
  .input(ageingListInput)
  .query(async ({ ctx, input }) => {
    const conds: (SQL | undefined)[] = [eq(ageingBatch.companyId, ctx.companyId)];
    if (input.status === "heating") conds.push(eq(ageingBatch.status, "in_oven"), sql`${ageingBatch.soakStartedAt} is null`);
    else if (input.status === "soaking") conds.push(eq(ageingBatch.status, "in_oven"), sql`${ageingBatch.soakStartedAt} is not null`);
    else if (input.status) conds.push(eq(ageingBatch.status, input.status));
    if (input.ovenId) conds.push(eq(ageingBatch.ovenId, input.ovenId));
    if (input.trolleyId) conds.push(eq(ageingBatch.trolleyId, input.trolleyId));
    if (input.shiftId) conds.push(eq(ageingBatch.shiftId, input.shiftId));
    if (input.from) conds.push(sql`${ageingBatch.productionDay} >= ${input.from}`);
    if (input.to) conds.push(sql`${ageingBatch.productionDay} <= ${input.to}`);
    const where = and(...conds);
    const [total] = await ctx.db.select({ n: sql<number>`count(*)` }).from(ageingBatch).where(where);
    const batches = await ctx.db
      .select()
      .from(ageingBatch)
      .where(where)
      .orderBy(sql`case ${ageingBatch.status} when 'in_oven' then 0 when 'out' then 1 when 'held' then 2 when 'loading' then 3 when 'released' then 4 else 5 end`, desc(ageingBatch.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    const rows = await readRows(ctx.db, ctx.companyId, batches.map((b) => b.id));
    const names = await batchNames(ctx.db, ctx.companyId, batches);
    return {
      items: batches.map((b) => summaryOf(b, rows.filter((r) => r.batchId === b.id), names.get(b.id))),
      total: num(total?.n),
    };
  });

const availableLinesProcedure = actionProcedure("ageing.load")
  .input(ageingAvailableLinesInput)
  .query(async ({ ctx, input }) => {
    const recipe = input.recipeId
      ? (await ctx.db.select().from(ageingRecipe).where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.id, input.recipeId))).limit(1))[0]
      : null;
    const conds: SQL[] = [sql`r.status = 'logged'`];
    if (input.dieId) conds.push(sql`r.section_id = ${input.dieId}`);
    if (input.castId) conds.push(sql`r.cast_id = ${input.castId}`);
    // Review I1: pieces in the line's own cut-length units (a split row carries other lengths).
    conds.push(sql`l.pcs > ${lineLoadedPcsSql("l")}`);
    if (recipe) conds.push(sql`(c.alloy is null or upper(c.alloy) = upper(${recipe.alloy}))`, sql`(coalesce(sol.temper, d.temper) is null or upper(coalesce(sol.temper, d.temper)) = upper(${recipe.temper}))`);
    const rows = await ctx.db.all<LineRead>(sql`${lineSelect(ctx.companyId, sql.join(conds, sql` and `))} order by r.number desc, l.line limit ${input.limit} offset ${input.offset}`);
    const loaded = await pressLinesLoaded(ctx.db, ctx.companyId, rows.map((r) => r.id));
    const items: AgeingAvailableLine[] = rows.map((l) => {
      const was = loaded.get(l.id) ?? { pcs: 0, kgG: 0 };
      return {
        pressRunLineId: l.id,
        pressRunId: l.run_id,
        pressRunNumber: l.run_number,
        dieId: l.section_id,
        sectionLabel: sectionLabel({ name: l.die_name, series: l.series, sectionCode: l.section_code }),
        dieInstanceId: l.die_instance_id,
        dieInstanceCode: l.die_instance_code,
        castId: l.cast_id,
        castCode: l.cast_code,
        alloy: l.alloy,
        temper: l.temper,
        lengthMm: num(l.cut_length_mm),
        pcsLeft: Math.max(0, num(l.pcs) - was.pcs),
        kgLeftG: Math.max(0, num(l.good_g) - was.kgG),
        salesOrderLineId: l.sales_order_line_id,
        salesOrderNumber: l.sales_order_number,
        customerName: l.customer_name,
      };
    });
    return { items };
  });

const availableBundlesProcedure = actionProcedure("ageing.load")
  .input(ageingAvailableBundlesInput)
  .query(async ({ ctx, input }) => {
    const conds: SQL[] = [sql`b.company_id = ${ctx.companyId}`, sql`b.status = 'available'`, sql`b.ageing_row_id is null`];
    if (input.dieId) conds.push(sql`b.die_id = ${input.dieId}`);
    if (input.castId) conds.push(sql`b.cast_id = ${input.castId}`);
    if (input.search) conds.push(sql`b.serial like ${`%${input.search}%`}`);
    conds.push(sql`not exists (select 1 from ageing_row r join ageing_batch ab on ab.id = r.batch_id and ab.company_id = r.company_id
      where r.company_id = b.company_id and r.bundle_id = b.id and r.status <> 'void' and ab.status in ('loading','in_oven','out','released','held'))`);
    const rows = await ctx.db.all<{
      id: string;
      serial: string;
      die_id: string;
      die_name: string | null;
      series: string | null;
      section_code: string | null;
      length_mm: number | null;
      quantity: number;
      weight_g: number;
      cast_code: string | null;
      alloy: string | null;
      temper: string | null;
    }>(sql`select b.id, b.serial, b.die_id, d.name as die_name, d.series, d.section_code, b.length_mm, b.quantity, b.weight_g, c.number as cast_code, c.alloy,
        coalesce(sol.temper, d.temper) as temper
      from bundle b join die d on d.id = b.die_id and d.company_id = b.company_id
      left join cast c on c.id = b.cast_id and c.company_id = b.company_id
      left join sales_order_line sol on sol.id = coalesce(b.packed_sales_order_line_id, b.sales_order_line_id) and sol.company_id = b.company_id
      where ${sql.join(conds, sql` and `)} order by b.created_at desc limit ${input.limit} offset ${input.offset}`);
    return {
      items: rows.map((b) => ({
        bundleId: b.id,
        serial: b.serial,
        dieId: b.die_id,
        sectionLabel: sectionLabel({ name: b.die_name, series: b.series, sectionCode: b.section_code }),
        lengthMm: numOrZero(b.length_mm),
        pcs: num(b.quantity),
        weightG: num(b.weight_g),
        castCode: b.cast_code,
        alloy: b.alloy,
        temper: b.temper,
      })),
    };
  });
const numOrZero = (v: unknown) => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------------------
// Pack source, bundle trace, the order view
// ---------------------------------------------------------------------------

const packSourceProcedure = anyActionProcedure("bundle.pack", "ageing.view")
  .input(ageingPackSourceInput)
  .query(async ({ ctx, input }) => {
    const conds: SQL[] = [
      sql`r.company_id = ${ctx.companyId}`,
      sql`r.status = 'released'`,
      sql`r.source <> 'bundle'`,
      sql`b.status = 'released'`,
      sql`${remainingOf("r")} > 0`,
    ];
    if (input.dieId) conds.push(sql`r.die_id = ${input.dieId}`);
    if (input.salesOrderLineId) conds.push(sql`r.sales_order_line_id = ${input.salesOrderLineId}`);
    const rows = await ctx.db.all<{
      id: string;
      trolley_code: string;
      batch_number: string;
      die_instance_code: string | null;
      die_name: string | null;
      series: string | null;
      section_code: string | null;
      length_mm: number;
      remaining: number;
      so_number: string | null;
      customer_name: string | null;
      cast_code: string | null;
    }>(sql`select r.id, t.code as trolley_code, b.number as batch_number, di.code as die_instance_code, d.name as die_name, d.series, d.section_code,
        r.length_mm, ${remainingOf("r")} as remaining, so.number as so_number, cu.name as customer_name, c.number as cast_code
      from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
      join trolley t on t.id = b.trolley_id and t.company_id = b.company_id
      join die d on d.id = r.die_id and d.company_id = r.company_id
      left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
      left join cast c on c.id = r.cast_id and c.company_id = r.company_id
      left join sales_order_line sol on sol.id = r.sales_order_line_id and sol.company_id = r.company_id
      left join sales_order so on so.id = sol.sales_order_id and so.company_id = r.company_id
      left join customer cu on cu.id = so.customer_id and cu.company_id = r.company_id
      where ${sql.join(conds, sql` and `)} order by b.released_at, b.number, r.sort_order limit ${input.limit} offset ${input.offset}`);
    const items: AgeingPackSourceRow[] = rows.map((r) => ({
      ageingRowId: r.id,
      trolleyCode: r.trolley_code,
      batchNumber: r.batch_number,
      dieInstanceCode: r.die_instance_code,
      sectionLabel: sectionLabel({ name: r.die_name, series: r.series, sectionCode: r.section_code }),
      cutLengthMm: num(r.length_mm),
      remainingPcs: num(r.remaining),
      salesOrderNumber: r.so_number,
      customerName: r.customer_name,
      castCode: r.cast_code,
    }));
    return { items };
  });

const bundleTraceProcedure = companyProcedure.input(ageingBundleTraceInput).query(async ({ ctx, input }): Promise<AgeingBundleTrace> => {
  const [b] = await ctx.db
    .select({ id: bundle.id, ageingRowId: bundle.ageingRowId })
    .from(bundle)
    .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.id, input.bundleId)))
    .limit(1);
  if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
  const open = (await openBundleRows(ctx.db, ctx.companyId, [b.id])).get(b.id) ?? null;
  const rowId = open?.rowId ?? b.ageingRowId;
  const state = bundleAgeingState({ ageingRowId: b.ageingRowId, openRow: open });
  const empty: AgeingBundleTrace = {
    bundleId: b.id,
    state,
    ageingRowId: null,
    batchId: null,
    batchNumber: null,
    trolleyCode: null,
    ovenCode: null,
    recipeLabel: null,
    inAt: null,
    outAt: null,
    releasedAt: null,
    qcVerdict: null,
    hardnessMethod: null,
    hardnessReadingX10: null,
    pressRunId: null,
    pressRunNumber: null,
    castId: null,
    castCode: null,
  };
  if (!rowId) return empty;
  const [row] = await readRows(ctx.db, ctx.companyId, [
    (await ctx.db.select({ batchId: ageingRow.batchId }).from(ageingRow).where(and(eq(ageingRow.companyId, ctx.companyId), eq(ageingRow.id, rowId))).limit(1))[0]?.batchId ?? "",
  ]).then((rows) => rows.filter((r) => r.id === rowId));
  if (!row) return empty;
  const batch = await readBatch(ctx.db, ctx.companyId, row.batchId);
  const names = (await batchNames(ctx.db, ctx.companyId, [batch])).get(batch.id);
  return {
    ...empty,
    ageingRowId: row.id,
    batchId: batch.id,
    batchNumber: batch.number,
    trolleyCode: names?.trolleyCode ?? null,
    ovenCode: names?.ovenCode ?? null,
    recipeLabel: summaryOf(batch, [row], names).recipeLabel,
    inAt: ms(batch.inAt),
    outAt: ms(batch.outAt),
    releasedAt: ms(batch.releasedAt),
    qcVerdict: batch.qcVerdict,
    hardnessMethod: row.hardnessMethod,
    hardnessReadingX10: row.hardnessReadingX10,
    pressRunId: row.pressRunId,
    pressRunNumber: row.pressRunNumber,
    castId: row.castId,
    castCode: row.castCode,
  };
});

/** Per order line (FP-AG-15): pieces by where they are, theoretical kg, and the strip's agedG. */
export async function ageingForOrderLines(db: OrrnDb, companyId: string, lineIds: readonly string[]): Promise<AgeingForOrderLine[]> {
  const out = new Map<string, AgeingForOrderLine>(
    lineIds.map((id) => [
      id,
      { salesOrderLineId: id, agedG: 0, loadedPcs: 0, loadedKgG: 0, inOvenPcs: 0, outUntestedPcs: 0, heldPcs: 0, releasedPcs: 0, packedPcs: 0, remainingPcs: 0 },
    ]),
  );
  for (const ids of chunk([...lineIds], IN_LIST_CHUNK)) {
    const rows = await db.all<{
      line_id: string;
      source: string;
      status: string;
      batch_status: string;
      pcs: number;
      kg_g: number;
      packed_pcs: number;
      scrap_pcs: number;
      rework_pcs: number;
      is_successor: number;
    }>(sql`select r.sales_order_line_id as line_id, r.source, r.status, b.status as batch_status, r.pcs, r.kg_g, r.packed_pcs, r.scrap_pcs, r.rework_pcs,
        exists (select 1 from ageing_row o where o.company_id = r.company_id and o.rework_row_id = r.id) as is_successor
      from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
      where r.company_id = ${companyId} and r.status <> 'void' and b.status <> 'void'
        and r.sales_order_line_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    for (const r of rows) {
      const o = out.get(r.line_id)!;
      const counts = { pcs: num(r.pcs), packedPcs: num(r.packed_pcs), scrapPcs: num(r.scrap_pcs), reworkPcs: num(r.rework_pcs) };
      const left = ageingRowRemaining(counts);
      o.loadedPcs += counts.pcs - counts.reworkPcs;
      if (!Number(r.is_successor)) o.loadedKgG += num(r.kg_g);
      o.packedPcs += counts.packedPcs;
      o.remainingPcs += left;
      if (r.batch_status === "in_oven" || r.batch_status === "loading") o.inOvenPcs += left;
      else if (r.status === "pending") o.outUntestedPcs += left;
      else if (r.status === "held") o.heldPcs += left;
      else if (r.status === "released") o.releasedPcs += left;
      if (r.source !== "bundle" && counts.pcs > 0) o.agedG += Math.floor((num(r.kg_g) * left) / counts.pcs);
    }
  }
  return [...out.values()];
}

const forOrderProcedure = anyActionProcedure("order.manage", "ageing.view", "reports.read")
  .input(ageingForOrderInput)
  .query(async ({ ctx, input }) => {
    const lines = await ctx.db
      .select({ id: salesOrderLine.id })
      .from(salesOrderLine)
      .where(and(eq(salesOrderLine.companyId, ctx.companyId), eq(salesOrderLine.salesOrderId, input.salesOrderId)))
      .orderBy(asc(salesOrderLine.lineNo));
    return { lines: await ageingForOrderLines(ctx.db, ctx.companyId, lines.map((l) => l.id)) };
  });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ageingRouter = router({
  ovens: ovensRouter,
  trolleys: trolleysRouter,
  recipes: recipesRouter,
  batches: router({
    list: listProcedure,
    get: actionProcedure("ageing.view")
      .input(idInput)
      .query(({ ctx, input }) => detail(ctx, input.id)),
    availableLines: availableLinesProcedure,
    availableBundles: availableBundlesProcedure,
    load: loadProcedure,
    start: startProcedure,
    temp: tempProcedure,
    out: outProcedure,
    hardness: hardnessProcedure,
    release: releaseProcedure,
    requestOverride: requestOverrideProcedure,
    hold: holdProcedure,
    unhold: unholdProcedure,
    rework: reworkProcedure,
    discardRemaining: discardProcedure,
    split: splitProcedure,
    void: voidProcedure,
    simulate: simulateProcedure,
  }),
  packSource: packSourceProcedure,
  bundleTrace: bundleTraceProcedure,
  forOrder: forOrderProcedure,
});
