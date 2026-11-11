/**
 * One adapter per Wave 1 target (plan A5, B4). Each writes a chunk's rows through the existing
 * procedure, as the person, so every check that procedure makes for a person still applies. The
 * chunk id is the clientRequestId; a multi-call chunk uses `<chunkId>-<i>` with `i` the row's (or
 * order's) place in the chunk, so a resend after a crash answers `replayed` and writes nothing twice.
 *
 * A multi-call chunk stops at the first refused call: rows written before it are kept as written,
 * and the refusal holds the candidate. A one-call chunk either writes every row or none.
 */
import { DIE_COPY_HAND_STATUSES } from "@orrn/domain";
import { orderLineGrams } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { vendor } from "@orrn/db/schema/purchase";
import { salesOrder } from "@orrn/db/schema/sales";
import type { IngestTarget } from "@orrn/db/schema/ingest";

import { mapInChunks } from "../../atomic";
import { assertModule } from "../../moduleGate";
import { companyFloor } from "../../orderLines";
import { can } from "../../permissions";
import { loadCustomerIndex, loadSections, loadVendorIndex, resolveName, resolveSection, serverNameKey } from "../resolvers";
import type { IngestCtx } from "../types";
import {
  failureOf,
  fileRowsIn,
  LINES_PER_ORDER,
  MESSAGE_MAX,
  num,
  orderKeyOf,
  refOf,
  rowsRequestId,
  text,
  valuesOf,
  type Adapter,
  type AdapterArgs,
  type AdapterOut,
  type StagedRow,
  type Values,
  type SentRows,
  type Written,
} from "./shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The path is chosen by state, never by whether a match is set (B6). */
const isUpdate = (r: Pick<StagedRow, "state">) => r.state === "ready_update";

/** Targets the merge only adds to: a ready_update row there has no update path (B6). */
const ADD_ONLY: Partial<Record<IngestTarget, { one: string; many: string }>> = {
  bundles: { one: "a bundle", many: "bundles" },
  orders: { one: "an order", many: "orders" },
};

/**
 * Why a ready_update row may not be sent, or null (B6): it names no record to update, or its
 * target only takes new records (bundles, orders), where sending it would make a second record.
 * The planner checks every row of a candidate with it before any chunk is written; the adapters
 * check again.
 */
export function updateRefusal(target: IngestTarget, row: Pick<StagedRow, "state" | "matchId" | "rowIndex">): string | null {
  if (!isUpdate(row)) return null;
  const add = ADD_ONLY[target];
  if (add && row.matchId) return `File row ${row.rowIndex + 1} would change ${add.one} already in orrn. An import only adds new ${add.many}. Skip the row.`;
  if (!row.matchId) return `File row ${row.rowIndex + 1} has no record to update. Pick the record to use, or add it as new.`;
  return null;
}

/** `updateRefusal` over a chunk, thrown as a refusal of the whole chunk. */
function assertNoUpdate(target: IngestTarget, rows: readonly StagedRow[]): void {
  for (const r of rows) {
    const refusal = updateRefusal(target, r);
    if (refusal) throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
  }
}

/**
 * A chunk's kind before any call: all creates, or all updates that each name the record they
 * update. An update row with no record, or a mix, refuses the whole chunk, so an update row never
 * takes a create path (B6).
 */
function kindOf(rows: readonly StagedRow[]): "create" | "update" {
  const bad = rows.find((r) => isUpdate(r) && !r.matchId);
  if (bad) throw new TRPCError({ code: "BAD_REQUEST", message: updateRefusal("customers", bad)! });
  if (rows.every(isUpdate)) return "update";
  if (rows.some(isUpdate)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A part mixes new and changed records" });
  return "create";
}

/** `kindOf` as a chunk failure instead of a throw. */
function chunkKind(rows: readonly StagedRow[]): { kind: "create" | "update" } | { failure: AdapterOut } {
  try {
    return { kind: kindOf(rows) };
  } catch (e) {
    return { failure: { written: [], failure: failureOf(e) } };
  }
}

/** The fields a ready_update row changes: every field of its diff, with the file's value. */
function patchOf(row: StagedRow): Values {
  const out: Values = {};
  for (const [field, d] of Object.entries(row.diff ?? {})) out[field] = d.file;
  return out;
}

/**
 * True when an update of this staged row already wrote its audit row (a resend after a crash, or a
 * rerun after a call that landed but looked failed). Keyed by the record, the candidate and the
 * row, not the chunk, so a later chunk or run finds it too (B8). The subject filter uses
 * audit_subject_idx (Bm6).
 */
async function updatedBefore(ctx: IngestCtx, action: string, subjectType: string, row: StagedRow): Promise<boolean> {
  const [hit] = await ctx.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, ctx.companyId),
        eq(auditLog.subjectType, subjectType),
        eq(auditLog.subjectId, row.matchId!),
        eq(auditLog.action, action),
        sql`json_extract(${auditLog.meta}, '$.source.candidateId') = ${row.candidateId}`,
        sql`json_extract(${auditLog.meta}, '$.source.rowFrom') = ${row.rowIndex}`,
      ),
    )
    .limit(1);
  return !!hit;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
