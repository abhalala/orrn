/**
 * Plant connections (XE parity lane DEVICES, module `devices`, opt-in; migration 0067). Rows 48, 40, 94, 95.
 *
 * - Devices: enrol a weighbridge, scanner, tensile tester or collector device on an edge node with its own
 *   token (shown once), rotate it, revoke it. Health of enrolled devices and of the collectors that were
 *   already on main (edge nodes, scale, press frames, spectro files, oven telemetry), with the sim label.
 * - Weighbridge (row 48): a ticket (pushed by the edge or imported from the bridge PC's CSV) is taken as the
 *   FC kanta weight of a scrap lot, or as the truck weight of a dispatch. A typed weight needs a reason and
 *   is compared with the truck's ticket: beyond the plant tolerance it is flagged (the kanta check).
 * - Lab (rows 40, 94): scanner and tensile readings become quality checks (`qa_check`) through the QA
 *   module's own code; readings that name no run wait in the lab inbox beside the spectro files.
 *
 * Gates: `ROUTER_MODULE.devices` covers every mutation; reads call `assertModule("devices")` too (opt-in: a
 * plant without it sees nothing). A write into another module's rows also asserts that module (`purchase`
 * for a lot's weight, `dispatches`, `qa`). Actions: `device.view`, `device.manage`; the gate desk keeps
 * `purchase.receipt`, the dispatch desk `dispatch.complete`, the lab `qa.check`.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { deviceReading, deviceReadingUse, plantDevice, plantDeviceKinds, plantDeviceProtocols } from "@orrn/db/schema/devices";
import { spectroInbox } from "@orrn/db/schema/collector";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { purchaseLot } from "@orrn/db/schema/purchase";
import { qaCheck } from "@orrn/db/schema/qa";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import {
  DEVICE_CSV_MAX_BYTES,
  DEVICE_HEARTBEAT_SEC_MAX,
  DEVICE_HEARTBEAT_SEC_MIN,
  DEVICE_TOLERANCE_BP_MAX,
  DEVICE_TOLERANCE_MIN_G_MAX,
  healthCounts,
  isDeviceCode,
  normaliseSampleCode,
  parseScannerCsv,
  parseUtmCsv,
  parseWeighbridgeCsv,
  readDeviceSettings,
  sameVehicle,
  WEIGH_TICKET_WINDOW_MS,
  weighMismatch,
} from "@orrn/domain";
import { deviceAdapterConfigSchema } from "@orrn/edge-runtime/devices";

import { actionProcedure, anyActionProcedure, router } from "../index";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { settingsPatchSql } from "../lib/companySettings";
import { companyTimezoneOffsetMin } from "../lib/deviceTime";
import { captureLabReading, collectorSources, listDevices, newDeviceToken, readingSummary, type LabSubjectType } from "../lib/devices";
import { assertModule } from "../lib/moduleGate";
import { batchAbortUnlessOn, isBatchAbortOn } from "../lib/orders";
import { lotHasWeightLockingNote } from "../lib/purchase";
import { isQaUnique } from "../lib/qa";
import { nextCompanySeq } from "../lib/sequence";

type Ctx = { db: OrrnDb; companyId: string; session: { user: { id: string } } | null; impersonation?: unknown };

const id = z.string().trim().min(1).max(64);
const reason = z.string().trim().min(3).max(300);
const PAGE = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.number().int().min(0).optional() });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Not found" });
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

function audit(ctx: Ctx) {
  return ctx as unknown as Parameters<typeof auditInsert>[0];
}

async function plantSettings(ctx: Ctx) {
  const row = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).get();
  return readDeviceSettings((row?.settings as Record<string, unknown> | null) ?? {});
}

async function ownDevice(ctx: Ctx, deviceId: string) {
  const d = await ctx.db.select().from(plantDevice).where(and(eq(plantDevice.companyId, ctx.companyId), eq(plantDevice.id, deviceId))).get();
  if (!d) throw notFound();
  return d;
}

async function ownNode(ctx: Ctx, nodeId: string | null | undefined) {
  if (!nodeId) return null;
  const n = await ctx.db.select({ id: spoolDeployment.id, status: spoolDeployment.status }).from(spoolDeployment).where(and(eq(spoolDeployment.companyId, ctx.companyId), eq(spoolDeployment.id, nodeId))).get();
  if (!n) throw notFound();
  if (n.status === "revoked") throw bad("That edge box is revoked");
  return n;
}

/** The adapter map must match the protocol (Modbus TCP / OPC UA / file / serial / sim). */
function checkConfig(protocol: (typeof plantDeviceProtocols)[number], config: unknown): Record<string, unknown> | null {
  if (config == null) return null;
  const parsed = deviceAdapterConfigSchema.safeParse({ ...(config as object), protocol });
  if (!parsed.success) throw bad(`The device map is not valid: ${parsed.error.issues[0]?.message ?? "check it"}`);
  return parsed.data as Record<string, unknown>;
}

