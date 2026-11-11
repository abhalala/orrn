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
 *   vendor.
 */
import { DIE_COPY_HAND_STATUSES } from "@orrn/domain";
import { orderLineGrams } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { customer } from "@orrn/db/schema/customers";
import { vendor } from "@orrn/db/schema/purchase";

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

/**
 * The live customer or vendor each name key belongs to, for the alias targets (B13). The dry run and
 * the planner check a whole candidate with it; each adapter checks again.
 */
export async function aliasNameOwners(ctx: Pick<IngestCtx, "db" | "companyId">, target: "customer_aliases" | "vendor_aliases"): Promise<Map<string, NameOwner>> {
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

/** The dry run reason of a failed check: `<code>:<field>`. */
export const checkReason = (c: Pick<RowCheck, "code" | "field">) => `${c.code}:${c.field}`;
