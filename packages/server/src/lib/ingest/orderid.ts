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

import { ingestArtifact, ingestBlock, ingestCandidate, ingestStagedRow } from "@orrn/db/schema/ingest";
import { salesOrder } from "@orrn/db/schema/sales";

import { chunk, mapInChunks } from "../atomic";
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

/**
 * Old orders of one sheet with the same customer and PO under different keys: two order numbers, or
 * an order number and an order known only by its PO (S3-1). The order screens take a PO once per
 * customer, so only the first of them can be written: each later one is refused (dry run) or holds
 * the candidate (planner), by its key.
 */
export function poTwiceCheck(groups: readonly { key: string; list: readonly OrderGroupRow[] }[]): Map<string, OrderCheck> {
  const out = new Map<string, OrderCheck>();
  const first = new Map<string, string>();
  const sorted = [...groups].sort((a, b) => Math.min(...a.list.map((r) => r.rowIndex)) - Math.min(...b.list.map((r) => r.rowIndex)));
  for (const g of sorted) {
    const k = parseOrderKey(g.key);
    const po = orderPoOf(g.list);
    if (k.kind === "row" || !po.po || !k.customer) continue;
    const at = `${k.customer}${SEP}${po.po}`;
    const prev = first.get(at);
    if (prev === undefined) {
      first.set(at, orderLabel(g.list));
      continue;
    }
    out.set(g.key, {
      code: "po_on_two_orders",
      field: "poNumber",
      message: `PO ${po.poText} is on ${prev} and on ${orderLabel(g.list).replace(/^Old order/, "old order")} in the file. One PO can be on one order only. Fix the file or skip rows.`,
    });
  }
  return out;
}

/**
 * Which old order each row of one sheet belongs to, decided over the whole sheet, not row by row
 * (S3-1). A row with no order number but a PO first gets a customer-and-PO key. When the sheet has
 * exactly one numbered order of the same customer with a row carrying that PO, the row is a line of
 * that order (`remap`, from key to key). When it has several, the row cannot be placed: it is
 * refused with `order_no_unclear` (`unclear`). When it has none, the customer and PO are the
 * order, as in a sheet with no order number column.
 */
export function sheetOrderKeys(groups: readonly { key: string; pos: readonly (string | null)[] }[]): { remap: Map<string, string>; unclear: Set<string> } {
  // Numbered orders by customer and each PO any of their rows carries.
  const numbered = new Map<string, Set<string>>();
  for (const g of groups) {
    const k = parseOrderKey(g.key);
    if (k.kind !== "no" || !k.customer) continue;
    for (const po of g.pos) {
      const p = normPo(po);
      if (!p) continue;
      const at = `${k.customer}${SEP}${p}`;
      const set = numbered.get(at) ?? new Set<string>();
      set.add(g.key);
      numbered.set(at, set);
    }
  }
  const remap = new Map<string, string>();
  const unclear = new Set<string>();
  for (const g of groups) {
    const k = parseOrderKey(g.key);
    if (k.kind !== "po" || !k.customer || !k.po) continue;
    const hits = numbered.get(`${k.customer}${SEP}${k.po}`);
    if (!hits || hits.size === 0) continue;
    if (hits.size === 1) remap.set(g.key, [...hits][0]!);
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

export type LiveOrder = { id: string; number: string; requestId: string | null; status: string; by: "no" | "po" };

/** What one live lookup needs: a live customer id (never `new:`), the year, the number and the PO. */
export type LiveLookup = { key: string; customerId: string; fy: string; no: string | null; po: string | null };

/**
 * The live order each old order already is (rule 1, against live data):
 * - by number: the same customer, the same financial year, a note that names the number, and not
 *   closed or cancelled;
 * - else by PO: the same customer and PO, not cancelled (the order screens refuse a PO twice).
 * Reads only the customers and years asked about, and the (customer, PO) pairs asked about.
 */
export async function liveOrdersOf(ctx: Pick<IngestCtx, "db" | "companyId">, lookups: readonly LiveLookup[]): Promise<Map<string, LiveOrder>> {
  const out = new Map<string, LiveOrder>();
  const real = lookups.filter((l) => l.customerId && !l.customerId.startsWith("new:") && !l.customerId.startsWith("pending:"));
  if (real.length === 0) return out;
  const byNo = new Map<string, LiveOrder>();
  const withNo = real.filter((l) => l.no && fyRange(l.fy));
  if (withNo.length) {
    const fys = [...new Set(withNo.map((l) => l.fy))].sort();
    const from = fyRange(fys[0]!)!.from;
    const to = fyRange(fys.at(-1)!)!.to;
    const rows = await mapInChunks([...new Set(withNo.map((l) => l.customerId))], (part) =>
      ctx.db
        .select({ id: salesOrder.id, customerId: salesOrder.customerId, number: salesOrder.number, requestId: salesOrder.clientRequestId, status: salesOrder.status, orderDate: salesOrder.orderDate, note: salesOrder.note })
        .from(salesOrder)
        .where(
          and(
            eq(salesOrder.companyId, ctx.companyId),
            inArray(salesOrder.customerId, part),
            notInArray(salesOrder.status, ["closed", "cancelled"]),
            sql`${salesOrder.orderDate} between ${from} and ${to}`,
            sql`${salesOrder.note} like 'Old order no. %'`,
          ),
        ),
    );
    for (const o of rows) {
      for (const no of noteOrderNos(o.note)) {
        const k = [o.customerId, orderFyOf(o.orderDate), no].join(SEP);
        if (!byNo.has(k)) byNo.set(k, { id: o.id, number: o.number, requestId: o.requestId, status: o.status, by: "no" });
      }
    }
  }
  const byPo = new Map<string, LiveOrder>();
  const pairs = [...new Map(real.filter((l) => l.po).map((l) => [`${l.customerId}${SEP}${l.po}`, { customerId: l.customerId, po: l.po! }])).values()];
  // Two bound values a pair, plus the company: 45 pairs a statement.
  for (const part of chunk(pairs, 45)) {
    const rows = await ctx.db
      .select({ id: salesOrder.id, customerId: salesOrder.customerId, number: salesOrder.number, requestId: salesOrder.clientRequestId, status: salesOrder.status, po: sql<string>`lower(trim(${salesOrder.poNumber}))` })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.companyId, ctx.companyId),
          sql`(${salesOrder.customerId}, lower(trim(${salesOrder.poNumber}))) in (values ${sql.join(
            part.map((p) => sql`(${p.customerId}, ${p.po})`),
            sql`, `,
          )})`,
          sql`${salesOrder.status} <> 'cancelled'`,
        ),
      );
    for (const o of rows) {
      const k = `${o.customerId}${SEP}${o.po}`;
      if (!byPo.has(k)) byPo.set(k, { id: o.id, number: o.number, requestId: o.requestId, status: o.status, by: "po" });
    }
  }
  for (const l of real) {
    const hit = (l.no ? byNo.get([l.customerId, l.fy, l.no].join(SEP)) : undefined) ?? (l.po ? byPo.get(`${l.customerId}${SEP}${l.po}`) : undefined);
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
  /** Rows of the other candidate with this key that would write the order, or wrote it. */
  rows: { id: string; state: string; decision: string | null; written: boolean }[];
};