const deviceInput = z.object({
  code: z.string().trim().toUpperCase().max(24),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(plantDeviceKinds),
  protocol: z.enum(plantDeviceProtocols),
  deploymentId: id.nullable().optional(),
  simulated: z.boolean().default(false),
  heartbeatSec: z.number().int().min(DEVICE_HEARTBEAT_SEC_MIN).max(DEVICE_HEARTBEAT_SEC_MAX).optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Devices and health (row 95)
// ---------------------------------------------------------------------------

const deviceAdmin = {
  /** Enrolled devices with health, plus the collectors already on main. Tokens never leave the server. */
  list: actionProcedure("device.view").query(async ({ ctx }) => {
    await assertModule(ctx, "devices");
    const s = await plantSettings(ctx);
    const [devices, sources] = await Promise.all([listDevices(ctx.db, ctx.companyId), collectorSources(ctx.db, ctx.companyId, s.heartbeatSec)]);
    return { devices, sources, counts: healthCounts([...devices, ...sources.filter((x) => x.kind !== "edge_node")].map((d) => ({ health: d.health, simulated: d.simulated }))) };
  }),

  /** The device health tile (Today): counts only. */
  health: actionProcedure("device.view").query(async ({ ctx }) => {
    await assertModule(ctx, "devices");
    const s = await plantSettings(ctx);
    const [devices, sources] = await Promise.all([listDevices(ctx.db, ctx.companyId), collectorSources(ctx.db, ctx.companyId, s.heartbeatSec)]);
    return healthCounts([...devices, ...sources.filter((x) => x.kind !== "edge_node")].map((d) => ({ health: d.health, simulated: d.simulated })));
  }),

  /** Edge boxes a device can hang off (enrol picker). */
  nodes: actionProcedure("device.manage").query(async ({ ctx }) => {
    await assertModule(ctx, "devices");
    return ctx.db
      .select({ id: spoolDeployment.id, name: spoolDeployment.nodeName, site: spoolDeployment.siteLabel, status: spoolDeployment.status })
      .from(spoolDeployment)
      .where(and(eq(spoolDeployment.companyId, ctx.companyId), ne(spoolDeployment.status, "revoked")))
      .limit(50);
  }),

  /** Enrol a device. The token comes back once; only its SHA-256 and last 4 characters are kept. */
  enrol: actionProcedure("device.manage")
    .input(deviceInput)
    .mutation(async ({ ctx, input }) => {
      if (!isDeviceCode(input.code)) throw bad("A device code is 2 to 24 letters, digits or dashes (WB-1)");
      await ownNode(ctx, input.deploymentId);
      const config = checkConfig(input.protocol, input.config);
      const simulated = input.simulated || input.protocol === "sim";
      const tok = await newDeviceToken();
      const deviceId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(plantDevice).values({
            id: deviceId,
            companyId: ctx.companyId,
            deploymentId: input.deploymentId ?? null,
            code: input.code,
            label: input.label,
            kind: input.kind,
            protocol: input.protocol,
            simulated,
            configJson: config,
            heartbeatSec: input.heartbeatSec ?? 60,
            tokenHash: tok.hash,
            tokenHint: tok.hint,
            tokenVersion: 1,
            enrolledBy: ctx.session.user.id,
          }),
          auditInsert(audit(ctx), { action: "plant_device.enrol", subjectType: "plant_device", subjectId: deviceId, meta: { code: input.code, kind: input.kind, protocol: input.protocol, simulated, nodeId: input.deploymentId ?? null } }),
        ]);
      } catch (e) {
        if (isQaUnique(e, "plant_device")) throw new TRPCError({ code: "CONFLICT", message: `Device ${input.code} is already enrolled` });
        throw e;
      }
      return { id: deviceId, token: tok.token, tokenHint: tok.hint, tokenVersion: 1 };
    }),

  /** A new token; the old one stops working at once. Readings already held keep their keys. */
  rotateToken: actionProcedure("device.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const d = await ownDevice(ctx, input.id);
      if (d.revokedAt) throw bad("This device is revoked");
      const tok = await newDeviceToken();
      const version = d.tokenVersion + 1;
      await atomicBatch(ctx.db, [
        ctx.db
          .update(plantDevice)
          .set({ tokenHash: tok.hash, tokenHint: tok.hint, tokenVersion: version })
          .where(and(eq(plantDevice.id, d.id), eq(plantDevice.companyId, ctx.companyId), eq(plantDevice.tokenVersion, d.tokenVersion), isNull(plantDevice.revokedAt))),
        auditInsertGuarded(
          audit(ctx),
          { action: "plant_device.token", subjectType: "plant_device", subjectId: d.id, meta: { code: d.code, tokenVersion: version } },
          { from: plantDevice, where: and(eq(plantDevice.id, d.id), eq(plantDevice.tokenVersion, version)) },
        ),
      ]);
      const now = await ownDevice(ctx, d.id);
      // Compare the hash, not the version: two rotations racing both compute the same version.
      if (now.tokenHash !== tok.hash) throw new TRPCError({ code: "CONFLICT", message: "The device changed while saving; open it again" });
      return { id: d.id, token: tok.token, tokenHint: tok.hint, tokenVersion: version };
    }),

  /** Revoke: the device's token stops working; the row and its readings stay. */
  revoke: actionProcedure("device.manage")
    .input(z.object({ id, reason }))
    .mutation(async ({ ctx, input }) => {
      const d = await ownDevice(ctx, input.id);
      if (d.revokedAt) throw new TRPCError({ code: "CONFLICT", message: `Device ${d.code} is already revoked` });
      const at = new Date();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(plantDevice)
          .set({ revokedAt: at, revokedBy: ctx.session.user.id, revokeReason: input.reason, tokenHash: null })
          .where(and(eq(plantDevice.id, d.id), eq(plantDevice.companyId, ctx.companyId), isNull(plantDevice.revokedAt))),
        auditInsertGuarded(
          audit(ctx),
          { action: "plant_device.revoke", subjectType: "plant_device", subjectId: d.id, meta: { code: d.code, reason: input.reason } },
          { from: plantDevice, where: and(eq(plantDevice.id, d.id), eq(plantDevice.revokedBy, ctx.session.user.id), eq(plantDevice.revokedAt, at)) },
        ),
      ]);
      return { success: true };
    }),

  /** Label, edge box, heartbeat and the adapter map. Kind and protocol are fixed (enrol a new device). */
  update: actionProcedure("device.manage")
    .input(z.object({ id, label: z.string().trim().min(1).max(60).optional(), deploymentId: id.nullable().optional(), heartbeatSec: deviceInput.shape.heartbeatSec, config: deviceInput.shape.config }))
    .mutation(async ({ ctx, input }) => {
      const d = await ownDevice(ctx, input.id);
      if (d.revokedAt) throw bad("This device is revoked");
      if (input.deploymentId !== undefined) await ownNode(ctx, input.deploymentId);
      const patch: Partial<typeof plantDevice.$inferInsert> = {};
      if (input.label !== undefined) patch.label = input.label;
      if (input.deploymentId !== undefined) patch.deploymentId = input.deploymentId;
      if (input.heartbeatSec !== undefined) patch.heartbeatSec = input.heartbeatSec;
      if (input.config !== undefined) patch.configJson = checkConfig(d.protocol, input.config);
      if (Object.keys(patch).length === 0) return { success: true };
      await atomicBatch(ctx.db, [
        ctx.db.update(plantDevice).set(patch).where(and(eq(plantDevice.id, d.id), eq(plantDevice.companyId, ctx.companyId), isNull(plantDevice.revokedAt))),
        auditInsert(audit(ctx), { action: "plant_device.update", subjectType: "plant_device", subjectId: d.id, meta: { code: d.code, fields: Object.keys(patch) } }),
      ]);
      return { success: true };
    }),
};