/** The dry run's comparison (dryrun.ts `same`): text ignores case and outer spaces. */
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b;

/**
 * Refuse an update whose live record changed after the dry run (B2, owner rule "never overwrite
 * silently"). Each diff field passes when the live value is still what the dry run saw (blank
 * counts as blank) or already equals the file value. `live` uses the dry run's field names.
 */
function assertNotStale(row: StagedRow, live: Values): void {
  for (const [field, d] of Object.entries(row.diff ?? {})) {
    if (!(field in live)) continue;
    const now = live[field];
    if ((blank(now) && blank(d.live)) || same(now, d.live) || same(now, d.file)) continue;
    throw new TRPCError({
      code: "CONFLICT",
      message: `File row ${row.rowIndex + 1}: ${field} changed in orrn since the dry run. Review it and run the dry run again.`,
    });
  }
}

/** The replay key of a one-row call: from the staged row, never the chunk (B8). */
const rowKey = (row: StagedRow) => rowsRequestId([row.id]);

/** Run one call per row, in order, stopping at the first refusal. */
async function perRow(
  args: AdapterArgs,
  rows: readonly StagedRow[],
  call: (row: StagedRow, i: number) => Promise<Written>,
): Promise<AdapterOut> {
  const written: Written[] = [];
  for (const row of rows) {
    const i = args.rows.indexOf(row);
    try {
      written.push(await call(row, i));
    } catch (e) {
      return { written, failure: failureOf(e) };
    }
  }
  return { written, failure: null };
}

/** One call for every row of the chunk: all rows written or none. */
async function oneCall(fn: (sent: SentRows) => Promise<Written[]>): Promise<AdapterOut> {
  const sent: SentRows = {};
  try {
    return { written: await fn(sent), failure: null };
  } catch (e) {
    const failure = failureOf(e);
    return { written: [], failure: { ...failure, message: fileRowsIn(failure.message, sent).slice(0, MESSAGE_MAX) } };
  }
}

function idsInOrder(rows: readonly StagedRow[], ids: readonly string[] | undefined, type: string): Written[] {
  if (!ids || ids.length !== rows.length) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The import did not say which records it wrote" });
  }
  return rows.map((r, i) => ({ rowId: r.id, committedType: type, committedId: ids[i]! }));
}

const nullable = (v: unknown) => text(v);

/**
 * The section a row points at. A row the person said to add as an old section (`legacyDie`) is
 * looked up live at chunk time, which finds a section created earlier in the same run (a die sheet
 * merged with the order book) or added by hand since the dry run (B10). If there is still none,
 * the row is refused with a plain message: die.processImport needs a real weight band, and an
 * import does not make one up. `cache` is per chunk.
 */
async function sectionFor(args: AdapterArgs, row: StagedRow, cache: Map<string, string>): Promise<string> {
  const v = valuesOf(row);
  const id = refOf(row, "sectionCode", args.refs);
  if (id) return id;
  const code = text(v.sectionCode) ?? "";
  if (v.legacyDie !== true) throw new TRPCError({ code: "BAD_REQUEST", message: `Section ${code} is not in orrn` });
  const series = text(v.series);
  const key = `${(series ?? "").toUpperCase()}|${code.toUpperCase()}`;
  const known = cache.get(key);
  if (known) return known;
  const hit = resolveSection(await loadSections(args.ctx, [code]), series, code);
  if (hit.kind === "ambiguous") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `File row ${row.rowIndex + 1}: section ${code} matches more than one section in orrn. Give its series.` });
  }
  if (hit.kind === "none") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `File row ${row.rowIndex + 1}: section ${series ? `${series} ` : ""}${code} is not in orrn. Add it with a die sheet or on the dies screen, then merge again.`,
    });
  }
  cache.set(key, hit.id);
  return hit.id;
}

// ---------------------------------------------------------------------------
// customers (10): customer.importCsv; updates through customer.update
// ---------------------------------------------------------------------------

