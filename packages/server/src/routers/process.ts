/**
 * Process steps (XE parity lane JOBWORK, rows 33, 54, 55, 56): one engine for job work out to a
 * vendor, an in-house finishing line, the draw bench and fabrication. Rules in `@orrn/domain`
 * `jobwork.ts`, statements in `lib/processSteps.ts`, gates other modules call in `lib/process.ts`.
 *
 * - `vendors.list | save`: job-work vendors; each has its own location of kind `vendor`.
 * - `steps.send`: a job-work challan (JW/2026-27/n); the bundles move to the vendor's location and go
 *   on hold (reason `jobwork`): not packable, dispatchable, movable or plant stock until they return.
 * - `steps.start`: an in-house step (PS/2026-27/n); the bundles stay where they are, on hold (`process`).
 * - `steps.receive`: the same bundles back (weight after, rejects, finish set; the loss is a
 *   `process_loss` ledger row) or new output bundles (inputs used up: `process_in` + `process_loss`,
 *   outputs `process_out`). Rejects and process scrap post `process_scrap` at PLANT-SCRAP.
 * - `steps.cancel`: before anything came back, the bundles go back where they came from.
 * - `steps.list` (register), `steps.pending` (at the vendor, with age), `steps.get`, `steps.challan`
 *   (the A4 delivery challan snapshot; the client prints), `forOrder` (finish requirement per line),
 *   `forBundle` (the bundle page).
 *
 * The router serves three modules, so each step mutation calls `assertModule` for its kind
 * (`PROCESS_KIND_MODULE`); reads stay open as everywhere else. Money (rates, values, cost) is shown
 * only to `jobwork.cost` holders and is integer paise.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { bundle, bundleGroup, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { processHold, processInput, processOutput, processReturn, processStep, processVendor } from "@orrn/db/schema/process";
import { bundleTransfer, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";
import {
  challanValuePaise,
  daysAtVendor,
  daysToJobworkLimit,
  fabricationOps,
  finishOfProcess,
  finishProcesses,
  isOutKind,
  isOverdue,
  PROCESS_KIND_MODULE,
  processCost,
  processDocType,
  returnRefusal,
  returnFigures,
  shareLoss,
  vendorAgeBucket,
  bundleFinishState,
  type BundleNumberPolicy,
  type ProcessKind,
  type VendorAgeBucket,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, chunk, mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { isProcessAbort as isBatchAbort, processAbortUnless as abortBatchUnless } from "../lib/process";
import { auditInsert } from "../lib/audit";
import { formatBundleSerial, formatGroupCode } from "../lib/bundleSerial";
import { kgPer12ftMilli } from "../lib/bundleWeight";
import { now as clockNow } from "../lib/clock";
import { resolveCode } from "../lib/codeResolver";
import { companyTimezone, zonedYmd } from "../lib/dayWindow";
import { allocateDocNumbers, allocatePartyBundleNumbers, nextDocNumber } from "../lib/docNumber";
import { resolvePlantScrap } from "../lib/foundry";
import { locationIsEmpty, moveRows, packRows, type PostingCtx } from "../lib/ledger";
import { assertModule } from "../lib/moduleGate";
import { letterhead } from "../lib/packingListSnapshot";
import { plantScrapStreamId, plantScrapStreamStatements } from "../lib/pack";
import { can, type Action } from "../lib/permissions";
import { jobworkRefusal } from "../lib/processRefusals";
import {
  allLandedAborts,
  assertSendable,
  BAL,
  balanceRows,
  closeInputStatements,
  holdRows,
  MAX_STEP_BUNDLES,
  onStepSql,
  readStepBundles,
  releaseHoldStatements,
  scrapLedgerRow,
  sendableSql,
  STEP_IN_CHUNK,
} from "../lib/processSteps";
import { nextCompanySeq } from "../lib/sequence";
import type { Context } from "../context";

type Ctx = Context & { companyId: string; role: NonNullable<Context["role"]>; session: NonNullable<Context["session"]> };

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();
const paise = z.number().int().min(0).max(100_000_000);
const grams = z.number().int().min(0).max(100_000_000);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bundlePick = {
  bundleIds: z.array(id).max(MAX_STEP_BUNDLES).optional(),
  /** Scanned or typed numbers (serial, party number, QR text). */
  codes: z.array(z.string().trim().min(1).max(200)).max(MAX_STEP_BUNDLES).optional(),
};

const can_ = (ctx: Ctx, a: Action) => can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, a);
const seesCost = (ctx: Ctx) => can_(ctx, "jobwork.cost");
const auditCtx = (ctx: Ctx) => ({ db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation });

async function plantSettings(ctx: Ctx): Promise<Record<string, unknown>> {
  const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
  return (co?.settings ?? {}) as Record<string, unknown>;
}

function ymdOf(tz: string, ms: number): string {
  const y = zonedYmd(tz, ms);
  return `${y.year}-${String(y.month).padStart(2, "0")}-${String(y.day).padStart(2, "0")}`;
}