// ---------------------------------------------------------------------------
// Readings, settings and CSV imports
// ---------------------------------------------------------------------------

const readings = router({
  list: actionProcedure("device.view")
    .input(PAGE.extend({ kind: z.enum(["weighbridge", "dimension", "mechanical"]).optional(), deviceId: id.optional() }).optional())
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const limit = input?.limit ?? 50;
      const offset = input?.cursor ?? 0;
      const rows = await ctx.db
        .select()
        .from(deviceReading)
        .where(and(eq(deviceReading.companyId, ctx.companyId), input?.kind ? eq(deviceReading.kind, input.kind) : undefined, input?.deviceId ? eq(deviceReading.deviceId, input.deviceId) : undefined))
        .orderBy(desc(deviceReading.sampledAt), desc(deviceReading.receivedAt))
        .limit(limit + 1)
        .offset(offset);
      return { items: rows.slice(0, limit).map(readingSummary), nextCursor: rows.length > limit ? offset + limit : null };
    }),
});

const settings = router({
  get: actionProcedure("device.view").query(async ({ ctx }) => {
    await assertModule(ctx, "devices");
    return plantSettings(ctx);
  }),
  update: actionProcedure("device.manage")
    .input(
      z.object({
        weighToleranceBp: z.number().int().min(0).max(DEVICE_TOLERANCE_BP_MAX).optional(),
        weighToleranceMinG: z.number().int().min(0).max(DEVICE_TOLERANCE_MIN_G_MAX).optional(),
        heartbeatSec: z.number().int().min(DEVICE_HEARTBEAT_SEC_MIN).max(DEVICE_HEARTBEAT_SEC_MAX).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [`devices.${k}`, v]));
      if (Object.keys(patch).length === 0) return plantSettings(ctx);
      await atomicBatch(ctx.db, [
        ctx.db.update(company).set({ settings: settingsPatchSql(patch) as never }).where(eq(company.id, ctx.companyId)),
        auditInsert(audit(ctx), { action: "plant_device.settings", subjectType: "company", subjectId: ctx.companyId, meta: input }),
      ]);
      return plantSettings(ctx);
    }),
});

const csvText = z.string().min(1).max(DEVICE_CSV_MAX_BYTES);

async function importDevice(ctx: Ctx, deviceId: string | undefined, kinds: readonly string[]) {
  if (!deviceId) return null;
  const d = await ownDevice(ctx, deviceId);
  if (!kinds.includes(d.kind)) throw bad(`Device ${d.code} does not send these readings`);
  if (d.revokedAt) throw bad(`Device ${d.code} is revoked`);
  return d;
}