const customers: Adapter = async (args) => {
  const { ctx, rows } = args;
  const k = chunkKind(rows);
  if ("failure" in k) return k.failure;
  if (k.kind === "update") {
    return perRow(args, rows, async (row) => {
      const caller = await args.callerFor(args.sourceOf([row]));
      if (!(await updatedBefore(ctx, "customer.update", "customer", row))) {
        const live = await caller.customer.get({ id: row.matchId! });
        assertNotStale(row, {
          taxId: live.taxId,
          phone: live.phone,
          email: live.email,
          city: (live.billingAddress as { city?: unknown } | null)?.city ?? null,
          notes: live.notes,
        });
        const p = patchOf(row);
        const has = (k: string) => Object.hasOwn(p, k);
        const billing = { ...((live.billingAddress as Record<string, unknown> | null) ?? {}) };
        if (has("city")) billing.city = nullable(p.city);
        // customer.update writes every field it is given: send the live values for the rest.
        await caller.customer.update({
          id: live.id,
          name: live.name,
          phone: has("phone") ? nullable(p.phone) : live.phone,
          email: has("email") ? nullable(p.email) : live.email,
          billingAddress: has("city") ? billing : live.billingAddress,
          shippingAddress: live.shippingAddress,
          taxId: has("taxId") ? nullable(p.taxId) : live.taxId,
          notes: has("notes") ? nullable(p.notes) : live.notes,
        });
      }
      return { rowId: row.id, committedType: "customer", committedId: row.matchId! };
    });
  }
  return oneCall(async (sent) => {
    // A name added since the dry run (or by this chunk before a crash) is not added again (plan D7).
    const index = await loadCustomerIndex(ctx);
    const written: Written[] = [];
    const send: StagedRow[] = [];
    for (const row of rows) {
      const hit = resolveName(index, text(valuesOf(row).name) ?? "");
      if (hit.kind === "match") written.push({ rowId: row.id, committedType: "customer", committedId: hit.id });
      else send.push(row);
    }
    if (send.length === 0) return written;
    sent.rows = send;
    const caller = await args.callerFor(args.sourceOf(send));
    const res = await caller.customer.importCsv({
      clientRequestId: args.chunk.id,
      rows: send.map((row) => {
        const v = valuesOf(row);
        const city = nullable(v.city);
        return {
          name: text(v.name) ?? "",
          taxId: nullable(v.taxId),
          phone: nullable(v.phone),
          email: nullable(v.email),
          notes: nullable(v.notes),
          ...(city ? { billingAddress: { city } } : {}),
        };
      }),
    });
    return [...written, ...idsInOrder(send, res.ids, "customer")];
  });
};

// ---------------------------------------------------------------------------
// customer_aliases (11): customer.addAliases
// ---------------------------------------------------------------------------

export type NameOwner = { id: string; name: string };

/**
 * The live customer or vendor each name key belongs to, for the alias targets (B13). The planner
 * checks a whole candidate with it before any chunk is written; each adapter checks again.
 */
export async function aliasNameOwners(ctx: IngestCtx, target: "customer_aliases" | "vendor_aliases"): Promise<Map<string, NameOwner>> {
  const out = new Map<string, NameOwner>();
  if (target === "vendor_aliases") {
    const names = await ctx.db.select({ id: vendor.id, name: vendor.name, key: vendor.nameKey }).from(vendor).where(eq(vendor.companyId, ctx.companyId));
    for (const n of names) if (n.key && !out.has(n.key)) out.set(n.key, { id: n.id, name: n.name });
    return out;
  }
  const names = await ctx.db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)));
  for (const c of names) {
    const k = serverNameKey(c.name);
    if (k && !out.has(k)) out.set(k, c);
  }
  return out;
}

/** The refusal for an alias that is already the name of another customer or vendor, or null. */
export function aliasRefusal(rowIndex: number, alias: string, ownerId: string | null, owners: Map<string, NameOwner>): string | null {
  const own = owners.get(serverNameKey(alias));
  if (!own || own.id === ownerId) return null;
  return `File row ${rowIndex + 1}: ${alias} is already the name of ${own.name}. Skip the row.`;
}

const customerAliases: Adapter = async (args) => {
  const { ctx, rows, refs } = args;
  if (rows.some(isUpdate)) {
    return {
      written: [],
      failure: { code: "BAD_REQUEST", message: "A name that belongs to another customer is not moved by an import. Skip these rows.", reason: "merge_failed" },
    };
  }
  return oneCall(async (sent) => {
    sent.rows = rows;
    const list = rows.map((row) => ({ row, customerId: refOf(row, "customer", refs)!, alias: text(valuesOf(row).alias) ?? "" }));
    // customer.addAliases refuses the whole call for a name that is another customer's. The planner
    // holds such a candidate before any chunk is written (B13); this is the backstop.
    const owners = await aliasNameOwners(ctx, "customer_aliases");
    for (const { row, customerId, alias } of list) {
      const refusal = aliasRefusal(row.rowIndex, alias, customerId, owners);
      if (refusal) throw new TRPCError({ code: "CONFLICT", message: refusal });
    }
    const caller = await args.callerFor(args.sourceOf(rows));
    const res = await caller.customer.addAliases({ clientRequestId: args.chunk.id, rows: list.map(({ customerId, alias }) => ({ customerId, alias })) });
    return list.map(({ row, customerId }, i) => ({
      rowId: row.id,
      // An alias equal to the customer's own name adds no row; it points at the customer.
      committedType: res.ids[i] === customerId ? "customer" : "customer_alias",
      committedId: res.ids[i]!,
    }));
  });
};

