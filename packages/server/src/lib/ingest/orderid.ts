/**
 * What makes two order rows the same old order (PORTAL-RULES-3 section 1), and the checks over one
 * old order. This is the only place the rule lives: the dry run, the merge planner and the orders
 * adapter all call it.
 *
 * - An old order is the plant (every read here is scoped to it), the financial year, the customer
 *   (the live id, or `new:<name key>` for a customer this import adds) and the old order number
 *   after trim, case and leading zeros.
 * - The PO is a fact about the order, never part of it. A sheet with no order number falls back to
 *   customer and PO. A row with neither is its own order.
 * - The dry run writes the key into `ingest_staged_row.order_key`. The planner and the adapter group
 *   by that column, so they cannot disagree with the dry run.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { ingestArtifact, ingestBlock, ingestCandidate, ingestOrderKey, ingestStagedRow } from "@orrn/db/schema/ingest";
import { salesOrder } from "@orrn/db/schema/sales";

import { mapInChunks } from "../atomic";
import { nameKey } from "../purchase";
import type { IngestCtx } from "./types";

const SEP = "\u001f";

export type OrderKind = "no" | "po" | "row";

export type OrderIdentity = {
  key: string;
  kind: OrderKind;
  /** A live customer id, or `new:<name key>` for a customer this import adds. */
  customer: string;
  /** The financial year of the order date (2025-26), or "" when the row has no date. */
  fy: string;
  /** The old order number after normalising, or null. */
  no: string | null;
  /** The row's own PO, lower case and trimmed, or null. Not part of the key for `no`. */
  po: string | null;
};

const textOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));

/** An old order number as one order: trim, one space, lower case, no leading zeros in a run of digits. */
export function normOrderNo(v: unknown): string {
  return textOf(v)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
}

/** A PO as the order screens compare it: trim and case. */
export function normPo(v: unknown): string {
  return textOf(v).trim().toLowerCase();
}