const imports = router({
  /**
   * A weighbridge PC's ticket export, for one enrolled weighbridge. The file's unit is picked by the person (kg
   * or tonnes), never guessed. `device.manage` only: the gate desk that types lot weights must not also be able
   * to make the tickets they are checked against. A ticket already held for that bridge (pushed or imported) is
   * skipped, so importing a file twice adds nothing.
   */
  weighbridge: actionProcedure("device.manage")
    .input(z.object({ csv: csvText, unit: z.enum(["kg", "t"]), deviceId: id }))
    .mutation(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const d = await importDevice(ctx, input.deviceId, ["weighbridge"]);
      const parsed = parseWeighbridgeCsv(input.csv, input.unit, await companyTimezoneOffsetMin(ctx.db, ctx.companyId));
      const values = parsed.rows.map((r) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        deviceId: d?.id ?? null,
        kind: "weighbridge" as const,
        source: "file" as const,
        dedupeKey: `file:weighbridge:${d!.id}:${r.ticketNo}`,
        simulated: false,
        sampledAt: new Date(r.atMs),
        ticketNo: r.ticketNo,
        vehicleNo: r.vehicleNo,
        grossG: r.grossG,
        tareG: r.tareG,
        netG: r.netG,
        valuesJson: {},
        importedBy: ctx.session.user.id,
      }));
      const added = await insertReadings(ctx, values);
      if (added > 0) await atomicBatch(ctx.db, [auditInsert(audit(ctx), { action: "plant_device.import", subjectType: "device_reading", meta: { kind: "weighbridge", unit: input.unit, added, deviceId: d?.id ?? null } })]);
      return { added, duplicate: values.length - added, errors: parsed.errors };
    }),

  /** A scanner's dimension export or a tensile tester's export. Rows that name a run become quality checks. */
  lab: anyActionProcedure("device.manage", "qa.check")
    .input(z.object({ csv: csvText, kind: z.enum(["dimension", "mechanical"]), deviceId: id.optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const d = await importDevice(ctx, input.deviceId, input.kind === "dimension" ? ["profile_scanner"] : ["utm"]);
      const offset = await companyTimezoneOffsetMin(ctx.db, ctx.companyId);
      const base = { companyId: ctx.companyId, deviceId: d?.id ?? null, source: "file" as const, simulated: false, importedBy: ctx.session.user.id };
      let errors;
      let values;
      if (input.kind === "dimension") {
        const p = parseScannerCsv(input.csv, offset);
        errors = p.errors;
        values = p.samples.map((s) => ({ ...base, id: crypto.randomUUID(), kind: "dimension" as const, dedupeKey: `file:dimension:${d?.id ?? "-"}:${s.sampleCode}:${s.atMs}`, sampledAt: new Date(s.atMs), sampleCode: s.sampleCode, valuesJson: { points: s.points } }));
      } else {
        const p = parseUtmCsv(input.csv, offset);
        errors = p.errors;
        values = p.rows.map((r) => ({
          ...base,
          id: crypto.randomUUID(),
          kind: "mechanical" as const,
          dedupeKey: `file:mechanical:${d?.id ?? "-"}:${r.sampleCode}:${r.atMs}`,
          sampledAt: new Date(r.atMs),
          sampleCode: r.sampleCode,
          valuesJson: { tensileMpa: r.tensileMpa, yieldMpa: r.yieldMpa, elongationX10: r.elongationX10 },
        }));
      }
      const added = await insertReadings(ctx, values);
      let captured = 0;
      const qaOn = await moduleOn(ctx, "qa");
      if (added > 0) {
        await atomicBatch(ctx.db, [auditInsert(audit(ctx), { action: "plant_device.import", subjectType: "device_reading", meta: { kind: input.kind, added, deviceId: d?.id ?? null } })]);
        if (qaOn) {
          const landed = await landedIds(ctx, values.map((v) => v.id));
          const { CAPTURE_PER_CALL } = await import("../lib/devices");
          for (const v of values.filter((x) => landed.has(x.id)).slice(0, CAPTURE_PER_CALL)) {
            const out = await captureLabReading(ctx.db, { companyId: ctx.companyId, readingId: v.id, actorId: ctx.session.user.id, auditCtx: audit(ctx) });
            if ("checkId" in out) captured += 1;
          }
        }
      }
      return { added, duplicate: values.length - added, captured, waiting: added - captured, errors };
    }),
});

async function moduleOn(ctx: Ctx, m: "qa" | "purchase" | "dispatches"): Promise<boolean> {
  try {
    await assertModule(ctx, m);
    return true;
  } catch {
    return false;
  }
}

async function landedIds(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await ctx.db.select({ id: deviceReading.id }).from(deviceReading).where(and(eq(deviceReading.companyId, ctx.companyId), inArray(deviceReading.id, ids.slice(i, i + 90))));
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** Insert readings, skipping ones already held (dedupe key). One statement per row (about 20 params each). */
async function insertReadings(ctx: Ctx, values: (typeof deviceReading.$inferInsert)[]): Promise<number> {
  if (values.length === 0) return 0;
  for (let i = 0; i < values.length; i += 50) {
    await atomicBatch(
      ctx.db,
      values.slice(i, i + 50).map((v) => ctx.db.insert(deviceReading).values(v).onConflictDoNothing()),
    );
  }
  return (await landedIds(ctx, values.map((v) => v.id))).size;
}

// ---------------------------------------------------------------------------
// Weighbridge on the scrap gate and the dispatch (row 48)
// ---------------------------------------------------------------------------

type WeighSubject = "purchase_lot" | "dispatch";

async function lotOf(ctx: Ctx, lotId: string) {
  const l = await ctx.db
    .select({ id: purchaseLot.id, number: purchaseLot.number, status: purchaseLot.status, vehicleNo: purchaseLot.vehicleNo, fcKgG: purchaseLot.fcKgG, createdAt: purchaseLot.createdAt })
    .from(purchaseLot)
    .where(and(eq(purchaseLot.companyId, ctx.companyId), eq(purchaseLot.id, lotId)))
    .get();
  if (!l) throw notFound();
  return l;
}

async function dispatchOf(ctx: Ctx, dispatchId: string) {
  const d = await ctx.db
    .select({ id: dispatch.id, code: dispatch.code, status: dispatch.status, vehicleNo: dispatch.vehicleNo, createdAt: dispatch.createdAt })
    .from(dispatch)
    .where(and(eq(dispatch.companyId, ctx.companyId), eq(dispatch.id, dispatchId)))
    .get();
  if (!d) throw notFound();
  return d;
}

async function loadG(ctx: Ctx, dispatchId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ g: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
    .from(dispatchItem)
    .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)))
    .where(and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, dispatchId)));
  return Number(row?.g ?? 0);
}