// ---------------------------------------------------------------------------
// vendors (20): vendor.create one per call; updates through vendor.update
// ---------------------------------------------------------------------------

const vendors: Adapter = async (args) => {
  const { ctx, rows } = args;
  const k = chunkKind(rows);
  if ("failure" in k) return k.failure;
  if (k.kind === "update") {
    return perRow(args, rows, async (row) => {
      if (!(await updatedBefore(ctx, "vendor.update", "vendor", row))) {
        const [live] = await ctx.db
          .select({ gstin: vendor.gstin, phone: vendor.phone, city: vendor.city, notes: vendor.notes })
          .from(vendor)
          .where(and(eq(vendor.id, row.matchId!), eq(vendor.companyId, ctx.companyId)))
          .limit(1);
        if (!live) throw new TRPCError({ code: "NOT_FOUND", message: `File row ${row.rowIndex + 1}: that vendor is no longer in orrn` });
        assertNotStale(row, live);
        const p = patchOf(row);
        const caller = await args.callerFor(args.sourceOf([row]));
        await caller.vendor.update({
          id: row.matchId!,
          ...(Object.hasOwn(p, "gstin") ? { gstin: nullable(p.gstin) } : {}),
          ...(Object.hasOwn(p, "phone") ? { phone: nullable(p.phone) } : {}),
          ...(Object.hasOwn(p, "city") ? { city: nullable(p.city) } : {}),
          ...(Object.hasOwn(p, "notes") ? { notes: nullable(p.notes) } : {}),
        });
      }
      return { rowId: row.id, committedType: "vendor", committedId: row.matchId! };
    });
  }
  const index = await loadVendorIndex(ctx);
  return perRow(args, rows, async (row) => {
    const v = valuesOf(row);
    // A name added since the dry run is not added again (plan D7).
    const hit = resolveName(index, text(v.name) ?? "");
    if (hit.kind === "match") return { rowId: row.id, committedType: "vendor", committedId: hit.id };
    const caller = await args.callerFor(args.sourceOf([row]));
    const aliases = (text(v.aliases) ?? "")
      .split(";")
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await caller.vendor.create({
      clientRequestId: await rowKey(row),
      name: text(v.name) ?? "",
      gstin: nullable(v.gstin),
      phone: nullable(v.phone),
      city: nullable(v.city),
      notes: nullable(v.notes),
      ...(aliases.length ? { aliases } : {}),
    });
    return { rowId: row.id, committedType: "vendor", committedId: res.id };
  });
};

// ---------------------------------------------------------------------------
// vendor_aliases (21): vendor.addAlias one per call
// ---------------------------------------------------------------------------