/** Bundle ids for ids + scanned codes, refused by name when a code is unknown, ambiguous or listed twice. */
async function pickBundles(ctx: Ctx, input: { bundleIds?: string[]; codes?: string[] }): Promise<string[]> {
  const out: string[] = [...(input.bundleIds ?? [])];
  for (const code of input.codes ?? []) {
    const r = await resolveCode(ctx.db, ctx.companyId, code);
    if (r.kind === "bundle") out.push(r.bundleId);
    else if (r.kind === "ambiguous") throw new TRPCError({ code: "BAD_REQUEST", message: `More than one bundle matches ${code}; scan the full number` });
    else throw new TRPCError({ code: "NOT_FOUND", message: `Bundle not found: ${code}` });
  }
  if (out.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Scan at least one bundle" });
  if (out.length > MAX_STEP_BUNDLES) throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_STEP_BUNDLES} bundles on one step` });
  const seen = new Set<string>();
  for (const b of out) {
    if (seen.has(b)) {
      const [row] = await ctx.db.select({ serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.id, b))).limit(1);
      throw jobworkRefusal("bundle_twice", { serial: row?.serial ?? "" });
    }
    seen.add(b);
  }
  return out;
}

async function readStep(ctx: Ctx, stepId: string) {
  const [s] = await ctx.db.select().from(processStep).where(and(eq(processStep.companyId, ctx.companyId), eq(processStep.id, stepId))).limit(1);
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return s;
}

async function readVendor(ctx: Ctx, vendorId: string) {
  const [v] = await ctx.db.select().from(processVendor).where(and(eq(processVendor.companyId, ctx.companyId), eq(processVendor.id, vendorId))).limit(1);
  if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return v;
}

/** The yard bundles come back to (or new output goes to): an active yard of this plant. */
async function readYard(ctx: Ctx, locationId: string | null | undefined) {
  if (!locationId) throw jobworkRefusal("no_yard");
  const [y] = await ctx.db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(and(eq(location.companyId, ctx.companyId), eq(location.id, locationId), eq(location.kind, "yard"), eq(location.active, true)))
    .limit(1);
  if (!y) throw jobworkRefusal("no_yard");
  return y;
}

function assertProcessFits(kind: ProcessKind, process: string): void {
  const ok =
    kind === "jobwork" || kind === "finish"
      ? (finishProcesses as readonly string[]).includes(process) && !(kind === "finish" && process === "machining")
      : process === kind;
  if (!ok) throw jobworkRefusal("process_kind_mismatch");
}

/** Strip money for callers without `jobwork.cost`. */
function money<T extends Record<string, unknown>>(ctx: Ctx, row: T, keys: readonly (keyof T)[]): T {
  if (seesCost(ctx)) return row;
  const out = { ...row };
  for (const k of keys) (out as Record<string, unknown>)[k as string] = null;
  return out;
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

const vendorCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,12}$/, "Use letters, digits and dashes for the code, at most 12");

const vendorsRouter = router({
  list: companyProcedure.input(z.object({ includeInactive: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({
        id: processVendor.id,
        code: processVendor.code,
        name: processVendor.name,
        gstin: processVendor.gstin,
        address: processVendor.address,
        state: processVendor.state,
        phone: processVendor.phone,
        processes: processVendor.processes,
        ratePaisePerKg: processVendor.ratePaisePerKg,
        active: processVendor.active,
        note: processVendor.note,
        locationId: processVendor.locationId,
        outBundles: sql<number>`(select count(*) from bundle b where b.company_id = ${ctx.companyId} and b.location_id = ${processVendor.locationId} and b.status in ('available', 'reserved'))`,
        outG: sql<number>`(select coalesce(sum(b.weight_g), 0) from bundle b where b.company_id = ${ctx.companyId} and b.location_id = ${processVendor.locationId} and b.status in ('available', 'reserved'))`,
      })
      .from(processVendor)
      .where(and(eq(processVendor.companyId, ctx.companyId), input?.includeInactive ? undefined : eq(processVendor.active, true)))
      .orderBy(asc(processVendor.code))
      .limit(500);
    return { items: rows.map((r) => money(ctx as Ctx, { ...r, outBundles: Number(r.outBundles), outG: Number(r.outG) }, ["ratePaisePerKg"])) };
  }),

  save: actionProcedure("jobwork.masters")
    .input(
      z.object({
        id: id.optional(),
        code: vendorCode,
        name: text(120).min(1),
        gstin: optText(15),
        address: optText(300),
        state: optText(60),
        phone: optText(30),
        processes: z.array(z.enum(finishProcesses)).max(finishProcesses.length).default([]),
        ratePaisePerKg: paise.nullable().optional(),
        active: z.boolean().optional(),
        note: optText(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as Ctx;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const fields = {
        code: input.code,
        name: input.name,
        gstin: input.gstin?.toUpperCase() || null,
        address: input.address || null,
        state: input.state || null,
        phone: input.phone || null,
        processes: input.processes,
        ratePaisePerKg: input.ratePaisePerKg ?? null,
        note: input.note || null,
      };
      if (!input.id) {
        const [taken] = await ctx.db
          .select({ id: location.id })
          .from(location)
          .where(and(eq(location.companyId, ctx.companyId), eq(location.code, `JW-${input.code}`)))
          .limit(1);
        const [takenV] = await ctx.db.select({ id: processVendor.id }).from(processVendor).where(and(eq(processVendor.companyId, ctx.companyId), eq(processVendor.code, input.code))).limit(1);
        if (taken || takenV) throw jobworkRefusal("vendor_code_taken", { code: input.code });
        const vendorId = crypto.randomUUID();
        const locationId = crypto.randomUUID();
        await atomicBatch(ctx.db, [
          ctx.db.insert(location).values({ id: locationId, companyId: ctx.companyId, serverSeq: seq, code: `JW-${input.code}`, name: input.name.slice(0, 100), kind: "vendor", active: true, sortOrder: 9_000, createdBy: ctx.session.user.id }),
          ctx.db.insert(processVendor).values({ id: vendorId, companyId: ctx.companyId, serverSeq: seq, ...fields, active: input.active ?? true, locationId, createdBy: ctx.session.user.id }),
          auditInsert(auditCtx(c), { action: "process.vendor.save", subjectType: "process_vendor", subjectId: vendorId, meta: { code: input.code, created: true } }),
        ]);
        return { id: vendorId };
      }
      const existing = await readVendor(c, input.id);
      if (existing.code !== input.code) {
        const [takenV] = await ctx.db.select({ id: processVendor.id }).from(processVendor).where(and(eq(processVendor.companyId, ctx.companyId), eq(processVendor.code, input.code))).limit(1);
        const [taken] = await ctx.db.select({ id: location.id }).from(location).where(and(eq(location.companyId, ctx.companyId), eq(location.code, `JW-${input.code}`))).limit(1);
        if (takenV || taken) throw jobworkRefusal("vendor_code_taken", { code: input.code });
      }
      const active = input.active ?? existing.active;
      const retiring = existing.active && !active;
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(location)
          .set({ code: `JW-${input.code}`, name: input.name.slice(0, 100), active, serverSeq: seq })
          .where(and(eq(location.companyId, ctx.companyId), eq(location.id, existing.locationId), retiring ? locationIsEmpty(ctx.db, ctx.companyId, existing.locationId) : undefined)),
        abortBatchUnless(ctx.db, sql`changes() > 0`),
        ctx.db.update(processVendor).set({ ...fields, active, serverSeq: seq }).where(and(eq(processVendor.companyId, ctx.companyId), eq(processVendor.id, existing.id))),
        auditInsert(auditCtx(c), { action: "process.vendor.save", subjectType: "process_vendor", subjectId: existing.id, meta: { code: input.code, active } }),
      ];
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e)) throw jobworkRefusal("vendor_has_stock", { code: existing.code });
        throw e;
      }
      return { id: existing.id };
    }),
});

// ---------------------------------------------------------------------------
// Steps: open (send / start)
// ---------------------------------------------------------------------------

const openCommon = {
  ...bundlePick,
  finishCode: optText(40),
  ratePaisePerKg: paise.nullable().optional(),
  note: optText(500),
};

async function openStep(
  c: Ctx,
  o: {
    kind: ProcessKind;
    process: string;
    bundleIds: string[];
    vendor: { id: string; locationId: string } | null;
    fields: Partial<typeof processStep.$inferInsert>;
  },
) {
  const rows = await readStepBundles(c.db, c.companyId, o.bundleIds);
  if (rows.length !== o.bundleIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  // Keep the caller's order (the challan lists bundles as scanned).
  const order = new Map(o.bundleIds.map((b, i) => [b, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  await assertSendable(c.db, c.companyId, rows);

  const now = clockNow();
  const userId = c.session.user.id;
  const docNo = await nextDocNumber(c.db, c.companyId, processDocType(o.kind), now, userId);
  const seq = await nextCompanySeq({ db: c.db }, c.companyId);
  const stepId = crypto.randomUUID();
  const ids = rows.map((b) => b.id);
  const posting: PostingCtx = { db: c.db, companyId: c.companyId, userId, seq, postedAt: now };

  const statements: SqliteBatchItem[] = [
    c.db.insert(processStep).values({
      id: stepId,
      companyId: c.companyId,
      serverSeq: seq,
      number: docNo.number,
      period: docNo.period,
      kind: o.kind,
      process: o.process,
      vendorId: o.vendor?.id ?? null,
      status: "open",
      inputG: rows.reduce((a, b) => a + b.weightG, 0),
      inputPcs: rows.reduce((a, b) => a + b.quantity, 0),
      sentBy: userId,
      sentAt: now,
      ...o.fields,
    }),
  ];
  pushChunkedInserts(
    statements,
    (part) => c.db.insert(processInput).values(part),
    rows.map((b) => ({
      id: crypto.randomUUID(),
      companyId: c.companyId,
      stepId,
      bundleId: b.id,
      serial: b.serial,
      dieId: b.dieId,
      weightG: b.weightG,
      pcs: b.quantity,
      lengthMm: b.lengthMm,
      fromLocationId: b.locationId,
      returnId: null,
      createdAt: now,
    })),
  );
  if (o.vendor) {
    // Out to the vendor = a location move (− at the yard, + at the vendor), only while still free.
    statements.push(...moveRows(posting, { voucherId: stepId, bundleIds: ids, toLocationId: o.vendor.locationId, toKind: "vendor", reason: docNo.number, onlyIf: sendableSql(c.companyId) }));
    statements.push(...allLandedAborts(c.db, c.companyId, ids, seq, sql`b.location_id = ${o.vendor.locationId}`));
  } else {
    // In-house: the bundles stay where they are; stamp them so a lost race fails the batch.
    for (const part of chunk(ids, STEP_IN_CHUNK)) {
      statements.push(c.db.update(bundle).set({ serverSeq: seq }).where(and(eq(bundle.companyId, c.companyId), inArray(bundle.id, part), sendableSql(c.companyId))));
    }
    statements.push(...allLandedAborts(c.db, c.companyId, ids, seq));
  }
  pushChunkedInserts(statements, (part) => c.db.insert(processHold).values(part), holdRows(c.companyId, stepId, o.vendor ? "jobwork" : "process", ids, now));
  statements.push(
    auditInsert(auditCtx(c), {
      action: o.vendor ? "process.send" : "process.start",
      subjectType: "process_step",
      subjectId: stepId,
      meta: { number: docNo.number, kind: o.kind, process: o.process, bundles: rows.length, kgG: rows.reduce((a, b) => a + b.weightG, 0), serials: rows.slice(0, 50).map((b) => b.serial) },
    }),
  );
  try {
    await atomicBatch(c.db, statements);
  } catch (e) {
    if (isBatchAbort(e)) {
      // Something changed between the read and the write: say what, by name.
      await assertSendable(c.db, c.companyId, await readStepBundles(c.db, c.companyId, ids));
      throw new TRPCError({ code: "CONFLICT", message: "The bundles changed meanwhile. Reload and try again." });
    }
    throw e;
  }
  return { id: stepId, number: docNo.number };
}

// ---------------------------------------------------------------------------
// Steps: receive
// ---------------------------------------------------------------------------

const receiveInput = z.object({
  id,
  mode: z.enum(["same", "new"]),
  /** The yard bundles come back to (job work) or new output goes to. In-house same-mode bundles stay where they are. */
  locationId: id.nullable().optional(),
  vendorDocNo: optText(40),
  ratePaisePerKg: paise.nullable().optional(),
  minutes: z.number().int().min(0).max(100_000).nullable().optional(),
  passes: z.number().int().min(0).max(100).nullable().optional(),
  scrapG: grams.default(0),
  note: optText(500),
  /** mode `same`: each bundle back, its weight after the process and its rejects. */
  same: z
    .array(z.object({ bundleId: id, weightG: z.number().int().min(1).max(100_000_000), rejectPcs: z.number().int().min(0).max(100_000).default(0), rejectG: grams.default(0) }))
    .max(MAX_STEP_BUNDLES)
    .optional(),
  /** mode `new`: the inputs this return uses up (default every input still out) and the new bundles. */
  inputBundleIds: z.array(id).max(MAX_STEP_BUNDLES).optional(),
  outputs: z
    .array(z.object({ dieId: id.optional(), lengthMm: z.number().int().min(1).max(20_000), pcs: z.number().int().min(1).max(100_000), weightG: z.number().int().min(1).max(100_000_000) }))
    .max(MAX_STEP_BUNDLES)
    .optional(),
  rejectPcs: z.number().int().min(0).max(100_000).default(0),
  rejectG: grams.default(0),
});

async function receiveStep(c: Ctx, input: z.infer<typeof receiveInput>) {
  const step = await readStep(c, input.id);
  await assertModule(c, PROCESS_KIND_MODULE[step.kind]);
  if (!can_(c, isOutKind(step.kind) ? "jobwork.receive" : "process.run")) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
  if (step.status !== "open" && step.status !== "partial") throw jobworkRefusal("step_closed", { step: step.number });

  const inputs = await c.db.select().from(processInput).where(and(eq(processInput.companyId, c.companyId), eq(processInput.stepId, step.id)));
  const byBundle = new Map(inputs.map((i) => [i.bundleId, i]));
  const serialOf = async (bundleId: string) =>
    (await c.db.select({ serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, c.companyId), eq(bundle.id, bundleId))).limit(1))[0]?.serial ?? "";
  const takeInput = async (bundleId: string) => {
    const i = byBundle.get(bundleId);
    if (!i) throw jobworkRefusal("input_not_on_step", { serial: await serialOf(bundleId), step: step.number });
    if (i.returnId) throw jobworkRefusal("input_already_back", { serial: i.serial, step: step.number });
    return i;
  };

  const out = isOutKind(step.kind);
  const vendor = step.vendorId ? await readVendor(c, step.vendorId) : null;
  const finish = finishOfProcess(step.process);
  const now = clockNow();
  const userId = c.session.user.id;

  // Inputs closed by this return and the figures.
  let closing: (typeof inputs)[number][];
  let outputG: number;
  let outputPcs: number;
  let rejectG: number;
  let rejectPcs: number;
  if (input.mode === "same") {
    const same = input.same ?? [];
    if (same.length === 0) throw jobworkRefusal("no_output");
    closing = [];
    const seen = new Set<string>();
    for (const r of same) {
      if (seen.has(r.bundleId)) throw jobworkRefusal("bundle_twice", { serial: await serialOf(r.bundleId) });
      seen.add(r.bundleId);
      const i = await takeInput(r.bundleId);
      if (r.rejectPcs >= i.pcs) throw new TRPCError({ code: "BAD_REQUEST", message: `Bundle ${i.serial} has ${i.pcs} pieces; rejects must leave at least one` });
      closing.push(i);
    }
    outputG = same.reduce((a, r) => a + r.weightG, 0);
    rejectG = same.reduce((a, r) => a + r.rejectG, 0);
    rejectPcs = same.reduce((a, r) => a + r.rejectPcs, 0);
    outputPcs = closing.reduce((a, i) => a + i.pcs, 0) - rejectPcs;
  } else {
    const wanted = input.inputBundleIds?.length ? input.inputBundleIds : inputs.filter((i) => !i.returnId).map((i) => i.bundleId);
    if (wanted.length === 0) throw jobworkRefusal("step_closed", { step: step.number });
    closing = [];
    for (const b of new Set(wanted)) closing.push(await takeInput(b));
    const outs = input.outputs ?? [];
    outputG = outs.reduce((a, o) => a + o.weightG, 0);
    outputPcs = outs.reduce((a, o) => a + o.pcs, 0);
    rejectG = input.rejectG;
    rejectPcs = input.rejectPcs;
  }
  const inputG = closing.reduce((a, i) => a + i.weightG, 0);
  const fig = { inputG, outputG, rejectG, scrapG: input.scrapG };
  const refusal = returnRefusal(fig, { coat: finish !== null });
  if (refusal) throw jobworkRefusal(refusal);
  const figures = returnFigures(fig);

  // Where they come back to.
  const yard = out || input.mode === "new" ? await readYard(c, input.locationId) : null;
  const rate = input.ratePaisePerKg !== undefined && input.ratePaisePerKg !== null ? input.ratePaisePerKg : step.ratePaisePerKg;
  const cost = processCost({ ratePaisePerKg: rate, billedG: inputG, outputG });

  const needScrap = rejectG + input.scrapG > 0;
  const plantScrap = needScrap ? await resolvePlantScrap(c.db, c.companyId) : null;
  const existingStream = needScrap ? await plantScrapStreamId(c.db, c.companyId) : null;
  const streamId = existingStream ?? crypto.randomUUID();

  const seq = await nextCompanySeq({ db: c.db }, c.companyId);
  const returnId = crypto.randomUUID();
  const [{ n: priorReturns } = { n: 0 }] = await c.db
    .select({ n: sql<number>`count(*)` })
    .from(processReturn)
    .where(and(eq(processReturn.companyId, c.companyId), eq(processReturn.stepId, step.id)));
  const posting: PostingCtx = { db: c.db, companyId: c.companyId, userId, seq, postedAt: now };
  const closingIds = closing.map((i) => i.bundleId);
  const statements: SqliteBatchItem[] = [];
  const outputRows: (typeof processOutput.$inferInsert)[] = [];
  let newBundleIds: string[] = [];

  if (input.mode === "same") {
    const same = new Map((input.same ?? []).map((r) => [r.bundleId, r]));
    if (out) {
      statements.push(
        ...moveRows(posting, {
          voucherId: returnId,
          bundleIds: closingIds,
          toLocationId: yard!.id,
          reason: step.number,
          onlyIf: and(eq(bundle.locationId, vendor!.locationId), onStepSql(c.companyId, step.id)),
        }),
      );
    } else {
      for (const part of chunk(closingIds, STEP_IN_CHUNK)) {
        statements.push(
          c.db
            .update(bundle)
            .set({ serverSeq: seq })
            .where(and(eq(bundle.companyId, c.companyId), inArray(bundle.id, part), inArray(bundle.status, ["available", "reserved"]), onStepSql(c.companyId, step.id))),
        );
      }
    }
    // The weight after the process, pieces less rejects, the finish; only on a bundle our move (or stamp) landed.
    for (const i of closing) {
      const r = same.get(i.bundleId)!;
      const quantity = i.pcs - r.rejectPcs;
      statements.push(
        c.db
          .update(bundle)
          .set({
            weightG: r.weightG,
            quantity,
            kgPer12ftMilli: kgPer12ftMilli({ weightG: r.weightG, quantity, lengthMm: i.lengthMm }),
            ...(finish ? { finish, finishCode: step.finishCode } : {}),
            serverSeq: seq,
          })
          .where(and(eq(bundle.companyId, c.companyId), eq(bundle.id, i.bundleId), eq(bundle.serverSeq, seq), eq(bundle.weightG, i.weightG))),
      );
      outputRows.push({ id: crypto.randomUUID(), companyId: c.companyId, returnId, stepId: step.id, bundleId: i.bundleId, inputBundleId: i.bundleId, weightG: r.weightG, pcs: quantity, lengthMm: i.lengthMm, rejectPcs: r.rejectPcs, rejectG: r.rejectG, createdAt: now });
    }
    statements.push(...allLandedAborts(c.db, c.companyId, closingIds, seq, out ? sql`b.location_id = ${yard!.id}` : undefined));
    // Loss (or a coat's gain) = the new weight − the ledger balance, at the bundle's place now.
    statements.push(
      ...balanceRows(c.db, closingIds, {
        companyId: c.companyId,
        seq,
        userId,
        postedAt: now,
        voucherType: "process_loss",
        voucherId: returnId,
        lineOffset: 0,
        reason: `${step.number} loss`,
        qty: sql`b.weight_g - ${BAL}`,
        where: sql`1 = 1`,
      }),
    );
  } else {
    // New output: the inputs are used up where they sit (at the vendor, or in the yard).
    for (const part of chunk(closingIds, STEP_IN_CHUNK)) {
      statements.push(
        c.db
          .update(bundle)
          .set({ status: "void", serverSeq: seq })
          .where(and(eq(bundle.companyId, c.companyId), inArray(bundle.id, part), eq(bundle.status, "available"), onStepSql(c.companyId, step.id))),
      );
    }
    statements.push(...allLandedAborts(c.db, c.companyId, closingIds, seq, sql`b.status = 'void'`));
    // Each input closes as − (its kg − its share of the loss) used up and − its share lost.
    const shares = shareLoss(closing.map((i) => i.weightG), figures.lossG);
    closing.forEach((i, idx) => {
      const share = shares[idx]!;
      statements.push(
        ...balanceRows(c.db, [i.bundleId], {
          companyId: c.companyId,
          seq,
          userId,
          postedAt: now,
          voucherType: "process_in",
          voucherId: returnId,
          lineOffset: idx,
          reason: `${step.number} used up`,
          qty: sql`-(${BAL} - ${share})`,
          where: sql`b.status = 'void'`,
        }),
        ...balanceRows(c.db, [i.bundleId], {
          companyId: c.companyId,
          seq,
          userId,
          postedAt: now,
          voucherType: "process_loss",
          voucherId: returnId,
          lineOffset: idx,
          reason: `${step.number} loss`,
          qty: sql`-${share}`,
          where: sql`b.status = 'void'`,
        }),
      );
    });
    pushChunkedInserts(
      statements,
      (part) => c.db.insert(bundleStatusEvent).values(part),
      closing.map((i) => ({ id: crypto.randomUUID(), companyId: c.companyId, bundleId: i.bundleId, fromStatus: "available" as const, toStatus: "void" as const, reason: `process.used:${step.number}`, actorId: userId, at: now })),
    );

    const outs = input.outputs ?? [];
    if (outs.length > 0) {
      const inputBundles = await readStepBundles(c.db, c.companyId, closingIds);
      const dies = [...new Set(inputBundles.map((b) => b.dieId))];
      const lines = [...new Set(inputBundles.map((b) => b.salesOrderLineId))];
      const casts = [...new Set(inputBundles.map((b) => b.castId))];
      const line = lines.length === 1 ? lines[0]! : null;
      const castId = casts.length === 1 ? casts[0]! : null;
      for (const o of outs) {
        if (!o.dieId && dies.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the section of each new bundle" });
      }
      const outDies = [...new Set(outs.map((o) => o.dieId ?? dies[0]!))];
      const foundDies = await c.db.select({ id: die.id }).from(die).where(and(eq(die.companyId, c.companyId), inArray(die.id, outDies)));
      if (foundDies.length !== outDies.length) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const settings = await plantSettings(c);
      const groupId = crypto.randomUUID();
      const groupCode = formatGroupCode(seq);
      const plantNumbers = settings.bundleNumbering === "plant" ? (await allocateDocNumbers(c.db, c.companyId, "bundle", now, outs.length, userId)).numbers : null;
      const serials = outs.map((_, i) => (plantNumbers ? plantNumbers[i]! : formatBundleSerial(groupCode, i + 1)));
      let partyNos = serials;
      if (line) {
        const [l] = await c.db
          .select({ customerId: salesOrder.customerId, policy: customer.bundleNumberPolicy })
          .from(salesOrderLine)
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, c.companyId)))
          .leftJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, c.companyId)))
          .where(and(eq(salesOrderLine.companyId, c.companyId), eq(salesOrderLine.id, line)))
          .limit(1);
        if (l?.policy) partyNos = (await allocatePartyBundleNumbers(c.db, c.companyId, l.customerId, l.policy as BundleNumberPolicy, now, outs.length, userId)).numbers;
      }
      statements.push(
        c.db.insert(bundleGroup).values({
          id: groupId,
          companyId: c.companyId,
          serverSeq: seq,
          code: groupCode,
          dieId: outDies[0]!,
          unit: "pcs",
          purchaseOrderRef: null,
          notes: `${step.number}`,
          ageingBatchId: null,
          dieInstanceId: null,
          createdBy: userId,
        }),
        // The yard is still an active yard (else the outputs would land in a retired place).
        abortBatchUnless(c.db, sql`exists (select 1 from location yl where yl.id = ${yard!.id} and yl.company_id = ${c.companyId} and yl.kind = 'yard' and yl.active = 1)`),
      );
      const newRows = outs.map((o, i) => ({
        id: crypto.randomUUID(),
        companyId: c.companyId,
        serverSeq: seq,
        groupId,
        dieId: o.dieId ?? dies[0]!,
        serial: serials[i]!,
        poNumber: null,
        quantity: o.pcs,
        weightG: o.weightG,
        lengthMm: o.lengthMm,
        status: "available" as const,
        currentDispatchId: null,
        locationId: yard!.id,
        dieInstanceId: null,
        castId,
        salesOrderLineId: line,
        kgPer12ftMilli: kgPer12ftMilli({ weightG: o.weightG, quantity: o.pcs, lengthMm: o.lengthMm }),
        numberStyle: plantNumbers ? ("plant" as const) : ("legacy" as const),
        ageingRowId: null,
        packedSalesOrderLineId: line,
        partyNo: partyNos[i]!,
        recut: false,
        weightSource: "manual" as const,
        weightOverrideReason: null,
        scaleReadingG: null,
        bisStandard: null,
        cmlNo: null,
        showLogo: true,
        finish,
        finishCode: finish ? step.finishCode : null,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }));
      newBundleIds = newRows.map((r) => r.id);
      pushChunkedInserts(statements, (part) => c.db.insert(bundle).values(part), newRows);
      pushChunkedInserts(
        statements,
        (part) => c.db.insert(bundleStatusEvent).values(part),
        newRows.map((r) => ({ id: crypto.randomUUID(), companyId: c.companyId, bundleId: r.id, fromStatus: null, toStatus: "available" as const, reason: `process.output:${step.number}`, actorId: userId, at: now })),
      );
      if (!line) {
        // D20 / C8: output with no order line is plant stock (no line, the latest transfer to no line).
        pushChunkedInserts(
          statements,
          (part) => c.db.insert(bundleTransfer).values(part),
          newRows.map((r) => ({ id: crypto.randomUUID(), companyId: c.companyId, serverSeq: seq, bundleId: r.id, fromSalesOrderLineId: null, toSalesOrderLineId: null, batchId: groupId, reason: `Output of ${step.number}`, createdBy: userId, createdAt: now })),
        );
      }
      statements.push(...packRows(posting, { type: "process_out", id: returnId }, newRows));
      newRows.forEach((r) =>
        outputRows.push({ id: crypto.randomUUID(), companyId: c.companyId, returnId, stepId: step.id, bundleId: r.id, inputBundleId: null, weightG: r.weightG, pcs: r.quantity, lengthMm: r.lengthMm, rejectPcs: 0, rejectG: 0, createdAt: now }),
      );
    }
  }

  // Rejects and process scrap: + at PLANT-SCRAP.
  if (needScrap && plantScrap) {
    statements.push(...plantScrapStreamStatements(c.db, c.companyId, { id: streamId, existing: existingStream !== null, userId, seq }));
    if (rejectG > 0) statements.push(scrapLedgerRow(c.db, { companyId: c.companyId, seq, userId, postedAt: now, returnId, line: 1, weightG: rejectG, plantScrapId: plantScrap.id, streamId, reason: `${step.number} rejects` }));
    if (input.scrapG > 0) statements.push(scrapLedgerRow(c.db, { companyId: c.companyId, seq, userId, postedAt: now, returnId, line: 2, weightG: input.scrapG, plantScrapId: plantScrap.id, streamId, reason: `${step.number} scrap` }));
  }

  statements.push(
    c.db.insert(processReturn).values({
      id: returnId,
      companyId: c.companyId,
      serverSeq: seq,
      stepId: step.id,
      line: Number(priorReturns) + 1,
      mode: input.mode,
      receivedAt: now,
      receivedBy: userId,
      inputG,
      outputG,
      outputPcs,
      rejectG,
      rejectPcs,
      scrapG: input.scrapG,
      lossG: figures.lossG,
      ratePaisePerKg: rate ?? null,
      amountPaise: cost.amountPaise,
      minutes: input.minutes ?? null,
      passes: input.passes ?? null,
      vendorDocNo: input.vendorDocNo || null,
      locationId: yard?.id ?? null,
      note: input.note || null,
      createdAt: now,
    }),
    ...closeInputStatements(c.db, c.companyId, step.id, returnId, closingIds),
    ...releaseHoldStatements(c.db, c.companyId, step.id, closingIds, userId, now),
  );
  pushChunkedInserts(statements, (part) => c.db.insert(processOutput).values(part), outputRows);
  statements.push(
    c.db
      .update(processStep)
      .set({
        status: sql`case when exists (select 1 from process_input pi where pi.company_id = ${c.companyId} and pi.step_id = ${step.id} and pi.return_id is null) then 'partial' else 'done' end`,
        doneAt: sql`case when exists (select 1 from process_input pi where pi.company_id = ${c.companyId} and pi.step_id = ${step.id} and pi.return_id is null) then null else ${now.getTime()} end`,
        serverSeq: seq,
      })
      .where(and(eq(processStep.companyId, c.companyId), eq(processStep.id, step.id), inArray(processStep.status, ["open", "partial"]))),
    auditInsert(auditCtx(c), {
      action: "process.receive",
      subjectType: "process_step",
      subjectId: step.id,
      meta: { number: step.number, mode: input.mode, returnId, inputG, outputG, rejectG, scrapG: input.scrapG, lossG: figures.lossG, bundles: closingIds.length, outputs: newBundleIds.length },
    }),
  );
  try {
    await atomicBatch(c.db, statements);
  } catch (e) {
    if (isBatchAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${step.number} changed meanwhile. Reload and try again.` });
    throw e;
  }
  return { returnId, lossG: figures.lossG, lossBp: figures.lossBp, yieldBp: figures.yieldBp, ...money(c, { amountPaise: cost.amountPaise as number | null, costPerKgPaise: cost.costPerKgPaise }, ["amountPaise", "costPerKgPaise"]), newBundleIds };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const stepsRouter = router({
  /** Row 33: a job-work challan. Bundles move to the vendor's place and go on hold. */
  send: actionProcedure("jobwork.send")
    .input(
      z.object({
        ...openCommon,
        vendorId: id,
        process: z.enum(finishProcesses),
        expectedReturn: ymd.nullable().optional(),
        valuePaisePerKg: paise.nullable().optional(),
        hsn: optText(10),
        vehicleNo: optText(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as Ctx;
      await assertModule(c, "jobwork");
      const v = await readVendor(c, input.vendorId);
      if (!v.active) throw jobworkRefusal("vendor_inactive", { code: v.code });
      const bundleIds = await pickBundles(c, input);
      return openStep(c, {
        kind: "jobwork",
        process: input.process,
        bundleIds,
        vendor: { id: v.id, locationId: v.locationId },
        fields: {
          finishCode: input.finishCode || null,
          expectedReturn: input.expectedReturn ?? null,
          valuePaisePerKg: input.valuePaisePerKg ?? null,
          hsn: input.hsn || "7604",
          vehicleNo: input.vehicleNo || null,
          ratePaisePerKg: input.ratePaisePerKg ?? v.ratePaisePerKg ?? null,
          note: input.note || null,
        },
      });
    }),

  /** Rows 54, 55 (in-house), 56: a step on the finishing line, the draw bench or fabrication. */
  start: actionProcedure("process.run")
    .input(
      z.object({
        ...openCommon,
        kind: z.enum(["finish", "draw", "fabricate"]),
        process: z.string().trim().min(1).max(20),
        ops: z.array(z.enum(fabricationOps)).max(fabricationOps.length).default([]),
        batchNo: optText(40),
        chemicals: z.array(z.object({ name: text(60).min(1), qty: text(30) })).max(20).default([]),
        passes: z.number().int().min(0).max(100).nullable().optional(),
        outSize: optText(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as Ctx;
      await assertModule(c, PROCESS_KIND_MODULE[input.kind]);
      assertProcessFits(input.kind, input.process);
      const bundleIds = await pickBundles(c, input);
      return openStep(c, {
        kind: input.kind,
        process: input.process,
        bundleIds,
        vendor: null,
        fields: {
          finishCode: input.finishCode || null,
          ops: input.kind === "fabricate" ? input.ops : [],
          batchNo: input.batchNo || null,
          chemicals: input.chemicals,
          passes: input.passes ?? null,
          outSize: input.outSize || null,
          ratePaisePerKg: input.ratePaisePerKg ?? null,
          note: input.note || null,
        },
      });
    }),

  receive: anyActionProcedure("jobwork.receive", "process.run")
    .input(receiveInput)
    .mutation(async ({ ctx, input }) => receiveStep(ctx as Ctx, input)),

  /** Before anything came back: the bundles go back where they came from, holds released. */
  cancel: anyActionProcedure("jobwork.send", "process.run")
    .input(z.object({ id, reason: text(300).min(1, "Write why") }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as Ctx;
      const step = await readStep(c, input.id);
      await assertModule(c, PROCESS_KIND_MODULE[step.kind]);
      const out = isOutKind(step.kind);
      if (!can_(c, out ? "jobwork.send" : "process.run")) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      if (step.status === "cancelled" || step.status === "done") throw jobworkRefusal("step_closed", { step: step.number });
      if (step.status === "partial") throw jobworkRefusal("cancel_after_return", { step: step.number });
      const inputs = await c.db.select().from(processInput).where(and(eq(processInput.companyId, c.companyId), eq(processInput.stepId, step.id)));
      const ids = inputs.map((i) => i.bundleId);
      const now = clockNow();
      const userId = c.session.user.id;
      const seq = await nextCompanySeq({ db: c.db }, c.companyId);
      const posting: PostingCtx = { db: c.db, companyId: c.companyId, userId, seq, postedAt: now };
      const statements: SqliteBatchItem[] = [];
      if (out) {
        const vendor = await readVendor(c, step.vendorId!);
        const byFrom = new Map<string, string[]>();
        for (const i of inputs) byFrom.set(i.fromLocationId ?? "", [...(byFrom.get(i.fromLocationId ?? "") ?? []), i.bundleId]);
        for (const [from, bids] of byFrom) {
          if (!from) throw jobworkRefusal("no_yard");
          statements.push(...moveRows(posting, { voucherId: crypto.randomUUID(), bundleIds: bids, toLocationId: from, reason: `${step.number} cancelled`, onlyIf: and(eq(bundle.locationId, vendor.locationId), onStepSql(c.companyId, step.id)) }));
        }
      } else {
        for (const part of chunk(ids, STEP_IN_CHUNK)) {
          statements.push(c.db.update(bundle).set({ serverSeq: seq }).where(and(eq(bundle.companyId, c.companyId), inArray(bundle.id, part), onStepSql(c.companyId, step.id))));
        }
      }
      statements.push(
        ...allLandedAborts(c.db, c.companyId, ids, seq),
        ...releaseHoldStatements(c.db, c.companyId, step.id, ids, userId, now),
        c.db
          .update(processStep)
          .set({ status: "cancelled", cancelledAt: now, cancelReason: input.reason, serverSeq: seq })
          .where(and(eq(processStep.companyId, c.companyId), eq(processStep.id, step.id), eq(processStep.status, "open"))),
        abortBatchUnless(c.db, sql`changes() > 0`),
        auditInsert(auditCtx(c), { action: "process.cancel", subjectType: "process_step", subjectId: step.id, meta: { number: step.number, reason: input.reason, bundles: ids.length } }),
      );
      try {
        await atomicBatch(c.db, statements);
      } catch (e) {
        if (isBatchAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${step.number} changed meanwhile. Reload and try again.` });
        throw e;
      }
      return { ok: true };
    }),

  /** The register (rows 33, 55): every step, newest first, filtered by kind, status and vendor. */
  list: companyProcedure
    .input(
      z
        .object({
          kind: z.enum(["jobwork", "finish", "draw", "fabricate"]).optional(),
          status: z.enum(["open", "partial", "done", "cancelled"]).optional(),
          vendorId: id.optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(processStep.companyId, ctx.companyId),
        input.kind ? eq(processStep.kind, input.kind) : undefined,
        input.status ? eq(processStep.status, input.status) : undefined,
        input.vendorId ? eq(processStep.vendorId, input.vendorId) : undefined,
      );
      const rows = await ctx.db
        .select({
          id: processStep.id,
          number: processStep.number,
          kind: processStep.kind,
          process: processStep.process,
          status: processStep.status,
          vendorId: processStep.vendorId,
          vendorName: processVendor.name,
          finishCode: processStep.finishCode,
          sentAt: processStep.sentAt,
          doneAt: processStep.doneAt,
          expectedReturn: processStep.expectedReturn,
          inputG: processStep.inputG,
          inputPcs: processStep.inputPcs,
          outputG: sql<number>`(select coalesce(sum(r.output_g), 0) from process_return r where r.company_id = ${ctx.companyId} and r.step_id = ${processStep.id})`,
          lossG: sql<number>`(select coalesce(sum(r.loss_g), 0) from process_return r where r.company_id = ${ctx.companyId} and r.step_id = ${processStep.id})`,
          rejectG: sql<number>`(select coalesce(sum(r.reject_g), 0) from process_return r where r.company_id = ${ctx.companyId} and r.step_id = ${processStep.id})`,
          amountPaise: sql<number>`(select coalesce(sum(r.amount_paise), 0) from process_return r where r.company_id = ${ctx.companyId} and r.step_id = ${processStep.id})`,
          bundles: sql<number>`(select count(*) from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id})`,
          bundlesOut: sql<number>`(select count(*) from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id} and pi.return_id is null)`,
        })
        .from(processStep)
        .leftJoin(processVendor, and(eq(processVendor.id, processStep.vendorId), eq(processVendor.companyId, processStep.companyId)))
        .where(where)
        .orderBy(desc(processStep.sentAt), desc(processStep.number))
        .limit(input.limit + 1)
        .offset(input.offset);
      const items = rows.slice(0, input.limit).map((r) => {
        const outputG = Number(r.outputG);
        const amount = Number(r.amountPaise);
        return money(ctx as Ctx, {
          ...r,
          outputG,
          lossG: Number(r.lossG),
          rejectG: Number(r.rejectG),
          bundles: Number(r.bundles),
          bundlesOut: Number(r.bundlesOut),
          amountPaise: amount as number | null,
          costPerKgPaise: (outputG > 0 ? Math.round((amount * 1000) / outputG) : null) as number | null,
        }, ["amountPaise", "costPerKgPaise"]);
      });
      return { items, nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
    }),

  /** Row 33: what is out at vendors now, with days out, the age bucket and overdue. */
  pending: companyProcedure.input(z.object({ vendorId: id.optional() }).optional()).query(async ({ ctx, input }) => {
    const settings = await plantSettings(ctx as Ctx);
    const tz = companyTimezone(settings);
    const nowMs = clockNow().getTime();
    const today = ymdOf(tz, nowMs);
    const rows = await ctx.db
      .select({
        id: processStep.id,
        number: processStep.number,
        process: processStep.process,
        finishCode: processStep.finishCode,
        status: processStep.status,
        vendorId: processStep.vendorId,
        vendorName: processVendor.name,
        vendorCode: processVendor.code,
        sentAt: processStep.sentAt,
        expectedReturn: processStep.expectedReturn,
        outBundles: sql<number>`(select count(*) from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id} and pi.return_id is null)`,
        outPcs: sql<number>`(select coalesce(sum(pi.pcs), 0) from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id} and pi.return_id is null)`,
        outG: sql<number>`(select coalesce(sum(pi.weight_g), 0) from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id} and pi.return_id is null)`,
      })
      .from(processStep)
      .leftJoin(processVendor, and(eq(processVendor.id, processStep.vendorId), eq(processVendor.companyId, processStep.companyId)))
      .where(and(eq(processStep.companyId, ctx.companyId), eq(processStep.kind, "jobwork"), inArray(processStep.status, ["open", "partial"]), input?.vendorId ? eq(processStep.vendorId, input.vendorId) : undefined))
      .orderBy(asc(processStep.sentAt))
      .limit(500);
    const buckets: Record<VendorAgeBucket, { steps: number; outG: number }> = { d0_7: { steps: 0, outG: 0 }, d8_15: { steps: 0, outG: 0 }, d16_30: { steps: 0, outG: 0 }, d30_plus: { steps: 0, outG: 0 } };
    const items = rows.map((r) => {
      const days = daysAtVendor(r.sentAt.getTime(), nowMs);
      const bucket = vendorAgeBucket(days);
      const outG = Number(r.outG);
      buckets[bucket].steps += 1;
      buckets[bucket].outG += outG;
      return { ...r, outBundles: Number(r.outBundles), outPcs: Number(r.outPcs), outG, days, bucket, overdue: isOverdue(r.expectedReturn, today), daysToLimit: daysToJobworkLimit(r.sentAt.getTime(), nowMs) };
    });
    return { items, buckets, today };
  }),

  get: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const c = ctx as Ctx;
    const step = await readStep(c, input.id);
    const vendor = step.vendorId ? await readVendor(c, step.vendorId) : null;
    const inputs = await ctx.db
      .select({ bundleId: processInput.bundleId, serial: processInput.serial, dieId: processInput.dieId, sectionCode: die.sectionCode, weightG: processInput.weightG, pcs: processInput.pcs, lengthMm: processInput.lengthMm, returnId: processInput.returnId })
      .from(processInput)
      .innerJoin(die, and(eq(die.id, processInput.dieId), eq(die.companyId, processInput.companyId)))
      .where(and(eq(processInput.companyId, ctx.companyId), eq(processInput.stepId, step.id)))
      .orderBy(asc(processInput.createdAt), asc(processInput.serial));
    const returns = await ctx.db.select().from(processReturn).where(and(eq(processReturn.companyId, ctx.companyId), eq(processReturn.stepId, step.id))).orderBy(asc(processReturn.line));
    const outputs = await ctx.db
      .select({ returnId: processOutput.returnId, bundleId: processOutput.bundleId, serial: bundle.serial, inputBundleId: processOutput.inputBundleId, weightG: processOutput.weightG, pcs: processOutput.pcs, lengthMm: processOutput.lengthMm, rejectPcs: processOutput.rejectPcs, rejectG: processOutput.rejectG })
      .from(processOutput)
      .innerJoin(bundle, and(eq(bundle.id, processOutput.bundleId), eq(bundle.companyId, processOutput.companyId)))
      .where(and(eq(processOutput.companyId, ctx.companyId), eq(processOutput.stepId, step.id)));
    const totalOut = returns.reduce((a, r) => a + r.outputG, 0);
    const totalAmount = returns.reduce((a, r) => a + r.amountPaise, 0);
    const moneyKeys = ["ratePaisePerKg", "valuePaisePerKg"] as const;
    return {
      step: money(c, { ...step }, moneyKeys),
      vendor: vendor ? money(c, { id: vendor.id, code: vendor.code, name: vendor.name, gstin: vendor.gstin, address: vendor.address, state: vendor.state, phone: vendor.phone, ratePaisePerKg: vendor.ratePaisePerKg }, ["ratePaisePerKg"]) : null,
      inputs,
      returns: returns.map((r) => money(c, { ...r, ratePaisePerKg: r.ratePaisePerKg as number | null, amountPaise: r.amountPaise as number | null }, ["ratePaisePerKg", "amountPaise"])),
      outputs,
      totals: money(c, {
        inputG: step.inputG,
        outputG: totalOut,
        lossG: returns.reduce((a, r) => a + r.lossG, 0),
        rejectG: returns.reduce((a, r) => a + r.rejectG, 0),
        scrapG: returns.reduce((a, r) => a + r.scrapG, 0),
        amountPaise: totalAmount as number | null,
        costPerKgPaise: (totalOut > 0 ? Math.round((totalAmount * 1000) / totalOut) : null) as number | null,
      }, ["amountPaise", "costPerKgPaise"]),
      bundlesOut: inputs.filter((i) => !i.returnId).length,
      canSeeCost: seesCost(c),
    };
  }),

  /**
   * Row 33: the A4 delivery challan for job work (GST rule 55(1)(c), section 143), as a snapshot the
   * client prints: consigner and consignee with GSTIN, number and date, HSN, description, pieces, kg,
   * declared value, place of supply. No PDF in the Worker.
   */
  challan: anyActionProcedure("jobwork.send", "jobwork.receive", "jobwork.cost")
    .input(z.object({ id }))
    .query(async ({ ctx, input }) => {
      const c = ctx as Ctx;
      const step = await readStep(c, input.id);
      if (step.kind !== "jobwork" || !step.vendorId) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const vendor = await readVendor(c, step.vendorId);
      const settings = await plantSettings(c);
      const tz = companyTimezone(settings);
      const lines = await ctx.db
        .select({
          sectionCode: die.sectionCode,
          sectionName: die.name,
          lengthMm: processInput.lengthMm,
          bundles: sql<number>`count(*)`,
          pcs: sql<number>`sum(${processInput.pcs})`,
          weightG: sql<number>`sum(${processInput.weightG})`,
        })
        .from(processInput)
        .innerJoin(die, and(eq(die.id, processInput.dieId), eq(die.companyId, processInput.companyId)))
        .where(and(eq(processInput.companyId, ctx.companyId), eq(processInput.stepId, step.id)))
        .groupBy(die.sectionCode, die.name, processInput.lengthMm)
        .orderBy(asc(die.sectionCode), asc(processInput.lengthMm));
      const serials = await ctx.db
        .select({ serial: processInput.serial })
        .from(processInput)
        .where(and(eq(processInput.companyId, ctx.companyId), eq(processInput.stepId, step.id)))
        .orderBy(asc(processInput.serial));
      const plant = letterhead(settings);
      const items = lines.map((l) => {
        const weightG = Number(l.weightG);
        return { ...l, bundles: Number(l.bundles), pcs: Number(l.pcs), weightG, valuePaise: challanValuePaise(step.valuePaisePerKg, weightG) };
      });
      const plantState = plant.gstin ? plant.gstin.slice(0, 2) : null;
      const vendorState = vendor.gstin ? vendor.gstin.slice(0, 2) : null;
      return {
        number: step.number,
        date: ymdOf(tz, step.sentAt.getTime()),
        status: step.status,
        process: step.process,
        finishCode: step.finishCode,
        expectedReturn: step.expectedReturn,
        hsn: step.hsn ?? "7604",
        vehicleNo: step.vehicleNo,
        note: step.note,
        consigner: plant,
        consignee: { name: vendor.name, gstin: vendor.gstin, address: vendor.address, state: vendor.state, phone: vendor.phone },
        /** Inter-State when both GSTINs are known and their state codes differ: the place of supply is printed. */
        interState: Boolean(plantState && vendorState && plantState !== vendorState),
        items,
        serials: serials.map((s) => s.serial),
        totals: {
          bundles: items.reduce((a, i) => a + i.bundles, 0),
          pcs: items.reduce((a, i) => a + i.pcs, 0),
          weightG: items.reduce((a, i) => a + i.weightG, 0),
          valuePaise: items.reduce((a, i) => a + i.valuePaise, 0),
        },
        valuePaisePerKg: step.valuePaisePerKg,
      };
    }),
});

export const processRouter = router({
  vendors: vendorsRouter,
  steps: stepsRouter,

  /** Row 33: per order line, whether its bundles have been through the finish the line asks for. */
  forOrder: companyProcedure.input(z.object({ orderId: id })).query(async ({ ctx, input }) => {
    const lines = await ctx.db
      .select({ lineId: salesOrderLine.id, finish: salesOrderLine.finish })
      .from(salesOrderLine)
      .where(and(eq(salesOrderLine.companyId, ctx.companyId), eq(salesOrderLine.salesOrderId, input.orderId)));
    const needing = lines.filter((l) => finishOfProcess(l.finish));
    if (needing.length === 0) return { lines: [] };
    const bundles = await mapInChunks(
      needing.map((l) => l.lineId),
      (part) =>
        ctx.db
          .select({
            lineId: bundle.salesOrderLineId,
            weightG: bundle.weightG,
            finish: bundle.finish,
            atVendor: sql<number>`exists (select 1 from location vl where vl.id = ${bundle.locationId} and vl.company_id = ${ctx.companyId} and vl.kind = 'vendor')`,
            inProcess: sql<number>`exists (select 1 from process_hold ph where ph.company_id = ${ctx.companyId} and ph.bundle_id = ${bundle.id} and ph.released_at is null)`,
          })
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.salesOrderLineId, part), or(eq(bundle.status, "available"), eq(bundle.status, "reserved"), eq(bundle.status, "dispatched")))),
    );
    const out = needing.map((l) => {
      const tally = { done: { bundles: 0, weightG: 0 }, at_vendor: { bundles: 0, weightG: 0 }, in_process: { bundles: 0, weightG: 0 }, pending: { bundles: 0, weightG: 0 } };
      for (const b of bundles.filter((x) => x.lineId === l.lineId)) {
        const st = bundleFinishState({ lineFinish: l.finish, bundleFinish: b.finish, atVendor: Boolean(b.atVendor), inProcess: Boolean(b.inProcess) });
        if (st === "not_needed") continue;
        tally[st].bundles += 1;
        tally[st].weightG += b.weightG;
      }
      return { lineId: l.lineId, finish: finishOfProcess(l.finish)!, ...tally };
    });
    return { lines: out };
  }),

  /** The bundle page: the step it is on now, its finish and its history through steps. */
  forBundle: companyProcedure.input(z.object({ bundleId: id })).query(async ({ ctx, input }) => {
    const [b] = await ctx.db.select({ id: bundle.id, finish: bundle.finish, finishCode: bundle.finishCode }).from(bundle).where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.id, input.bundleId))).limit(1);
    if (!b) return null;
    const [open] = await ctx.db
      .select({ stepId: processHold.stepId, reason: processHold.reason, heldAt: processHold.heldAt, number: processStep.number, kind: processStep.kind, process: processStep.process, vendorName: processVendor.name })
      .from(processHold)
      .innerJoin(processStep, and(eq(processStep.id, processHold.stepId), eq(processStep.companyId, processHold.companyId)))
      .leftJoin(processVendor, and(eq(processVendor.id, processStep.vendorId), eq(processVendor.companyId, processStep.companyId)))
      .where(and(eq(processHold.companyId, ctx.companyId), eq(processHold.bundleId, b.id), isNull(processHold.releasedAt)))
      .limit(1);
    const history = await ctx.db
      .select({ stepId: processStep.id, number: processStep.number, kind: processStep.kind, process: processStep.process, status: processStep.status, sentAt: processStep.sentAt })
      .from(processStep)
      .where(
        and(
          eq(processStep.companyId, ctx.companyId),
          sql`(exists (select 1 from process_input pi where pi.company_id = ${ctx.companyId} and pi.step_id = ${processStep.id} and pi.bundle_id = ${b.id})
            or exists (select 1 from process_output po where po.company_id = ${ctx.companyId} and po.step_id = ${processStep.id} and po.bundle_id = ${b.id}))`,
        ),
      )
      .orderBy(desc(processStep.sentAt))
      .limit(20);
    return { finish: b.finish, finishCode: b.finishCode, open: open ?? null, history };
  }),
});