async function subjectOf(ctx: Ctx, type: WeighSubject, subjectId: string) {
  if (type === "purchase_lot") {
    const l = await lotOf(ctx, subjectId);
    return { number: l.number, vehicleNo: l.vehicleNo, createdAt: l.createdAt, weightG: l.fcKgG, lot: l, dispatch: null };
  }
  const d = await dispatchOf(ctx, subjectId);
  return { number: d.code, vehicleNo: d.vehicleNo, createdAt: d.createdAt, weightG: await loadG(ctx, d.id), lot: null, dispatch: d };
}

/** Unused bridge tickets around a time, newest first: the truck's own (matched in SQL) and the rest. */
async function candidateTickets(ctx: Ctx, aroundMs: number, vehicleNo: string | null, limit = 20) {
  const truck = (vehicleNo ?? "").replace(/[\s-]+/g, "").toUpperCase();
  const base = and(
    eq(deviceReading.companyId, ctx.companyId),
    eq(deviceReading.kind, "weighbridge"),
    gte(deviceReading.sampledAt, new Date(aroundMs - WEIGH_TICKET_WINDOW_MS)),
    lte(deviceReading.sampledAt, new Date(aroundMs + WEIGH_TICKET_WINDOW_MS)),
    sql`not exists (select 1 from ${deviceReadingUse} u where u.company_id = ${deviceReading.companyId} and u.reading_id = ${deviceReading.id} and u.voided_at is null)`,
  );
  const mine = truck ? await ctx.db.select().from(deviceReading).where(and(base, eq(deviceReading.vehicleNo, truck))).orderBy(desc(deviceReading.sampledAt)).limit(limit) : [];
  const rest = await ctx.db
    .select()
    .from(deviceReading)
    .where(and(base, truck ? sql`coalesce(${deviceReading.vehicleNo}, '') <> ${truck}` : undefined))
    .orderBy(desc(deviceReading.sampledAt))
    .limit(limit);
  return { sameTruck: mine.map(readingSummary), others: rest.map(readingSummary) };
}

async function liveWeigh(ctx: Ctx, type: WeighSubject, subjectId: string) {
  return ctx.db
    .select()
    .from(deviceReadingUse)
    .where(and(eq(deviceReadingUse.companyId, ctx.companyId), eq(deviceReadingUse.subjectType, type), eq(deviceReadingUse.subjectId, subjectId), isNull(deviceReadingUse.voidedAt)))
    .get();
}

/** Void the live weigh of a subject (a wrong pick); its ticket is free again. */
function voidLiveWeigh(ctx: Ctx, type: WeighSubject, subjectId: string, at: Date): SqliteBatchItem {
  return ctx.db
    .update(deviceReadingUse)
    .set({ voidedAt: at, voidedBy: ctx.session!.user.id })
    .where(and(eq(deviceReadingUse.companyId, ctx.companyId), eq(deviceReadingUse.subjectType, type), eq(deviceReadingUse.subjectId, subjectId), isNull(deviceReadingUse.voidedAt)));
}

/**
 * The lot's FC kanta weight, written as `purchase.update` writes it: only while the lot is booked or
 * unloading and no D/C note on the weight is open, with a new server seq and the purchase audit row. The
 * use row cannot land without it (`batchAbortUnlessOn`).
 */
async function lotWeightStatements(ctx: Ctx, lot: Awaited<ReturnType<typeof lotOf>>, fcKgG: number, how: Record<string, unknown>): Promise<{ items: SqliteBatchItem[]; seq: number }> {
  if (lot.status === "cancelled") throw bad("This lot is cancelled");
  if (lot.status === "ok") throw bad("This lot is OK and in stock; its item, grade and weights are locked (cancel and re-enter it)");
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const where = and(eq(purchaseLot.id, lot.id), eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.status, ["booking", "unload"]), sql`not ${lotHasWeightLockingNote()}`);
  return {
    seq,
    items: [
      ctx.db.update(purchaseLot).set({ fcKgG, serverSeq: seq }).where(where),
      auditInsertGuarded(
        audit(ctx),
        { action: "purchase_lot.update", subjectType: "purchase_lot", subjectId: lot.id, meta: { number: lot.number, before: { fcKgG: lot.fcKgG }, patch: { fcKgG }, ...how } },
        { from: purchaseLot, where: and(eq(purchaseLot.id, lot.id), eq(purchaseLot.serverSeq, seq)) },
      ),
      batchAbortUnlessOn(ctx.db, deviceReadingUse, sql`exists (select 1 from ${purchaseLot} where ${purchaseLot.id} = ${lot.id} and ${purchaseLot.serverSeq} = ${seq})`),
    ],
  };
}

async function runWeighBatch(ctx: Ctx, items: SqliteBatchItem[]) {
  try {
    await atomicBatch(ctx.db, items);
  } catch (e) {
    if (isBatchAbortOn(e, "device_reading_use")) throw bad("The lot changed while saving (OK, cancelled, or a D/C note on its weight); open it again");
    if (isQaUnique(e, "device_reading_use")) throw new TRPCError({ code: "CONFLICT", message: "That ticket is already used on another lot or load" });
    throw e;
  }
}