const vendorAliases: Adapter = async (args) => {
  const { ctx, rows, refs } = args;
  if (rows.some(isUpdate)) {
    return {
      written: [],
      failure: { code: "BAD_REQUEST", message: "A name that belongs to another vendor is not moved by an import. Skip these rows.", reason: "merge_failed" },
    };
  }
  // A name of another vendor is refused by vendor.addAlias. The planner holds such a candidate
  // before any chunk is written (B13); this is the backstop. The vendor's own name adds nothing: it
  // is recorded against the vendor, as for customers.
  const nameOwner = await aliasNameOwners(ctx, "vendor_aliases");
  try {
    for (const row of rows) {
      const refusal = aliasRefusal(row.rowIndex, text(valuesOf(row).alias) ?? "", refOf(row, "vendor", refs), nameOwner);
      if (refusal) throw new TRPCError({ code: "CONFLICT", message: refusal });
    }
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  return perRow(args, rows, async (row) => {
    const vendorId = refOf(row, "vendor", refs)!;
    if (nameOwner.get(serverNameKey(text(valuesOf(row).alias) ?? ""))?.id === vendorId) {
      return { rowId: row.id, committedType: "vendor", committedId: vendorId };
    }
    const caller = await args.callerFor(args.sourceOf([row]));
    const res = await caller.vendor.addAlias({ clientRequestId: await rowKey(row), vendorId, alias: text(valuesOf(row).alias) ?? "" });
    return { rowId: row.id, committedType: "vendor_alias", committedId: res.id };
  });
};

// ---------------------------------------------------------------------------
// dies (30): die.processImport, new and updated rows in one call
// ---------------------------------------------------------------------------

const dies: Adapter = async (args) => {
  const { ctx, rows } = args;
  return oneCall(async (sent) => {
    // One call takes both kinds; an update row must still name its record (B6).
    const noMatch = rows.find((r) => isUpdate(r) && !r.matchId);
    if (noMatch) kindOf([noMatch]);
    const updates = rows.filter(isUpdate);
    // A section added since the dry run is not added again (as plan D7 does for names, Bm8): the
    // row is recorded against it. Same key as the dry run: series and code, trimmed, any case.
    const keyOf = (series: unknown, code: unknown) => `${(text(series) ?? "").toUpperCase()}|${(text(code) ?? "").toUpperCase()}`;
    const fresh = rows.filter((r) => !isUpdate(r));
    const liveByKey = new Map(
      (
        await mapInChunks([...new Set(fresh.map((r) => (text(valuesOf(r).sectionCode) ?? "").toUpperCase()))].filter(Boolean), (part) =>
          ctx.db
            .select({ id: die.id, series: die.series, sectionCode: die.sectionCode })
            .from(die)
            .where(and(eq(die.companyId, ctx.companyId), isNull(die.deletedAt), inArray(sql`upper(trim(${die.sectionCode}))`, part))),
        )
      ).map((d) => [keyOf(d.series, d.sectionCode), d.id]),
    );
    const already: Written[] = [];
    const creates: StagedRow[] = [];
    for (const r of fresh) {
      const hit = liveByKey.get(keyOf(valuesOf(r).series, valuesOf(r).sectionCode));
      if (hit) already.push({ rowId: r.id, committedType: "die", committedId: hit });
      else creates.push(r);
    }
    if (creates.length === 0 && updates.length === 0) return already;
    sent.newRows = creates;
    sent.updatedRows = updates;
    const live = new Map(
      (
        await mapInChunks(
          updates.map((r) => r.matchId!),
          (part) =>
            ctx.db
              .select({
                id: die.id,
                name: die.name,
                widthMm: die.widthMm,
                thicknessMm: die.thicknessMm,
                legMm: die.legMm,
                dimensions: die.dimensions,
                weightMinG: die.weightMinG,
                weightMaxG: die.weightMaxG,
                status: die.status,
                notes: die.notes,
              })
              .from(die)
              .where(and(eq(die.companyId, ctx.companyId), inArray(die.id, part))),
        )
      ).map((d) => [d.id, d]),
    );
    const caller = await args.callerFor(args.sourceOf(rows));
    const res = await caller.die.processImport({
      clientRequestId: args.chunk.id,
      newRows: creates.map((row) => {
        const v = valuesOf(row);
        return {
          series: text(v.series) ?? "",
          sectionCode: text(v.sectionCode) ?? "",
          name: nullable(v.name),
          widthMm: num(v.widthMm),
          thicknessMm: num(v.thicknessMm),
          legMm: num(v.legMm),
          weightMinG: num(v.weightMinG) ?? 0,
          weightMaxG: num(v.weightMaxG) ?? 0,
          ...(text(v.status) ? { status: text(v.status) as "active" | "archived" } : {}),
          notes: nullable(v.notes),
        };
      }),
      updatedRows: updates.map((row) => {
        const v = valuesOf(row);
        const p = patchOf(row);
        const has = (k: string) => Object.hasOwn(p, k);
        const was = live.get(row.matchId!);
        if (!was) throw new TRPCError({ code: "NOT_FOUND", message: `Section ${text(v.sectionCode)} is no longer in orrn` });
        const dims = (was.dimensions ?? {}) as Record<string, unknown>;
        assertNotStale(row, {
          name: was.name,
          widthMm: dims.widthMm ?? was.widthMm,
          thicknessMm: dims.thicknessMm ?? was.thicknessMm,
          legMm: dims.legMm ?? was.legMm,
          weightMinG: was.weightMinG,
          weightMaxG: was.weightMaxG,
          status: was.status,
          notes: was.notes,
        });
        // Only the fields the dry run marked change; the weights stay as orrn has them otherwise.
        return {
          existingId: row.matchId!,
          series: text(v.series) ?? "",
          sectionCode: text(v.sectionCode) ?? "",
          weightMinG: has("weightMinG") ? (num(p.weightMinG) ?? was.weightMinG) : was.weightMinG,
          weightMaxG: has("weightMaxG") ? (num(p.weightMaxG) ?? was.weightMaxG) : was.weightMaxG,
          ...(has("name") ? { name: nullable(p.name) } : {}),
          ...(has("widthMm") ? { widthMm: num(p.widthMm) } : {}),
          ...(has("thicknessMm") ? { thicknessMm: num(p.thicknessMm) } : {}),
          ...(has("legMm") ? { legMm: num(p.legMm) } : {}),
          ...(has("status") && text(p.status) ? { status: text(p.status) as "active" | "archived" } : {}),
          ...(has("notes") ? { notes: nullable(p.notes) } : {}),
        };
      }),
    });
    return [...already, ...idsInOrder([...creates, ...updates], res.ids, "die")];
  });
};

// ---------------------------------------------------------------------------
// die_copies (31): dieInstance.create one per call; updates through dieInstance.update
// ---------------------------------------------------------------------------

const copyFields = (v: Values) => ({
  makerDieNo: nullable(v.makerDieNo),
  makerProjectNo: nullable(v.makerProjectNo),
  supplier: nullable(v.supplier),
  trialKgPer12ftMilli: num(v.trialKgPer12ft),
  hardness: num(v.hardness),
  lifeG: num(v.lifeKg),
  notes: nullable(v.notes),
});

const COPY_UPDATE: Record<string, [string, (v: unknown) => unknown]> = {
  makerDieNo: ["makerDieNo", nullable],
  makerProjectNo: ["makerProjectNo", nullable],
  supplier: ["supplier", nullable],
  trialKgPer12ft: ["trialKgPer12ftMilli", num],
  hardness: ["hardness", num],
  lifeKg: ["lifeG", num],
  notes: ["notes", nullable],
  status: ["status", text],
};

/**
 * A copy's status as an import may set it (B12). `in_use`, `at_maker` and `on_trial` are written
 * only by die issue, maker jobs and trials, and dieInstance refuses them from a person.
 */
export function handStatusRefusal(rowIndex: number, value: unknown): string | null {
  const status = text(value);
  if (status === null || (DIE_COPY_HAND_STATUSES as readonly string[]).includes(status)) return null;
  return `File row ${rowIndex + 1}: status ${status} cannot come from a file. Use available, at_nitriding or retired, or skip the row.`;
}

/** The planner holds such a candidate before any copy is made (B12); this is the backstop. */
function assertHandStatus(rows: readonly StagedRow[], update: boolean): void {
  for (const row of rows) {
    const refusal = handStatusRefusal(row.rowIndex, update ? patchOf(row).status : valuesOf(row).status);
    if (refusal) throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
  }
}

const dieCopies: Adapter = async (args) => {
  const { ctx, rows } = args;
  const k = chunkKind(rows);
  if ("failure" in k) return k.failure;
  try {
    assertHandStatus(rows, k.kind === "update");
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  if (k.kind === "update") {
    return perRow(args, rows, async (row) => {
      if (!(await updatedBefore(ctx, "die_instance.update", "die_instance", row))) {
        const [c] = await ctx.db
          .select()
          .from(dieInstance)
          .where(and(eq(dieInstance.id, row.matchId!), eq(dieInstance.companyId, ctx.companyId)))
          .limit(1);
        if (!c) throw new TRPCError({ code: "NOT_FOUND", message: `File row ${row.rowIndex + 1}: that die copy is no longer in orrn` });
        assertNotStale(row, {
          supplier: c.supplier,
          makerProjectNo: c.makerProjectNo,
          trialKgPer12ft: c.trialKgPer12ftMilli,
          hardness: c.hardness,
          lifeKg: c.lifeG,
          tierRank: c.tierRank,
          status: c.status,
          notes: c.notes,
        });
        // File field to `dieInstance.update` input. The tier of an existing copy moves only by
        // approval, so an import never sends it.
        const fields: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(patchOf(row))) {
          const to = COPY_UPDATE[field];
          if (to) fields[to[0]] = to[1](value);
        }
        const caller = await args.callerFor(args.sourceOf([row]));
        await caller.dieInstance.update({ id: row.matchId!, ...(fields as { notes?: string | null }) });
      }
      return { rowId: row.id, committedType: "die_instance", committedId: row.matchId! };
    });
  }
  const sections = new Map<string, string>();
  return perRow(args, rows, async (row) => {
    const v = valuesOf(row);
    const sectionId = await sectionFor(args, row, sections);
    const status = text(v.status);
    const caller = await args.callerFor(args.sourceOf([row]));
    const res = await caller.dieInstance.create({
      clientRequestId: await rowKey(row),
      sectionId,
      ...(num(v.tierRank) !== null ? { tierRank: num(v.tierRank)! } : {}),
      ...copyFields(v),
      ...(status ? { status: status as "available" | "at_nitriding" | "retired" } : {}),
    });
    return { rowId: row.id, committedType: "die_instance", committedId: res.id };
  });
};

// ---------------------------------------------------------------------------
// bundles (40): bundle.bulkImport with legacyId per row
// ---------------------------------------------------------------------------

const bundles: Adapter = async (args) => {
  const { ctx, rows, refs } = args;
  return oneCall(async (sent) => {
    // A bundle row is only ever a new bundle; a ready_update row is refused, never added (B6).
    assertNoUpdate("bundles", rows);
    sent.rows = rows;
    // The section the dry run resolved (its own series and code, which may differ in case or
    // series from the file); an old section the person said to add keeps the file's code.
    const dieIds = [...new Set(rows.map((r) => refOf(r, "sectionCode", refs)).filter((x): x is string => !!x))];
    const dies = new Map(
      (
        await mapInChunks(dieIds, (part) =>
          ctx.db
            .select({ id: die.id, series: die.series, sectionCode: die.sectionCode })
            .from(die)
            .where(and(eq(die.companyId, ctx.companyId), inArray(die.id, part))),
        )
      ).map((d) => [d.id, d]),
    );
    const caller = await args.callerFor(args.sourceOf(rows));
    const res = await caller.bundle.bulkImport({
      clientRequestId: args.chunk.id,
      rows: rows.map((row) => {
        const v = valuesOf(row);
        const dieId = refOf(row, "sectionCode", refs);
        const d = dieId ? dies.get(dieId) : undefined;
        if (dieId && !d) throw new TRPCError({ code: "NOT_FOUND", message: `Section ${text(v.sectionCode)} is no longer in orrn` });
        if (!d && v.legacyDie !== true) throw new TRPCError({ code: "BAD_REQUEST", message: `Section ${text(v.sectionCode)} is not in orrn` });
        const legacyId = text(v.legacyId);
        return {
          dieSeries: d ? d.series : (text(v.series) ?? ""),
          dieSectionCode: d ? d.sectionCode : (text(v.sectionCode) ?? ""),
          quantity: num(v.quantity) ?? 0,
          weightG: num(v.weightG) ?? 0,
          lengthMm: num(v.lengthMm) ?? 0,
          poNumber: nullable(v.poNumber),
          ...(legacyId ? { legacyId } : {}),
        };
      }),
    });
    return idsInOrder(rows, res.ids, "bundle");
  });
};

// ---------------------------------------------------------------------------
// orders (50): createSalesOrder as source "ingest", then confirmOrder
// ---------------------------------------------------------------------------

type OrderGroup = { key: string; rows: StagedRow[] };

type LineSchema = (typeof import("../../../routers/salesOrder"))["orderLineInput"];
type OrderLine = z.input<LineSchema>;

/**
 * One order line as the order screen takes it, or a refusal that names the file row (B11): no
 * weight, a closed line (balance 0 or less), no cut length, or anything `orderLineInput` refuses.
 * The schema is passed in because routers/salesOrder is imported lazily here.
 */
export function orderLineOf(schema: LineSchema, rowIndex: number, v: Values, sectionId: string, canPrice: boolean): OrderLine {
  const at = `File row ${rowIndex + 1}`;
  const grams = orderLineGrams(v).grams;
  if (grams === null) throw new TRPCError({ code: "BAD_REQUEST", message: `${at}: no weight on this line. Give the ordered or balance kg, or skip the row.` });
  if (grams <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: `${at}: nothing is left to dispatch on this line (balance 0 kg). Skip the row.` });
  if (num(v.cutLength) === null) throw new TRPCError({ code: "BAD_REQUEST", message: `${at}: no cut length. Give the cut length, or skip the row.` });
  const rate = num(v.rate);
  const line = {
    sectionId,
    kgPer12ftMilli: num(v.kgPer12ft),
    cutLengthMm: num(v.cutLength)!,
    pcs: num(v.pcs),
    kgG: grams,
    finish: nullable(v.finish),
    alloy: nullable(v.alloy),
    temper: nullable(v.temper),
    note: nullable(v.note),
    ...(canPrice && rate !== null ? { ratePaise: rate } : {}),
  };
  const ok = schema.safeParse(line);
  if (!ok.success) {
    const issue = ok.error.issues[0]!;
    throw new TRPCError({ code: "BAD_REQUEST", message: `${at}: ${issue.path.join(".")}: ${issue.message}` });
  }
  return line;
}

