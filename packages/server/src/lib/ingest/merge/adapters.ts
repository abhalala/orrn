/**
 * One adapter per Wave 1 target (plan A5, B4). Each writes a chunk's rows through the existing
 * procedure, as the person, so every check that procedure makes for a person still applies. The
 * chunk id is the clientRequestId; a multi-call chunk uses `<chunkId>-<i>` with `i` the row's (or
 * order's) place in the chunk, so a resend after a crash answers `replayed` and writes nothing twice.
 *
 * A multi-call chunk stops at the first refused call: rows written before it are kept as written,
 * and the refusal holds the candidate. A one-call chunk either writes every row or none.
 */
import { orderLineGrams } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { salesOrder } from "@orrn/db/schema/sales";
import type { IngestTarget } from "@orrn/db/schema/ingest";

import { mapInChunks } from "../../atomic";
import { assertModule } from "../../moduleGate";
import { companyFloor } from "../../orderLines";
import { can } from "../../permissions";
import { loadCustomerIndex, loadVendorIndex, resolveName } from "../resolvers";
import type { IngestCtx } from "../types";
import {
  failureOf,
  LINES_PER_ORDER,
  num,
  refOf,
  runsOf,
  text,
  valuesOf,
  type Adapter,
  type AdapterArgs,
  type AdapterOut,
  type StagedRow,
  type Values,
  type Written,
} from "./shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isUpdate = (r: StagedRow) => r.state === "ready_update" && !!r.matchId;

/** The fields a ready_update row changes: every field of its diff, with the file's value. */
function patchOf(row: StagedRow): Values {
  const out: Values = {};
  for (const [field, d] of Object.entries(row.diff ?? {})) out[field] = d.file;
  return out;
}

/** True when an update call of this chunk and row already wrote its audit row (a resend after a crash). */
async function updatedBefore(ctx: IngestCtx, action: string, chunkId: string, rowIndex: number): Promise<boolean> {
  const [hit] = await ctx.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, ctx.companyId),
        eq(auditLog.action, action),
        sql`json_extract(${auditLog.meta}, '$.source.chunkId') = ${chunkId}`,
        sql`json_extract(${auditLog.meta}, '$.source.rowFrom') = ${rowIndex}`,
      ),
    )
    .limit(1);
  return !!hit;
}

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
async function oneCall(fn: () => Promise<Written[]>): Promise<AdapterOut> {
  try {
    return { written: await fn(), failure: null };
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
}

function idsInOrder(rows: readonly StagedRow[], ids: readonly string[] | undefined, type: string): Written[] {
  if (!ids || ids.length !== rows.length) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The import did not say which records it wrote" });
  }
  return rows.map((r, i) => ({ rowId: r.id, committedType: type, committedId: ids[i]! }));
}

const nullable = (v: unknown) => text(v);

// ---------------------------------------------------------------------------
// customers (10): customer.importCsv; updates through customer.update
// ---------------------------------------------------------------------------