async function ticketOf(ctx: Ctx, readingId: string) {
  const r = await ctx.db.select().from(deviceReading).where(and(eq(deviceReading.companyId, ctx.companyId), eq(deviceReading.id, readingId))).get();
  if (!r || r.kind !== "weighbridge") throw notFound();
  if (r.simulated) throw bad("A simulated ticket is not a weight");
  return r;
}

/** A load is weighed while it is built or reserved; a completed or cancelled load keeps its weigh. */
function assertLoadOpen(d: { status: string } | null) {
  if (!d) return;
  if (d.status === "cancelled") throw bad("This load is cancelled");
  if (d.status === "completed") throw bad("This load has left; its truck weight is kept as it was");
}

const subjectInput = z.object({ subjectType: z.enum(["purchase_lot", "dispatch"]), subjectId: id });

async function assertWeighAccess(ctx: Ctx & { role: string }, type: WeighSubject) {
  const { can } = await import("../lib/permissions");
  const me = { company: { role: ctx.role as never }, isPlatformAdmin: false, platformRole: null };
  if (type === "purchase_lot" ? !can(me, "purchase.receipt") : !can(me, "dispatch.complete")) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
  await assertModule(ctx, type === "purchase_lot" ? "purchase" : "dispatches");
}

/** Reading a weigh: the subject's own desk (or device.view), and the subject's module. */
async function assertWeighRead(ctx: Ctx & { role: string }, type: WeighSubject) {
  const { can } = await import("../lib/permissions");
  const me = { company: { role: ctx.role as never }, isPlatformAdmin: false, platformRole: null };
  const desk = type === "purchase_lot" ? "purchase.receipt" : "dispatch.complete";
  if (!can(me, desk) && !can(me, "device.view")) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
  await assertModule(ctx, type === "purchase_lot" ? "purchase" : "dispatches");
}