/**
 * Other orders candidates of the plant that hold rows of these old orders (rule 1, across files):
 * not discarded, not fully merged (with `withMerged`, merged ones count too, for the planner), and
 * with a row that would make the order (ready, waiting on a person, in conflict) or already made it.
 * Read on `ingest_staged_row_company_order_key_idx`, 90 keys a statement.
 */
export async function otherFileHolders(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  candidateId: string,
  keys: readonly string[],
  opts: { withMerged?: boolean } = {},
): Promise<Map<string, OtherHolder[]>> {
  const out = new Map<string, OtherHolder[]>();
  const wanted = [...new Set(keys)].filter((k) => !isOwnOrderKey(k));
  if (wanted.length === 0) return out;
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
        notInArray(ingestCandidate.state, opts.withMerged ? ["discarded"] : ["discarded", "merged"]),
      ),
    );
  if (others.length === 0) return out;
  const byId = new Map(others.map((o) => [o.id, o]));
  const R = ingestStagedRow;
  const rows = await mapInChunks(wanted, (part) =>
    ctx.db
      .select({ key: R.orderKey, id: R.id, state: R.state, decision: R.decision, mergeState: R.mergeState, candidateId: R.candidateId })
      .from(R)
      .where(
        and(
          eq(R.companyId, ctx.companyId),
          inArray(R.orderKey, part),
          sql`${R.candidateId} <> ${candidateId}`,
          sql`(${R.mergeState} = 'written' or (${R.matchId} is null and ${R.state} in ('ready_create', 'ambiguous', 'conflict')))`,
        ),
      ),
  );
  const byKey = new Map<string, Map<string, OtherHolder>>();
  for (const r of rows) {
    const o = byId.get(r.candidateId);
    if (!r.key || !o) continue;
    const m = byKey.get(r.key) ?? new Map<string, OtherHolder>();
    byKey.set(r.key, m);
    const h = m.get(o.id) ?? { key: r.key, candidateId: o.id, candidateState: o.state, createdAt: o.createdAt, fileName: o.fileName, sheetName: o.sheetName, rows: [] };
    m.set(o.id, h);
    h.rows.push({ id: r.id, state: r.state, decision: r.decision, written: r.mergeState === "written" });
  }
  for (const [k, m] of byKey) out.set(k, [...m.values()]);
  return out;
}

/** Whether candidate `a` comes before `b` (older first, then by id): the later one is held. */
export function comesBefore(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): boolean {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  return d !== 0 ? d < 0 : a.id < b.id;
}

/** The plain words for "this old order is also in that file". */
export function otherFileWords(label: string, h: Pick<OtherHolder, "fileName" | "sheetName">): string {
  return `${label} is also in ${h.fileName}${h.sheetName ? ` (${h.sheetName})` : ""}. Skip its rows in one of the two, or discard one of them.`;
}