const customers: Adapter = async (args) => {
  const { ctx, rows } = args;
  if (rows.every(isUpdate)) {
    return perRow(args, rows, async (row) => {
      const caller = await args.callerFor(args.sourceOf([row]));
      if (!(await updatedBefore(ctx, "customer.update", args.chunk.id, row.rowIndex))) {
        const live = await caller.customer.get({ id: row.matchId! });
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
  return oneCall(async () => {
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

const customerAliases: Adapter = async (args) => {
  const { rows, refs } = args;
  if (rows.some(isUpdate)) {
    return {
      written: [],
      failure: { code: "BAD_REQUEST", message: "A name that belongs to another customer is not moved by an import. Skip these rows.", reason: "merge_failed" },
    };
  }
  return oneCall(async () => {
    const list = rows.map((row) => ({ row, customerId: refOf(row, "customer", refs)!, alias: text(valuesOf(row).alias) ?? "" }));
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
  if (rows.every(isUpdate)) {
    return perRow(args, rows, async (row) => {
      if (!(await updatedBefore(ctx, "vendor.update", args.chunk.id, row.rowIndex))) {
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
  return perRow(args, rows, async (row, i) => {
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
      clientRequestId: `${args.chunk.id}-${i}`,
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
  const { rows, refs } = args;
  if (rows.some(isUpdate)) {
    return {
      written: [],
      failure: { code: "BAD_REQUEST", message: "A name that belongs to another vendor is not moved by an import. Skip these rows.", reason: "merge_failed" },
    };
  }
  return perRow(args, rows, async (row, i) => {
    const vendorId = refOf(row, "vendor", refs)!;
    const caller = await args.callerFor(args.sourceOf([row]));
    const res = await caller.vendor.addAlias({ clientRequestId: `${args.chunk.id}-${i}`, vendorId, alias: text(valuesOf(row).alias) ?? "" });
    return { rowId: row.id, committedType: "vendor_alias", committedId: res.id };
  });
};

// ---------------------------------------------------------------------------
// dies (30): die.processImport, new and updated rows in one call
// ---------------------------------------------------------------------------

const dies: Adapter = async (args) => {
  const { ctx, rows } = args;
  return oneCall(async () => {
    const creates = rows.filter((r) => !isUpdate(r));
    const updates = rows.filter(isUpdate);
    const live = new Map(
      (
        await mapInChunks(
          updates.map((r) => r.matchId!),
          (part) =>
            ctx.db
              .select({ id: die.id, weightMinG: die.weightMinG, weightMaxG: die.weightMaxG })
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
    return idsInOrder([...creates, ...updates], res.ids, "die");
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

const dieCopies: Adapter = async (args) => {
  const { ctx, rows, refs } = args;
  if (rows.every(isUpdate)) {
    return perRow(args, rows, async (row) => {
      if (!(await updatedBefore(ctx, "die_instance.update", args.chunk.id, row.rowIndex))) {
        const p = patchOf(row);
        const all = copyFields(p);
        // The tier of an existing copy moves only by approval; an import never changes it.
        const fields = Object.fromEntries(
          Object.entries({ ...all, ...(text(p.status) ? { status: text(p.status) } : {}) }).filter(([k]) =>
            Object.hasOwn(p, k === "trialKgPer12ftMilli" ? "trialKgPer12ft" : k === "lifeG" ? "lifeKg" : k),
          ),
        );
        const caller = await args.callerFor(args.sourceOf([row]));
        await caller.dieInstance.update({ id: row.matchId!, ...(fields as Record<string, never>) });
      }
      return { rowId: row.id, committedType: "die_instance", committedId: row.matchId! };
    });
  }
  return perRow(args, rows, async (row, i) => {
    const v = valuesOf(row);
    const sectionId = refOf(row, "sectionCode", refs);
    if (!sectionId) throw new TRPCError({ code: "BAD_REQUEST", message: `Section ${text(v.sectionCode)} is not in orrn` });
    const status = text(v.status);
    const caller = await args.callerFor(args.sourceOf([row]));
    const res = await caller.dieInstance.create({
      clientRequestId: `${args.chunk.id}-${i}`,
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
  return oneCall(async () => {
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

/** Rows of a chunk grouped into orders: customer + (PO or old order number) + date; 100 lines at most. */
export function orderGroups(rows: readonly StagedRow[], refs: Map<string, string>): OrderGroup[] {
  const groups = new Map<string, StagedRow[]>();
  for (const row of rows) {
    const v = valuesOf(row);
    const customer = refOf(row, "customer", refs) ?? text(v.customer) ?? "";
    const key = [customer, text(v.poNumber) ?? text(v.oldOrderNo) ?? "", text(v.orderDate) ?? ""].join("\u001f");
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: OrderGroup[] = [];
  for (const [key, list] of groups) {
    runsOf(list, LINES_PER_ORDER).forEach((part, n) => out.push({ key: n === 0 ? key : `${key}\u001f${n}`, rows: part }));
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
  const { createInput, createSalesOrder } = await import("../../../routers/salesOrder");
  const { confirmOrder, orderConfirmBlockers } = await import("../../../routers/orderFlow");
  const floor = await companyFloor(ctx.db, ctx.companyId);
  const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
  // Rates are written only for a person who may see them, and only when the plant uses them (A8, D8).
  const canPrice = can(me, "order.price") && floor.floor.priceOnSalesOrder === true;

  let groups: OrderGroup[];
  try {
    groups = orderGroups(rows, refs);
  } catch (e) {
    return { written: [], failure: failureOf(e) };
  }
  const written: Written[] = [];
  for (const [g, group] of groups.entries()) {
    try {
      const first = valuesOf(group.rows[0]!);
      const customerId = refOf(group.rows[0]!, "customer", refs);
      if (!customerId) throw new TRPCError({ code: "BAD_REQUEST", message: `${text(first.customer) ?? "This party"} is not a customer in orrn` });
      const oldNo = text(first.oldOrderNo);
      const notes = [oldNo ? `Old order no. ${oldNo}` : null].filter(Boolean).join(" ");
      const lines = group.rows.map((row) => {
        const v = valuesOf(row);
        const sectionId = refOf(row, "sectionCode", refs);
        if (!sectionId) throw new TRPCError({ code: "BAD_REQUEST", message: `Section ${text(v.sectionCode)} is not in orrn` });
        const rate = num(v.rate);
        return {
          sectionId,
          kgPer12ftMilli: num(v.kgPer12ft),
          cutLengthMm: num(v.cutLength) as number,
          pcs: num(v.pcs),
          kgG: orderLineGrams(v).grams ?? undefined,
          finish: nullable(v.finish),
          alloy: nullable(v.alloy),
          temper: nullable(v.temper),
          note: nullable(v.note),
          ...(canPrice && rate !== null ? { ratePaise: rate } : {}),
        };
      });
      // The same input check as `orders.create`.
      const input = createInput.parse({
        customerId,
        poNumber: text(first.poNumber),
        ...(text(first.orderDate) ? { orderDate: text(first.orderDate)! } : {}),
        note: notes || null,
        lines,
        clientRequestId: `${args.chunk.id}-${g}`,
      });
      const source = args.sourceOf(group.rows);
      const made = await createSalesOrder({ ...ctx, ingestSource: source }, input, { canPrice, source: "ingest" });

      // Confirm when the order is complete; otherwise it stays a booking (plan B4, D9). Not a failure.
      let blocked: string | null = null;
      const [order] = await ctx.db
        .select({ id: salesOrder.id, status: salesOrder.status, poNumber: salesOrder.poNumber })
        .from(salesOrder)
        .where(and(eq(salesOrder.id, made.id), eq(salesOrder.companyId, ctx.companyId)))
        .limit(1);
      if (order && order.status === "booking") {
        const blockers = await orderConfirmBlockers(ctx.db, ctx.companyId, order);
        if (blockers.length > 0) blocked = blockers.join(", ");
        else {
          try {
            await confirmOrder({ ...ctx, ingestSource: source }, { id: order.id });
          } catch (e) {
            if (e instanceof TRPCError && (e.code === "BAD_REQUEST" || e.code === "CONFLICT")) blocked = e.message;
            else throw e;
          }
        }
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