const weigh = router({
  /** What the bridge says about a lot or a load: its live weigh, the kanta check now, and tickets to pick. */
  forSubject: anyActionProcedure("purchase.receipt", "dispatch.complete", "device.view")
    .input(subjectInput)
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      await assertWeighRead(ctx, input.subjectType);
      const s = await plantSettings(ctx);
      const subject = await subjectOf(ctx, input.subjectType, input.subjectId);
      const use = await liveWeigh(ctx, input.subjectType, input.subjectId);
      const ticket = use?.readingId ? await ctx.db.select().from(deviceReading).where(and(eq(deviceReading.companyId, ctx.companyId), eq(deviceReading.id, use.readingId))).get() : undefined;
      // Lot: the weight on the lot now against the bridge (a later edit of FC kg is caught here too).
      // Load: the truck's net against the bundles on it.
      const bridgeG = ticket?.netG ?? null;
      const truckG = use ? (use.typedG ?? bridgeG) : null;
      const kanta = input.subjectType === "purchase_lot" ? (bridgeG != null && subject.weightG != null ? weighMismatch(subject.weightG, bridgeG, s) : null) : use?.typedG != null && bridgeG != null ? weighMismatch(use.typedG, bridgeG, s) : null;
      const load = input.subjectType === "dispatch" && truckG != null ? weighMismatch(subject.weightG ?? 0, truckG, s) : null;
      const tickets = use ? { sameTruck: [], others: [] } : await candidateTickets(ctx, subject.createdAt.getTime(), subject.vehicleNo);
      return {
        subject: { type: input.subjectType, id: input.subjectId, number: subject.number, vehicleNo: subject.vehicleNo, weightG: subject.weightG },
        use: use ? { id: use.id, typedG: use.typedG, bridgeG: use.bridgeG, reason: use.reason, flagged: use.flagged, createdAt: use.createdAt } : null,
        ticket: ticket ? readingSummary(ticket) : null,
        kanta,
        load,
        tickets,
        tolerance: { bp: s.weighToleranceBp, minG: s.weighToleranceMinG },
      };
    }),

  /** Take a bridge ticket as the lot's FC kanta weight, or as the load's truck weight. */
  useTicket: anyActionProcedure("purchase.receipt", "dispatch.complete")
    .input(subjectInput.extend({ readingId: id }))
    .mutation(async ({ ctx, input }) => {
      await assertWeighAccess(ctx, input.subjectType);
      const subject = await subjectOf(ctx, input.subjectType, input.subjectId);
      const t = await ticketOf(ctx, input.readingId);
      if (subject.vehicleNo && t.vehicleNo && !sameVehicle(subject.vehicleNo, t.vehicleNo)) throw bad(`Ticket ${t.ticketNo} is for truck ${t.vehicleNo}, not ${subject.vehicleNo}`);
      assertLoadOpen(subject.dispatch);
      if (Math.abs(t.sampledAt.getTime() - subject.createdAt.getTime()) > WEIGH_TICKET_WINDOW_MS) throw bad(`Ticket ${t.ticketNo} is not from the day of ${subject.number}`);
      if (subject.vehicleNo && !t.vehicleNo) throw bad(`Ticket ${t.ticketNo} names no truck`);
      const s = await plantSettings(ctx);
      const at = new Date();
      const useId = crypto.randomUUID();
      const load = subject.dispatch ? weighMismatch(subject.weightG ?? 0, t.netG!, s) : null;
      const items: SqliteBatchItem[] = [
        voidLiveWeigh(ctx, input.subjectType, input.subjectId, at),
        ctx.db.insert(deviceReadingUse).values({ id: useId, companyId: ctx.companyId, readingId: t.id, subjectType: input.subjectType, subjectId: input.subjectId, bridgeG: t.netG, typedG: null, diffG: load?.diffG ?? 0, allowedG: load?.allowedG ?? null, flagged: false, createdBy: ctx.session.user.id, createdAt: at }),
        auditInsert(audit(ctx), { action: "plant_device.weigh", subjectType: input.subjectType, subjectId: input.subjectId, meta: { number: subject.number, readingId: t.id, ticketNo: t.ticketNo, netG: t.netG } }),
      ];
      if (subject.lot) items.push(...(await lotWeightStatements(ctx, subject.lot, t.netG!, { weighbridgeTicket: t.ticketNo })).items);
      await runWeighBatch(ctx, items);
      return { useId, netG: t.netG, load };
    }),

  /**
   * The typed fallback (bridge down, ticket missing): a weight and a reason. When the truck has an unused
   * real ticket in the window it is tied to this weigh and compared; beyond the tolerance the weigh is flagged.
   */
  typeWeight: anyActionProcedure("purchase.receipt", "dispatch.complete")
    .input(subjectInput.extend({ typedG: z.number().int().min(1).max(200_000_000), reason }))
    .mutation(async ({ ctx, input }) => {
      await assertWeighAccess(ctx, input.subjectType);
      const subject = await subjectOf(ctx, input.subjectType, input.subjectId);
      assertLoadOpen(subject.dispatch);
      const s = await plantSettings(ctx);
      const cand = subject.vehicleNo ? (await candidateTickets(ctx, subject.createdAt.getTime(), subject.vehicleNo)).sameTruck.find((r) => !r.simulated) : undefined;
      const check = cand?.netG != null ? weighMismatch(input.typedG, cand.netG, s) : null;
      const at = new Date();
      const useId = crypto.randomUUID();
      const items: SqliteBatchItem[] = [
        voidLiveWeigh(ctx, input.subjectType, input.subjectId, at),
        ctx.db.insert(deviceReadingUse).values({
          id: useId,
          companyId: ctx.companyId,
          readingId: cand?.id ?? null,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          bridgeG: cand?.netG ?? null,
          typedG: input.typedG,
          diffG: check?.diffG ?? null,
          allowedG: check?.allowedG ?? null,
          flagged: check?.flagged ?? false,
          reason: input.reason,
          createdBy: ctx.session.user.id,
          createdAt: at,
        }),
        auditInsert(audit(ctx), {
          action: check?.flagged ? "plant_device.weigh_flagged" : "plant_device.weigh_typed",
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          meta: { number: subject.number, typedG: input.typedG, reason: input.reason, ticketNo: cand?.ticketNo ?? null, bridgeG: cand?.netG ?? null, diffG: check?.diffG ?? null },
        }),
      ];
      if (subject.lot) items.push(...(await lotWeightStatements(ctx, subject.lot, input.typedG, { typedReason: input.reason })).items);
      await runWeighBatch(ctx, items);
      return { useId, check, ticketNo: cand?.ticketNo ?? null };
    }),

  /** Weighs whose typed or current weight differs from the bridge beyond the tolerance, newest first. */
  mismatches: actionProcedure("device.view")
    .input(PAGE.optional())
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const s = await plantSettings(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.cursor ?? 0;
      const allowed = sql`max(${s.weighToleranceMinG}, abs(${deviceReadingUse.bridgeG}) * ${s.weighToleranceBp} / 10000)`;
      const rows = await ctx.db
        .select({ use: deviceReadingUse, lotNumber: purchaseLot.number, lotKgG: purchaseLot.fcKgG, dispatchCode: dispatch.code })
        .from(deviceReadingUse)
        .leftJoin(purchaseLot, and(eq(deviceReadingUse.subjectType, "purchase_lot"), eq(purchaseLot.id, deviceReadingUse.subjectId), eq(purchaseLot.companyId, deviceReadingUse.companyId)))
        .leftJoin(dispatch, and(eq(deviceReadingUse.subjectType, "dispatch"), eq(dispatch.id, deviceReadingUse.subjectId), eq(dispatch.companyId, deviceReadingUse.companyId)))
        .where(
          and(
            eq(deviceReadingUse.companyId, ctx.companyId),
            isNull(deviceReadingUse.voidedAt),
            inArray(deviceReadingUse.subjectType, ["purchase_lot", "dispatch"]),
            sql`(${deviceReadingUse.flagged} = 1 or (${deviceReadingUse.subjectType} = 'purchase_lot' and ${deviceReadingUse.bridgeG} is not null and ${purchaseLot.fcKgG} is not null and abs(${purchaseLot.fcKgG} - ${deviceReadingUse.bridgeG}) > ${allowed}))`,
          ),
        )
        .orderBy(desc(deviceReadingUse.createdAt))
        .limit(limit + 1)
        .offset(offset);
      return {
        items: rows.slice(0, limit).map((r) => ({
          id: r.use.id,
          subjectType: r.use.subjectType,
          subjectId: r.use.subjectId,
          number: r.lotNumber ?? r.dispatchCode ?? "",
          bridgeG: r.use.bridgeG,
          typedG: r.use.typedG,
          currentG: r.use.subjectType === "purchase_lot" ? r.lotKgG : r.use.typedG,
          reason: r.use.reason,
          createdAt: r.use.createdAt,
        })),
        nextCursor: rows.length > limit ? offset + limit : null,
      };
    }),
});

// ---------------------------------------------------------------------------
// Lab capture (rows 40, 94)
// ---------------------------------------------------------------------------

