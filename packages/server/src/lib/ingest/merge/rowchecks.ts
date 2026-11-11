/**
 * Row checks the merge applies, in one place, so the dry run applies the very same ones first and a
 * person never approves a row the merge then refuses. Each check returns a code and the field it is
 * about (what the dry run stages as the row reason `<code>:<field>`), and a message (what the merge
 * puts after `File row N: ` when it holds a candidate).
 *
 * - orders (B11): no weight, nothing left to dispatch, no cut length, or anything `orderLineInput`
 *   refuses.
 * - die copies (B12): a status only die issue, maker jobs and trials may set.
 * - customer and vendor aliases (B13): an alias that is already the name of another customer or
 *   vendor, and an alias that belongs to another customer or vendor (never moved by an import).
 * - order groups (B1, B5): an order above 100 lines, one PO on two order dates.
 * - new die copies: a section that is archived, a new copy sent straight to nitriding.
 */
import { DIE_COPY_HAND_STATUSES } from "@orrn/domain";
import { orderLineGrams } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import { customer } from "@orrn/db/schema/customers";
import { ingestStagedRow } from "@orrn/db/schema/ingest";
import { vendor } from "@orrn/db/schema/purchase";

import { mapInChunks } from "../../atomic";
import { serverNameKey } from "../resolvers";
import type { IngestCtx } from "../types";
import { num, text, type Values } from "./shared";

/** One failed row check. `code` and `field` make the dry run reason; `message` is for the merge hold. */
export type RowCheck = { code: string; field: string; message: string };

const at = (rowIndex: number) => `File row ${rowIndex + 1}`;

// ---------------------------------------------------------------------------
// Orders (B11)
// ---------------------------------------------------------------------------

export type LineSchema = (typeof import("../../../routers/salesOrder"))["orderLineInput"];
export type OrderLine = z.input<LineSchema>;

/** The staged fields `orderLineCheck` reads, so the planner can read them without the whole row. */
export const ORDER_LINE_FIELDS = ["orderedKg", "dispatchedKg", "bakiKg", "cutLength", "kgPer12ft", "pcs", "finish", "alloy", "temper", "note", "rate"] as const;

/**
 * One order line as the order screen takes it, or the check it fails. The schema is passed in because
 * routers/salesOrder is imported lazily (see `loadOrderLineSchema`).
 */
export function orderLineCheck(
  schema: LineSchema,
  v: Values,
  sectionId: string,
  canPrice: boolean,
): { line: OrderLine; problem: null } | { line: null; problem: RowCheck } {
  const grams = orderLineGrams(v).grams;
  if (grams === null) {
    return { line: null, problem: { code: "no_weight", field: "bakiKg", message: "no weight on this line. Give the ordered or balance kg, or skip the row." } };
  }
  if (grams <= 0) {
    return { line: null, problem: { code: "not_positive", field: "bakiKg", message: "nothing is left to dispatch on this line (balance 0 kg). Skip the row." } };
  }
  if (num(v.cutLength) === null) {
    return { line: null, problem: { code: "no_cut_length", field: "cutLength", message: "no cut length. Give the cut length, or skip the row." } };
  }
  const rate = num(v.rate);
  const line = {
    sectionId,
    kgPer12ftMilli: num(v.kgPer12ft),
    cutLengthMm: num(v.cutLength)!,
    pcs: num(v.pcs),
    kgG: grams,
    finish: text(v.finish),
    alloy: text(v.alloy),
    temper: text(v.temper),
    note: text(v.note),
    ...(canPrice && rate !== null ? { ratePaise: rate } : {}),
  };
  const ok = schema.safeParse(line);
  if (!ok.success) {
    const issue = ok.error.issues[0]!;
    const path = issue.path.join(".");
    return { line: null, problem: { code: "line_invalid", field: path, message: `${path}: ${issue.message}` } };
  }
  return { line, problem: null };
}

/** The line for the merge, or a BAD_REQUEST that names the file row. */
export function orderLineOf(schema: LineSchema, rowIndex: number, v: Values, sectionId: string, canPrice: boolean): OrderLine {
  const r = orderLineCheck(schema, v, sectionId, canPrice);
  if (r.problem) throw new TRPCError({ code: "BAD_REQUEST", message: `${at(rowIndex)}: ${r.problem.message}` });
  return r.line;
}

export async function loadOrderLineSchema(): Promise<LineSchema> {
  return (await import("../../../routers/salesOrder")).orderLineInput;
}

// ---------------------------------------------------------------------------
// Order groups (B1, B5)
// ---------------------------------------------------------------------------

/**
 * The order key of a staged row in SQL: the key the dry run stored (orderid.ts), or the row's own
 * order when it has none. The one rule lives in orderid.ts; this only reads its result.
 */
export const ORDER_GROUP_SQL = sql<string>`coalesce(${ingestStagedRow.orderKey}, 'row' || char(31) || ${ingestStagedRow.id})`;

export { ORDER_GROUP_CODES, orderGroupCheck, type OrderGroupRow } from "../orderid";

// ---------------------------------------------------------------------------
// New die copies
// ---------------------------------------------------------------------------