/** The staged fields `orderLineOf` reads, so the planner can read them without the whole row. */
export const ORDER_LINE_FIELDS = ["orderedKg", "dispatchedKg", "bakiKg", "cutLength", "kgPer12ft", "pcs", "finish", "alloy", "temper", "note", "rate"] as const;

/**
 * Rates are written only by a person who may see them, and only when the plant uses them (A8,
 * D8). `refusal` says why not, for a candidate that carries rates.
 */
export async function orderPricing(ctx: IngestCtx): Promise<{ canPrice: boolean; refusal: string }> {
  const floor = await companyFloor(ctx.db, ctx.companyId);
  const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
  const on = floor.floor.priceOnSalesOrder === true;
  const may = can(me, "order.price");
  return {
    canPrice: on && may,
    refusal: !on
      ? "This sheet has rates, and rates on sales orders are off for this plant. Turn rates on first, or take the rate column out of this sheet's layout."
      : "This sheet has rates. Only someone who may see prices can merge it: ask the owner to merge, or leave the rates out on this candidate.",
  };
}

/**
 * Rows of a chunk grouped into orders (orderKeyOf). One group is one order: it is never cut, so one
 * PO never becomes two orders (B1, B5). Planning holds a candidate with an order above 100 lines;
 * this check is the backstop.
 */