/** The Indian financial year of a YYYY-MM-DD date (April to March), or "". */
export function orderFyOf(date: unknown): string {
  const d = textOf(date);
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  const y = Number(d.slice(0, 4));
  const start = Number(d.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The first and last day of a financial year like 2025-26. */
export function fyRange(fy: string): { from: string; to: string } | null {
  const m = /^(\d{4})-\d{2}$/.exec(fy);
  if (!m) return null;
  const start = Number(m[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/**
 * The customer part of an order identity: the live id, or `new:<name key>` when the row points at
 * a customer this import adds (any `pending:` reference), so two sheets that add the same party
 * agree. Null when the row has no customer yet.
 */
export function customerPartOf(values: Record<string, unknown>): string | null {
  const ids = (values._ids ?? {}) as Record<string, unknown>;
  const id = textOf(ids.customer);
  if (!id) {
    // Not resolved (only rows staged by hand, in tests): the party name as written.
    const key = nameKey(textOf(values.customer));
    return key ? `name:${key}` : null;
  }
  if (!id.startsWith("pending:")) return id;
  const key = nameKey(textOf(values.customer));
  return key ? `new:${key}` : id;
}

/** The old order a staged order row belongs to, or null when its customer is not known yet. */
export function orderIdentityOf(values: Record<string, unknown>, rowKey: string): OrderIdentity | null {
  const customer = customerPartOf(values);
  if (!customer) return null;
  const no = normOrderNo(values.oldOrderNo);
  const po = normPo(values.poNumber);
  const fy = orderFyOf(values.orderDate);
  if (no) return { key: ["no", fy, customer, no].join(SEP), kind: "no", customer, fy, no, po: po || null };
  if (po) return { key: ["po", customer, po].join(SEP), kind: "po", customer, fy, no: null, po };
  return { key: ["row", rowKey].join(SEP), kind: "row", customer, fy, no: null, po: null };
}

/**
 * The PO key of an order row: the customer part of its order key and its own PO, trimmed and in
 * lower case. Null when the row has no PO or no customer. Stored in `ingest_staged_row.po_key`, so a
 * PO-only order finds the numbered order of another sheet that carries its PO (rule 4.2).
 */
export function poKeyOf(customer: string | null | undefined, po: unknown): string | null {
  const p = normPo(po);
  return customer && p ? `${customer}${SEP}${p}` : null;
}

/** Whether two financial years may be one order: equal, or one of them unknown (no date). */
export const fyFits = (a: string, b: string) => !a || !b || a === b;

/** The financial year of a group of rows: their one year, or "" when they have none or several. */
export function groupFyOf(dates: readonly (string | null)[]): string {
  const fys = new Set(dates.map((d) => orderFyOf(d)).filter(Boolean));
  return fys.size === 1 ? [...fys][0]! : "";
}

/** The parts of a stored order key. A `row` key has no customer, year, number or PO. */
export function parseOrderKey(key: string): { kind: OrderKind; customer: string | null; fy: string; no: string | null; po: string | null } {
  const [kind = "row", a = "", b = "", c = ""] = key.split(SEP);
  if (kind === "no") return { kind, fy: a, customer: b, no: c, po: null };
  if (kind === "po") return { kind, fy: "", customer: a, no: null, po: b };
  return { kind: "row", fy: "", customer: null, no: null, po: null };
}

/** The key the planner and the adapter use for a row with no stored key: its own order. */
export const ownOrderKey = (rowId: string) => ["row", rowId].join(SEP);

/** Whether a stored key is a row that became its own order (no order number, no PO). */
export const isOwnOrderKey = (key: string | null | undefined) => !!key && key.startsWith(`row${SEP}`);

// ---------------------------------------------------------------------------
// One old order's rows
// ---------------------------------------------------------------------------

/** The fields of one order line the group checks read. `po` lower case, `poText` as written. */
export type OrderGroupRow = { rowIndex: number; po: string | null; poText: string | null; orderDate: string | null; oldNo: string | null };

/** The plain name of an old order in a message. */
export function orderLabel(list: readonly OrderGroupRow[]): string {
  const first = list[0];
  if (!first) return "This order";
  const no = list.find((r) => r.oldNo)?.oldNo;
  if (no) return `Old order ${no}`;
  const po = list.find((r) => r.poText)?.poText;
  if (po) return `PO ${po}`;
  return `The order on file row ${first.rowIndex + 1}`;
}

/**
 * The PO an old order carries: the one value its rows agree on. Rows with a blank PO take it.
 * `all` lists every different PO as first written; more than one is a question for the person.
 */
export function orderPoOf(list: readonly Pick<OrderGroupRow, "po" | "poText">[]): { po: string | null; poText: string | null; all: string[] } {
  const seen = new Map<string, string>();
  for (const r of list) {
    const k = r.po ?? normPo(r.poText);
    if (k && !seen.has(k)) seen.set(k, (r.poText ?? k).trim());
  }
  const all = [...seen.values()];
  if (seen.size !== 1) return { po: null, poText: null, all };
  const [po, poText] = [...seen][0]!;
  return { po, poText, all };
}

export type OrderCheck = { code: string; field: string; message: string };

/** Lines one sales order takes (orderLineInput MAX_LINES). */
export const ORDER_LINES_MAX = 100;

/** Row reason codes of `orderGroupCheck` and `sheetOrderKeys`, so the dry run can find the rows it refused. */
export const ORDER_GROUP_CODES = ["order_lines_over", "po_two_dates", "po_on_two_orders", "order_no_unclear"] as const;

/**
 * One old order the merge would not send: two different POs (the person picks one first), above
 * 100 lines, or, for an order known only by its PO (`kind` "po", a sheet with no order number),
 * more than one order date. An order with a number is one order whatever its dates in the year
 * say: the PO never decides whether it can import (S3-5).
 */
export function orderGroupCheck(list: readonly OrderGroupRow[], kind: OrderKind = "po"): OrderCheck | null {
  if (list.length === 0) return null;
  const name = orderLabel(list);
  const po = orderPoOf(list);
  if (po.all.length > 1) {
    return {
      code: "order_two_pos",
      field: "poNumber",
      message: `${name} has more than one PO number in the file (${po.all.slice(0, 3).join(", ")}). Pick the right one on the sheet, or skip the order.`,
    };
  }
  if (list.length > ORDER_LINES_MAX) {
    return {
      code: "order_lines_over",
      field: "order",
      message: `${name} has ${list.length} lines. An order takes ${ORDER_LINES_MAX} lines at most. Split it in the file or skip some rows.`,
    };
  }
  const dates = [...new Set(list.map((r) => r.orderDate ?? ""))];
  if (kind === "po" && po.po && dates.length > 1) {
    return {
      code: "po_two_dates",
      field: "orderDate",
      message: `${name} has more than one order date in the file (${dates.filter(Boolean).slice(0, 3).join(", ")}). One PO is one order. Fix the dates or skip rows.`,
    };
  }
  return null;
}

/** The plain words for one PO on two old orders. */
export function poTwiceWords(poText: string, a: string, b: string, where = "in the file"): string {
  return `PO ${poText} is on ${a} and on ${b.replace(/^Old order/, "old order")} ${where}. One PO can be on one order only. Skip the rows of one of them, or fix the file.`;
}

/**
 * Old orders of one sheet with the same customer and PO under different keys: two order numbers, or
 * an order number and an order known only by its PO in another financial year (S3-1, rule 4.2). The
 * order screens take a PO once per customer, so nothing of either may be written until a person
 * answers: every one of them is in the map, each naming another (the dry run marks all of them as a
 * conflict, the planner holds the candidate).
 */
export function poTwiceCheck(groups: readonly { key: string; list: readonly OrderGroupRow[] }[]): Map<string, OrderCheck> {
  const out = new Map<string, OrderCheck>();
  const byPo = new Map<string, { key: string; label: string; poText: string }[]>();
  const sorted = [...groups].sort((a, b) => Math.min(...a.list.map((r) => r.rowIndex)) - Math.min(...b.list.map((r) => r.rowIndex)));
  for (const g of sorted) {
    const k = parseOrderKey(g.key);
    const po = orderPoOf(g.list);
    if (k.kind === "row" || !po.po || !k.customer) continue;
    const at = `${k.customer}${SEP}${po.po}`;
    byPo.set(at, [...(byPo.get(at) ?? []), { key: g.key, label: orderLabel(g.list), poText: po.poText ?? po.po }]);
  }
  for (const list of byPo.values()) {
    if (list.length < 2) continue;
    for (const g of list) {
      const other = list.find((x) => x.key !== g.key)!;
      const [a, b] = list.indexOf(g) < list.indexOf(other) ? [g.label, other.label] : [other.label, g.label];
      out.set(g.key, { code: "po_on_two_orders", field: "poNumber", message: poTwiceWords(g.poText, a, b) });
    }
  }
  return out;
}

/**
 * Which old order each row of one sheet belongs to, decided over the whole sheet, not row by row
 * (S3-1, rule 4.2). A row with no order number but a PO first gets a customer-and-PO key. When the
 * sheet has exactly one numbered order of the same customer and financial year with a row carrying
 * that PO, the row is a line of that order (`remap`, from key to key). When it has several, the row
 * cannot be placed: it is refused with `order_no_unclear` (`unclear`). When it has none, the
 * customer and PO are the order, as in a sheet with no order number column. `fy` is the year of a
 * PO-only group's rows ("" when they have none or several); a numbered order's year is in its key.
 */
export function sheetOrderKeys(groups: readonly { key: string; pos: readonly (string | null)[]; fy?: string }[]): { remap: Map<string, string>; unclear: Set<string> } {
  // Numbered orders by customer and each PO any of their rows carries.
  const numbered = new Map<string, { key: string; fy: string }[]>();
  for (const g of groups) {
    const k = parseOrderKey(g.key);
    if (k.kind !== "no" || !k.customer) continue;
    for (const p of new Set(g.pos.map((po) => normPo(po)).filter(Boolean))) {
      const at = `${k.customer}${SEP}${p}`;
      numbered.set(at, [...(numbered.get(at) ?? []), { key: g.key, fy: k.fy }]);
    }
  }
  const remap = new Map<string, string>();
  const unclear = new Set<string>();
  for (const g of groups) {
    const k = parseOrderKey(g.key);
    if (k.kind !== "po" || !k.customer || !k.po) continue;
    const hits = (numbered.get(`${k.customer}${SEP}${k.po}`) ?? []).filter((h) => fyFits(h.fy, g.fy ?? ""));
    if (hits.length === 0) continue;
    if (hits.length === 1) remap.set(g.key, hits[0]!.key);
    else unclear.add(g.key);
  }
  return { remap, unclear };
}

/** The words for a row with no order number whose PO is on more than one numbered order. */
export const ORDER_NO_UNCLEAR: OrderCheck = {
  code: "order_no_unclear",
  field: "oldOrderNo",
  message: "This row has no order number, and its PO is on more than one order in this sheet. Fill in the order number, or skip the row.",
};

// ---------------------------------------------------------------------------
// Live orders
// ---------------------------------------------------------------------------

/** The note the merge writes on an imported order: "Old order no. 41" or "Old order no. B-1, B-2". */
export const OLD_ORDER_NOTE = /^Old order no\. (.+)$/;

/** The old order numbers an order's note names, normalised. */
export function noteOrderNos(note: string | null | undefined): string[] {
  const m = OLD_ORDER_NOTE.exec((note ?? "").trim());
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((x) => normOrderNo(x))
    .filter(Boolean);
}

export type LiveOrder = {
  id: string;
  number: string;
  requestId: string | null;
  status: string;
  by: "no" | "po";
  /** The old order an import made this order for (`ingest_order_key.key`), or null for an order typed in orrn. */
  oldKey: string | null;
};

/** What one live lookup needs: a live customer id (never `new:`), the year, the number and the PO. */
export type LiveLookup = { key: string; customerId: string; fy: string; no: string | null; po: string | null };

/** The key of a numbered old order in `ingest_order_key`: year, live customer id, number. */
export const liveOrderKey = (customerId: string, fy: string, no: string) => [fy, customerId, no].join(SEP);

/**
 * The row that records which old order an import made (S3-6). Its id comes from the order (one
 * numbered old order a sales order), so a resend of the same chunk records it once.
 */
export function orderKeyRecord(ctx: Pick<IngestCtx, "db" | "companyId">, salesOrderId: string, key: string) {
  return ctx.db
    .insert(ingestOrderKey)
    .values({ id: `iok_${salesOrderId}`, companyId: ctx.companyId, key, salesOrderId })
    .onConflictDoNothing();
}

/**
 * The live order each old order already is (rule 1, against live data):
 * - by number: an order an import made for the same customer, financial year and number
 *   (`ingest_order_key`), not closed or cancelled;
 * - else by PO: the same customer and PO, not cancelled (the order screens refuse a PO twice).
 * Both read by index, 90 keys or POs a statement, never every order of the customer (S3-6).
 */
export async function liveOrdersOf(ctx: Pick<IngestCtx, "db" | "companyId">, lookups: readonly LiveLookup[]): Promise<Map<string, LiveOrder>> {
  const out = new Map<string, LiveOrder>();
  const real = lookups.filter((l) => l.customerId && !l.customerId.startsWith("new:") && !l.customerId.startsWith("pending:") && !l.customerId.startsWith("name:"));
  if (real.length === 0) return out;
  const byNo = new Map<string, LiveOrder>();
  const noKeys = [...new Set(real.filter((l) => l.no && fyRange(l.fy)).map((l) => liveOrderKey(l.customerId, l.fy, l.no!)))];
  const pick = { id: salesOrder.id, number: salesOrder.number, requestId: salesOrder.clientRequestId, status: salesOrder.status };
  if (noKeys.length) {
    const rows = await mapInChunks(noKeys, (part) =>
      ctx.db
        .select({ ...pick, key: ingestOrderKey.key })
        .from(ingestOrderKey)
        .innerJoin(salesOrder, and(eq(salesOrder.id, ingestOrderKey.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
        .where(and(eq(ingestOrderKey.companyId, ctx.companyId), inArray(ingestOrderKey.key, part), notInArray(salesOrder.status, ["closed", "cancelled"]))),
    );
    for (const o of rows.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0))) {
      if (!byNo.has(o.key)) byNo.set(o.key, { id: o.id, number: o.number, requestId: o.requestId, status: o.status, by: "no", oldKey: o.key });
    }
  }
  const byPo = new Map<string, LiveOrder>();
  const posByCustomer = new Map<string, Set<string>>();
  for (const l of real) if (l.po) posByCustomer.set(l.customerId, (posByCustomer.get(l.customerId) ?? new Set()).add(normPo(l.po)));
  for (const [customerId, pos] of posByCustomer) {
    // On sales_order_company_customer_po_lower_idx: the customer's orders with these POs only.
    const rows = await mapInChunks([...pos], (part) =>
      ctx.db
        .select({ ...pick, po: sql<string>`lower(${salesOrder.poNumber})`, oldKey: ingestOrderKey.key })
        .from(salesOrder)
        .leftJoin(ingestOrderKey, and(eq(ingestOrderKey.salesOrderId, salesOrder.id), eq(ingestOrderKey.companyId, ctx.companyId)))
        .where(and(eq(salesOrder.companyId, ctx.companyId), eq(salesOrder.customerId, customerId), inArray(sql`lower(${salesOrder.poNumber})`, part), sql`${salesOrder.status} <> 'cancelled'`)),
    );
    for (const o of rows) {
      const k = `${customerId}${SEP}${o.po}`;
      if (!byPo.has(k)) byPo.set(k, { id: o.id, number: o.number, requestId: o.requestId, status: o.status, by: "po", oldKey: o.oldKey ?? null });
    }
  }
  for (const l of real) {
    const hit: LiveOrder | undefined = (l.no && fyRange(l.fy) ? byNo.get(liveOrderKey(l.customerId, l.fy, l.no)) : undefined) ?? (l.po ? byPo.get(`${l.customerId}${SEP}${normPo(l.po)}`) : undefined);
    if (hit) out.set(l.key, hit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The same old order in another file or sheet
// ---------------------------------------------------------------------------

export type OtherHolder = {
  key: string;
  candidateId: string;
  candidateState: string;
  createdAt: Date;
  fileName: string;
  sheetName: string | null;
  /**
   * `order`: the other candidate holds rows of this same old order (the same key, or a PO-only
   * order and the numbered order of the same customer and year that carries its PO). `po`: it holds
   * another old order with the same customer and PO (one PO on two orders, rule 4.2).
   */
  why: "order" | "po";
  /** The other candidate's order key. */
  otherKey: string;
  /** Rows of the other candidate's order that would write it, or wrote it. */
  rows: { id: string; state: string; decision: string | null; written: boolean }[];
};

/** One old order of a candidate, as the cross-file check compares it. */
export type OrderRef = { key: string; poKey: string | null; fy: string };

/** How another sheet's order `other` stands to `mine`, when they share the customer and PO. */
function poRelation(mine: { key: string; fy: string }, other: { key: string; fy: string }): "order" | "po" {
  const a = parseOrderKey(mine.key);
  const b = parseOrderKey(other.key);
  if (a.kind === "po" && b.kind === "po") return "order";
  // A PO-only order and a numbered one of the same year are one order (rule 4.2).
  if (a.kind !== b.kind) return fyFits(a.kind === "no" ? a.fy : mine.fy, b.kind === "no" ? b.fy : other.fy) ? "order" : "po";
  return "po";
}

/**
 * Other orders candidates of the plant that hold rows of these old orders (rule 1 and 4.2, across
 * files): not discarded, not fully merged, and with a row that would make the order (ready,
 * waiting on a person, in conflict) or already made it while its candidate still merges. A merged
 * candidate is left to the live order check, so a cancelled order may be imported again (S3-3).
 * Both keys are compared: the order key, and the customer and PO key (`po_key`), so a PO-only order
 * meets the numbered order that carries its PO, and one PO on two numbered orders is found. Read on
 * `ingest_staged_row_company_order_key_idx` and `ingest_staged_row_company_po_key_idx`, 90 keys a
 * statement. A plain string list compares order keys only.
 */
export async function otherFileHolders(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  candidateId: string,
  refs: readonly (OrderRef | string)[],
): Promise<Map<string, OtherHolder[]>> {
  const out = new Map<string, OtherHolder[]>();
  const mine = refs.map((r) => (typeof r === "string" ? { key: r, poKey: null, fy: "" } : r)).filter((r) => !isOwnOrderKey(r.key));
  if (mine.length === 0) return out;
  // The plant's other orders candidates first: usually none, and then no row is read at all.
  const others = await ctx.db
    .select({ id: ingestCandidate.id, state: ingestCandidate.state, createdAt: ingestCandidate.createdAt, fileName: ingestArtifact.fileName, sheetName: ingestBlock.sheetName })
    .from(ingestCandidate)
    .innerJoin(ingestArtifact, eq(ingestArtifact.id, ingestCandidate.artifactId))
    .innerJoin(ingestBlock, eq(ingestBlock.id, ingestCandidate.blockId))
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.target, "orders"),
        sql`${ingestCandidate.id} <> ${candidateId}`,
        notInArray(ingestCandidate.state, ["discarded", "merged"]),
      ),
    );
  if (others.length === 0) return out;
  const byId = new Map(others.map((o) => [o.id, o]));
  const R = ingestStagedRow;
  const live = sql`(${R.mergeState} = 'written' or (${R.matchId} is null and ${R.state} in ('ready_create', 'ambiguous', 'conflict')))`;
  const pick = {
    key: R.orderKey,
    poKey: R.poKey,
    orderDate: sql<string | null>`json_extract(${R.values}, '$.orderDate')`,
    id: R.id,
    state: R.state,
    decision: R.decision,
    mergeState: R.mergeState,
    candidateId: R.candidateId,
  };
  type Hit = { key: string | null; poKey: string | null; orderDate: string | null; id: string; state: string; decision: string | null; mergeState: string; candidateId: string };
  const byKey = await mapInChunks([...new Set(mine.map((m) => m.key))], (part) =>
    ctx.db
      .select(pick)
      .from(R)
      .where(and(eq(R.companyId, ctx.companyId), inArray(R.orderKey, part), sql`${R.candidateId} <> ${candidateId}`, live)),
  );
  const poKeys = [...new Set(mine.map((m) => m.poKey).filter((x): x is string => !!x))];
  const byPo: Hit[] = poKeys.length
    ? await mapInChunks(poKeys, (part) =>
        ctx.db
          .select(pick)
          .from(R)
          .where(and(eq(R.companyId, ctx.companyId), inArray(R.poKey, part), sql`${R.candidateId} <> ${candidateId}`, live)),
      )
    : [];
  // The other orders a PO led to, each with the year of its rows, then all of their rows: a line
  // with a blank PO belongs to its order too.
  const otherFy = new Map<string, (string | null)[]>();
  for (const h of byPo) if (h.key && byId.has(h.candidateId)) otherFy.set(`${h.candidateId}${SEP}${h.key}`, [...(otherFy.get(`${h.candidateId}${SEP}${h.key}`) ?? []), h.orderDate]);
  const mineKeys = new Set(mine.map((m) => m.key));
  const moreKeys = [...new Set(byPo.map((h) => h.key).filter((k): k is string => !!k && !mineKeys.has(k)))];
  const more: Hit[] = moreKeys.length
    ? await mapInChunks(moreKeys, (part) =>
        ctx.db
          .select(pick)
          .from(R)
          .where(and(eq(R.companyId, ctx.companyId), inArray(R.orderKey, part), sql`${R.candidateId} <> ${candidateId}`, live)),
      )
    : [];
  // Each other order (candidate and key) with its rows, found by its key and by each PO key.
  const rowsOf = new Map<string, { cid: string; otherKey: string; hits: Hit[] }>();
  const atsByKey = new Map<string, Set<string>>();
  const atsByPo = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const h of [...byKey, ...byPo, ...more]) {
    if (!h.key || !byId.has(h.candidateId) || seen.has(h.id)) continue;
    seen.add(h.id);
    const at = `${h.candidateId}${SEP}${h.key}`;
    const e = rowsOf.get(at) ?? { cid: h.candidateId, otherKey: h.key, hits: [] };
    e.hits.push(h);
    rowsOf.set(at, e);
    atsByKey.set(h.key, (atsByKey.get(h.key) ?? new Set()).add(at));
    if (h.poKey) atsByPo.set(h.poKey, (atsByPo.get(h.poKey) ?? new Set()).add(at));
  }
  for (const m of mine) {
    const found = new Map<string, OtherHolder>();
    const ats = new Set([...(atsByKey.get(m.key) ?? []), ...(m.poKey ? (atsByPo.get(m.poKey) ?? []) : [])]);
    for (const at of ats) {
      const { cid, otherKey, hits } = rowsOf.get(at)!;
      const why: "order" | "po" = otherKey === m.key ? "order" : poRelation(m, { key: otherKey, fy: groupFyOf(otherFy.get(at) ?? []) });
      const o = byId.get(cid)!;
      found.set(at, {
        key: m.key,
        candidateId: o.id,
        candidateState: o.state,
        createdAt: o.createdAt,
        fileName: o.fileName,
        sheetName: o.sheetName,
        why,
        otherKey,
        rows: hits.map((h) => ({ id: h.id, state: h.state, decision: h.decision, written: h.mergeState === "written" })),
      });
    }
    // The same order first, then another order with the same PO.
    if (found.size) out.set(m.key, [...found.values()].sort((a, b) => (a.why === b.why ? 0 : a.why === "order" ? -1 : 1)));
  }
  return out;
}

/** Whether candidate `a` comes before `b` (older first, then by id): the later one is held. */
export function comesBefore(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): boolean {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  return d !== 0 ? d < 0 : a.id < b.id;
}

/** The file and sheet of another candidate, as the words name it: "book.xlsx (Old dies)". */
export const fileAndSheet = (h: { fileName: string; sheetName: string | null }) => `${h.fileName}${h.sheetName ? ` (${h.sheetName})` : ""}`;

/** The plain words for "this old order is also in that file". */
export function otherFileWords(label: string, h: Pick<OtherHolder, "fileName" | "sheetName">): string {
  return `${label} is also in ${fileAndSheet(h)}. Skip its rows in one of the two, or discard one of them.`;
}

/** The plain words for "this order's PO is on another old order in that file". */
export function otherPoWords(label: string, poText: string, h: Pick<OtherHolder, "fileName" | "sheetName">): string {
  return `PO ${poText} of ${label.replace(/^Old order/, "old order")} is also on another order in ${fileAndSheet(h)}. One PO can be on one order only. Skip the rows of one of them, or discard one of the sheets.`;
}