/** What dieInstance.create refuses for a new copy: an archived section, a copy that starts at nitriding. */
export function newCopyCheck(sectionStatus: string | null | undefined, status: unknown): RowCheck | null {
  if (sectionStatus && sectionStatus !== "active") {
    return { code: "section_archived", field: "sectionCode", message: "This section is archived; no new die copies" };
  }
  if (text(status) === "at_nitriding") {
    return { code: "status_not_allowed", field: "status", message: "A new copy starts on the rack; send it to nitriding from its card" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Die copies (B12)
// ---------------------------------------------------------------------------

/**
 * A copy's status as an import may set it. `in_use`, `at_maker` and `on_trial` are written only by
 * die issue, maker jobs and trials, and dieInstance refuses them from a person.
 */
export function handStatusCheck(value: unknown): RowCheck | null {
  const status = text(value);
  if (status === null || (DIE_COPY_HAND_STATUSES as readonly string[]).includes(status)) return null;
  return {
    code: "status_not_allowed",
    field: "status",
    message: `status ${status} cannot come from a file. Use available, at_nitriding or retired, or skip the row.`,
  };
}

/** The merge's message for `handStatusCheck`, or null. */
export function handStatusRefusal(rowIndex: number, value: unknown): string | null {
  const c = handStatusCheck(value);
  return c ? `${at(rowIndex)}: ${c.message}` : null;
}

// ---------------------------------------------------------------------------
// Aliases (B13)
// ---------------------------------------------------------------------------

export type NameOwner = { id: string; name: string };

/** The name keys of these texts: unique, no blanks. */
export function nameKeysOf(texts: readonly string[]): string[] {
  return [...new Set(texts.map((t) => serverNameKey(t)).filter(Boolean))];
}

/** Live vendors by name key: the partial unique index `vendor_company_name_key_unique`. */
export const LIVE_VENDOR = sql`${vendor.status} <> 'merged'`;

/**
 * The live customer or vendor each name key belongs to, for the alias targets (B13). The dry run and
 * the planner check a whole candidate with it; each adapter checks again. With `aliases`, only the
 * keys of those texts are looked up (B-new-2): vendors by `vendor_company_name_key_unique` and the
 * status index, 90 keys at a time. Without it, the whole table is read, as before.
 */
export async function aliasNameOwners(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  target: "customer_aliases" | "vendor_aliases",
  aliases?: readonly string[],
): Promise<Map<string, NameOwner>> {
  const out = new Map<string, NameOwner>();
  const keys = aliases ? new Set(nameKeysOf(aliases)) : null;
  if (keys?.size === 0) return out;
  if (target === "vendor_aliases") {
    const names = keys
      ? [
          // Live vendors first, then merged ones (which keep their names), as the whole-table read did.
          ...(await mapInChunks([...keys], (part) =>
            ctx.db
              .select({ id: vendor.id, name: vendor.name, key: vendor.nameKey })
              .from(vendor)
              .where(and(eq(vendor.companyId, ctx.companyId), LIVE_VENDOR, inArray(vendor.nameKey, part))),
          )),
          ...(await mapInChunks([...keys], (part) =>
            ctx.db
              .select({ id: vendor.id, name: vendor.name, key: vendor.nameKey })
              .from(vendor)
              .where(and(eq(vendor.companyId, ctx.companyId), eq(vendor.status, "merged"), inArray(vendor.nameKey, part))),
          )),
        ]
      : await ctx.db.select({ id: vendor.id, name: vendor.name, key: vendor.nameKey }).from(vendor).where(eq(vendor.companyId, ctx.companyId));
    for (const n of names) if (n.key && !out.has(n.key)) out.set(n.key, { id: n.id, name: n.name });
    return out;
  }
  const names = await ctx.db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)));
  for (const c of names) {
    const k = serverNameKey(c.name);
    if (k && (!keys || keys.has(k)) && !out.has(k)) out.set(k, c);
  }
  return out;
}

/** An alias that is already the name of another customer or vendor, or null. */
export function aliasNameCheck(alias: string, ownerId: string | null, owners: Map<string, NameOwner>): RowCheck | null {
  const own = owners.get(serverNameKey(alias));
  if (!own || own.id === ownerId) return null;
  return { code: "alias_is_name", field: "alias", message: `${alias} is already the name of ${own.name}. Skip the row.` };
}

/** The merge's message for `aliasNameCheck`, or null. */
export function aliasRefusal(rowIndex: number, alias: string, ownerId: string | null, owners: Map<string, NameOwner>): string | null {
  const c = aliasNameCheck(alias, ownerId, owners);
  return c ? `${at(rowIndex)}: ${c.message}` : null;
}

/**
 * An alias that already belongs to another customer or vendor (`alias_taken`). The merge never moves
 * it: the alias adapters refuse any update. Only skip or keep orrn's (`keep_live`) fit such a row.
 */
export function aliasMoveRefusal(target: "customer_aliases" | "vendor_aliases"): string {
  return `A name that belongs to another ${target === "vendor_aliases" ? "vendor" : "customer"} is not moved by an import. Skip these rows.`;
}

/** The dry run reason of a failed check: `<code>:<field>`. */
export const checkReason = (c: Pick<RowCheck, "code" | "field">) => `${c.code}:${c.field}`;