export function orderGroups(rows: readonly StagedRow[]): OrderGroup[] {
  const groups = new Map<string, StagedRow[]>();
  for (const row of rows) {
    const key = orderKeyOf(valuesOf(row));
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: OrderGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length > LINES_PER_ORDER) {
      const v = valuesOf(list[0]!);
      const name = text(v.poNumber) ? `PO ${text(v.poNumber)}` : `The order on file row ${list[0]!.rowIndex + 1}`;
      throw new TRPCError({ code: "BAD_REQUEST", message: `${name} has ${list.length} lines. An order takes ${LINES_PER_ORDER} lines at most.` });
    }
    out.push({ key, rows: list });
  }
  return out;
}

const orders: Adapter = async (args) => {
  const { ctx, rows, refs } = args;
  // The order screens are refused when the module is off; so is the merge (plan A8).
  try {
    await assertModule(ctx, "orders");
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  const { createInput, createSalesOrder, orderLineInput } = await import("../../../routers/salesOrder");
  const { confirmOrder, orderConfirmBlockers } = await import("../../../routers/orderFlow");
  const price = await orderPricing(ctx);
  const canPrice = price.canPrice;
  // A staged rate is never dropped without a choice (D8, B3): the planner holds such a candidate;
  // this is the backstop.
  if (!canPrice && rows.some((r) => num(valuesOf(r).rate) !== null)) {
    return { written: [], failure: { code: "FORBIDDEN", message: price.refusal, reason: "merge_failed" } };
  }
  // The merge only makes new orders: a ready_update row would make a second one (B6). The planner
  // holds such a candidate first; this is the backstop.
  try {
    assertNoUpdate("orders", rows);
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }

  let groups: OrderGroup[];
  try {
    groups = orderGroups(rows);
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  // Every line's section before any order is written (B10: an old section is found or added).
  const sectionOf = new Map<string, string>();
  try {
    const cache = new Map<string, string>();
    for (const row of rows) sectionOf.set(row.id, await sectionFor(args, row, cache));
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  // Every line checked before any order is written (B11). The planner runs the same check over the
  // whole candidate first; this is the backstop.
  const lineOf = new Map<string, OrderLine>();
  try {
    for (const row of rows) lineOf.set(row.id, orderLineOf(orderLineInput, row.rowIndex, valuesOf(row), sectionOf.get(row.id)!, canPrice));
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  const written: Written[] = [];
  for (const group of groups) {
    try {
      const first = valuesOf(group.rows[0]!);
      const customerId = refOf(group.rows[0]!, "customer", refs);
      if (!customerId) throw new TRPCError({ code: "BAD_REQUEST", message: `${text(first.customer) ?? "This party"} is not a customer in orrn` });
      // Every old order number of the order's rows (one PO may cover several), in file order.
      const oldNos = [...new Set(group.rows.map((r) => text(valuesOf(r).oldOrderNo)).filter((x): x is string => !!x))];
      const notes = oldNos.length ? `Old order no. ${oldNos.join(", ")}` : "";
      const lines = group.rows.map((row) => lineOf.get(row.id)!);
      // The same input check as `orders.create`.
      const input = createInput.parse({
        customerId,
        poNumber: text(first.poNumber),
        ...(text(first.orderDate) ? { orderDate: text(first.orderDate)! } : {}),
        note: notes || null,
        lines,
        // From the order's own rows, so a resend from any chunk or run carries the same key (B8).
        clientRequestId: await rowsRequestId(group.rows.map((r) => r.id)),
      });
      const source = args.sourceOf(group.rows);
      const made = await createSalesOrder({ ...ctx, ingestSource: source }, input, { canPrice, source: "ingest" });

      // Confirm when the order is complete; otherwise it stays a booking (plan B4, D9). Not a failure.
      // The order exists from here on: any error while confirming is recorded on its rows, never
      // thrown, so the rows are recorded as written and a rerun cannot make it again (B8).
      let blocked: string | null = null;
      try {
        const [order] = await ctx.db
          .select({ id: salesOrder.id, status: salesOrder.status, poNumber: salesOrder.poNumber })
          .from(salesOrder)
          .where(and(eq(salesOrder.id, made.id), eq(salesOrder.companyId, ctx.companyId)))
          .limit(1);
        if (order && order.status === "booking") {
          const blockers = await orderConfirmBlockers(ctx.db, ctx.companyId, order);
          if (blockers.length > 0) blocked = blockers.join(", ");
          else await confirmOrder({ ...ctx, ingestSource: source }, { id: order.id });
        }
      } catch (e) {
        blocked =
          e instanceof TRPCError && e.code !== "INTERNAL_SERVER_ERROR"
            ? e.message
            : "The order was saved as a booking but could not be confirmed. Confirm it on the order screen.";
        if (!(e instanceof TRPCError)) console.error("ingest merge: confirm after create failed", e);
      }
      for (const row of group.rows) {
        written.push({
          rowId: row.id,
          committedType: "sales_order",
          committedId: made.id,
          ...(blocked ? { reasons: [`confirm_blocked:${blocked}`.slice(0, 300)] } : {}),
        });
      }
    } catch (e) {
      return { written, failure: failureOf(e) };
    }
  }
  return { written, failure: null };
};

export const ADAPTERS: Record<IngestTarget, Adapter> = {
  customers,
  customer_aliases: customerAliases,
  vendors,
  vendor_aliases: vendorAliases,
  dies,
  die_copies: dieCopies,
  bundles,
  orders,
};