const CAPTURE_REFUSAL: Record<string, string> = {
  not_found: "Not found",
  not_lab: "That reading is a weighbridge ticket",
  simulated: "A simulated reading is not a quality check",
  no_match: "Not found",
  no_nominal: "No drawing size for these dimensions: add them to the quality plan or send them from the scanner",
  already_used: "That reading is already on a quality check",
};

const lab = router({
  /** Scanner and tensile readings that are on no check yet, and spectro files waiting for a person. */
  inbox: anyActionProcedure("device.view", "qa.check")
    .input(PAGE.optional())
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const limit = input?.limit ?? 50;
      const offset = input?.cursor ?? 0;
      const rows = await ctx.db
        .select()
        .from(deviceReading)
        .where(
          and(
            eq(deviceReading.companyId, ctx.companyId),
            inArray(deviceReading.kind, ["dimension", "mechanical"]),
            sql`not exists (select 1 from ${deviceReadingUse} u where u.company_id = ${deviceReading.companyId} and u.reading_id = ${deviceReading.id} and u.voided_at is null)`,
          ),
        )
        .orderBy(desc(deviceReading.sampledAt))
        .limit(limit + 1)
        .offset(offset);
      const spectro = await ctx.db
        .select({ id: spectroInbox.id, fileName: spectroInbox.fileName, sampleRef: spectroInbox.sampleRef, simulated: spectroInbox.simulated, createdAt: spectroInbox.createdAt })
        .from(spectroInbox)
        .where(and(eq(spectroInbox.companyId, ctx.companyId), eq(spectroInbox.status, "pending_review")))
        .orderBy(desc(spectroInbox.createdAt))
        .limit(50);
      return { items: rows.slice(0, limit).map(readingSummary), nextCursor: rows.length > limit ? offset + limit : null, spectro };
    }),

  /** Attach a lab reading to a run, bundle or ageing batch by its number; it becomes a quality check. */
  attach: actionProcedure("qa.check")
    .input(z.object({ readingId: id, code: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      await assertModule(ctx, "qa");
      const { subjectForSampleCode } = await import("../lib/devices");
      const subject = await subjectForSampleCode(ctx.db, ctx.companyId, normaliseSampleCode(input.code));
      if (!subject) throw notFound();
      const out = await captureLabReading(ctx.db, { companyId: ctx.companyId, readingId: input.readingId, actorId: ctx.session.user.id, subject: subject as { type: LabSubjectType; id: string }, auditCtx: audit(ctx) });
      if ("code" in out) {
        const code = out.code === "already_used" ? "CONFLICT" : out.code === "not_found" || out.code === "no_match" ? "NOT_FOUND" : "BAD_REQUEST";
        throw new TRPCError({ code, message: CAPTURE_REFUSAL[out.code]! });
      }
      return out;
    }),

  /** Set a lab reading aside (a test piece, a wrong code) with a reason; it leaves the inbox. */
  setAside: actionProcedure("qa.check")
    .input(z.object({ readingId: id, reason }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.db.select({ id: deviceReading.id, kind: deviceReading.kind }).from(deviceReading).where(and(eq(deviceReading.companyId, ctx.companyId), eq(deviceReading.id, input.readingId))).get();
      if (!r || r.kind === "weighbridge") throw notFound();
      const useId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(deviceReadingUse).values({ id: useId, companyId: ctx.companyId, readingId: r.id, subjectType: "set_aside", subjectId: null, reason: input.reason, createdBy: ctx.session.user.id }),
          auditInsert(audit(ctx), { action: "plant_device.set_aside", subjectType: "device_reading", subjectId: r.id, meta: { reason: input.reason } }),
        ]);
      } catch (e) {
        if (isQaUnique(e, "device_reading_use")) throw new TRPCError({ code: "CONFLICT", message: "That reading is already on a quality check" });
        throw e;
      }
      return { success: true };
    }),

  /** Device-captured checks on a press run or a die copy (row 40: shown on the run and the copy). */
  forSubject: anyActionProcedure("device.view", "qa.check", "press.run", "die.card")
    .input(z.object({ pressRunId: id.optional(), dieInstanceId: id.optional() }).refine((v) => Boolean(v.pressRunId) !== Boolean(v.dieInstanceId), "Name a run or a copy"))
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "devices");
      const rows = await ctx.db
        .select({ id: qaCheck.id, kind: qaCheck.kind, result: qaCheck.result, number: qaCheck.subjectNumber, flags: qaCheck.flagsJson, values: qaCheck.valuesJson, checkedAt: qaCheck.checkedAt, pressRunId: qaCheck.pressRunId })
        .from(qaCheck)
        .where(
          and(
            eq(qaCheck.companyId, ctx.companyId),
            input.pressRunId ? eq(qaCheck.pressRunId, input.pressRunId) : eq(qaCheck.dieInstanceId, input.dieInstanceId!),
            inArray(qaCheck.kind, ["dimension", "mechanical"]),
            sql`json_extract(${qaCheck.valuesJson}, '$.source') = 'device'`,
          ),
        )
        .orderBy(desc(qaCheck.checkedAt))
        .limit(50);
      const items = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        result: r.result,
        number: r.number,
        flagged: [...(r.flags.flagged ?? []), ...(r.flags.low ?? [])],
        deviceCode: (r.values as { deviceCode?: string | null }).deviceCode ?? null,
        checkedAt: r.checkedAt,
      }));
      return { items, outOfTolerance: items.filter((i) => i.result === "fail").length };
    }),
});

export const devicesRouter = router({
  ...deviceAdmin,
  readings,
  settings,
  import: imports,
  weigh,
  lab,
});
