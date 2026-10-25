/**
 * Dispatch from a sales order (FP-PK-17, BACKLOG 37). A dispatch opened from an order (`dispatch.
 * salesOrderId`) has that order's party. Two reads live here:
 *
 * - `orderProgress`: the order's live baki against what is on this dispatch, line by line, for the
 *   scan screen ("baki 2,400 kg, 1,800 kg after this load"). Baki is the order's own
 *   (ordered - dispatched by completed dispatches); `onDispatch` is what this draft carries on the
 *   order's lines; `left` = max(0, baki - on dispatch), per line, so one line over never hides
 *   another's baki.
 * - `suggestBundles`: the bundles worth adding, the order's own first (in the yard on its lines, or
 *   held for them), then plant stock of the same die and cut length. Every candidate is run through
 *   the SAME classifier as a scan (`classifyBundles`), so a bundle that a scan would refuse (held by
 *   another dispatch, held for another customer, unassigned, another customer's, owned die, pending
 *   reallocation) is never offered. Bundles held for a line of ANOTHER order are left out too, even
 *   of the same party (the hold says who they are for).
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { die } from "@orrn/db/schema/catalog";
import { dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";

import { chunk, mapInChunks, type OrrnDb } from "./atomic";
import { lineBalances, type LineBalance } from "./orders";
import { classifyBundles, type ScanBundle } from "./scan";

export type OrderProgressLine = {
  lineId: string;
  lineNo: number;
  sectionCode: string;
  cutLengthMm: number;
  orderedG: number;
  bakiG: number;
  onDispatchG: number;
  onDispatchPcs: number;
  /** max(0, baki - on this dispatch). */
  leftG: number;
  /** On this dispatch beyond the line's baki. */
  overG: number;
};

export type OrderProgress = {
  orderedG: number;
  orderedPcs: number | null;
  bakiG: number;
  bakiPcs: number | null;
  onDispatchG: number;
  onDispatchPcs: number;
  leftG: number;
  leftPcs: number | null;
  overG: number;
  lines: OrderProgressLine[];
};

export type ItemOnDispatch = { salesOrderLineId: string | null; weightG: number; quantity: number };

/** The order's live baki against the items on this dispatch. `lines` are the order's line balances. */
export function orderProgress(lines: readonly LineBalance[], items: readonly ItemOnDispatch[]): OrderProgress {
  const on = new Map<string, { g: number; pcs: number }>();
  for (const it of items) {
    if (!it.salesOrderLineId) continue;
    const cur = on.get(it.salesOrderLineId) ?? { g: 0, pcs: 0 };
    cur.g += it.weightG;
    cur.pcs += it.quantity;
    on.set(it.salesOrderLineId, cur);
  }
  const out: OrderProgressLine[] = lines.map((l) => {
    const mine = on.get(l.lineId) ?? { g: 0, pcs: 0 };
    return {
      lineId: l.lineId,
      lineNo: l.lineNo,
      sectionCode: l.sectionCode,
      cutLengthMm: l.cutLengthMm,
      orderedG: l.orderedG,
      bakiG: l.bakiG,
      onDispatchG: mine.g,
      onDispatchPcs: mine.pcs,
      leftG: Math.max(0, l.bakiG - mine.g),
      overG: Math.max(0, mine.g - l.bakiG),
    };
  });
  const allPcs = lines.every((l) => l.orderedPcs != null);
  return {
    orderedG: lines.reduce((s, l) => s + l.orderedG, 0),
    orderedPcs: allPcs ? lines.reduce((s, l) => s + (l.orderedPcs ?? 0), 0) : null,
    bakiG: lines.reduce((s, l) => s + l.bakiG, 0),
    bakiPcs: allPcs ? lines.reduce((s, l) => s + (l.bakiPcs ?? 0), 0) : null,
    onDispatchG: out.reduce((s, l) => s + l.onDispatchG, 0),
    onDispatchPcs: out.reduce((s, l) => s + l.onDispatchPcs, 0),
    leftG: out.reduce((s, l) => s + l.leftG, 0),
    // Pieces left follow the kg left line by line when the line has pieces (never negative).
    leftPcs: allPcs
      ? lines.reduce((s, l) => {
          const mine = on.get(l.lineId)?.pcs ?? 0;
          return s + Math.max(0, (l.bakiPcs ?? 0) - mine);
        }, 0)
      : null,
    overG: out.reduce((s, l) => s + l.overG, 0),
    lines: out,
  };
}

export type SuggestedBundle = {
  id: string;
  serial: string;
  partyNo: string | null;
  group: "order" | "plant";
  dieId: string;
  sectionCode: string;
  series: string;
  sectionName: string | null;
  lengthMm: number;
  pcs: number;
  weightG: number;
  /** The order line it would go to. */
  lineId: string;
  lineNo: number;
  /** Within the line's baki left (greedy, in this order); false = it would run past the order. */
  fits: boolean;
  /** Held for that line in the yard (FP-OP-17). */
  held: boolean;
  packedAt: number;
};

export const SUGGEST_MAX = 500;

const CANDIDATE_CAP = 1_000;

export async function suggestBundlesFor(
  db: OrrnDb,
  companyId: string,
  d: { id: string; customerId: string; salesOrderId: string },
  opts: { limit: number },
): Promise<{
  items: SuggestedBundle[];
  progress: OrderProgress;
  counts: { order: number; plant: number; fits: number };
  fitsG: number;
  truncated: boolean;
}> {
  const lines = await lineBalances(db, companyId, { orderId: d.salesOrderId });
  const onDispatch = await mapInChunks([d.id], (ids) =>
    db
      .select({ bundleId: dispatchItem.bundleId, lineId: dispatchItem.salesOrderLineId, weightG: bundle.weightG, quantity: bundle.quantity })
      .from(dispatchItem)
      .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
      .where(and(eq(dispatchItem.companyId, companyId), inArray(dispatchItem.dispatchId, ids))),
  );
  const progress = orderProgress(
    lines,
    onDispatch.map((i) => ({ salesOrderLineId: i.lineId, weightG: i.weightG, quantity: i.quantity })),
  );
  const empty = { items: [], progress, counts: { order: 0, plant: 0, fits: 0 }, fitsG: 0, truncated: false };
  const openLines = lines.filter((l) => l.bakiG > 0);
  if (lines.length === 0) return empty;

  const lineIds = lines.map((l) => l.lineId);
  const lineById = new Map(lines.map((l) => [l.lineId, l]));
  const taken = new Set(onDispatch.map((i) => i.bundleId));

  // A candidate read that hit CANDIDATE_CAP may have left bundles out: say so (`truncated`, review m-9).
  let capped = false;
  // A: the order's own bundles in the yard (on its lines, or held for them).
  const own: ScanBundle[] = [];
  for (const part of chunk(lineIds, 40)) {
    const rows = await db
      .select()
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, companyId),
          eq(bundle.status, "available"),
          or(inArray(bundle.salesOrderLineId, part), inArray(bundle.heldForLineId, part)),
        ),
      )
      .orderBy(asc(bundle.createdAt), asc(bundle.serial))
      .limit(CANDIDATE_CAP);
    if (rows.length >= CANDIDATE_CAP) capped = true;
    own.push(...rows);
  }

  // B: plant stock of a die + cut length the order still wants.
  const wanted = new Map<string, { dieId: string; lengthMm: number }>();
  for (const l of openLines) wanted.set(`${l.sectionId}|${l.cutLengthMm}`, { dieId: l.sectionId, lengthMm: l.cutLengthMm });
  const plant: ScanBundle[] = [];
  for (const part of chunk([...wanted.values()], 30)) {
    const rows = await db
      .select()
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, companyId),
          eq(bundle.status, "available"),
          isNull(bundle.salesOrderLineId),
          isNull(bundle.heldForLineId),
          or(...part.map((w) => and(eq(bundle.dieId, w.dieId), eq(bundle.lengthMm, w.lengthMm)))),
        ),
      )
      .orderBy(asc(bundle.createdAt), asc(bundle.serial))
      .limit(CANDIDATE_CAP);
    if (rows.length >= CANDIDATE_CAP) capped = true;
    plant.push(...rows);
  }

  const ownSet = new Set(lineIds);
  const candidates = new Map<string, { b: ScanBundle; group: "order" | "plant" }>();
  for (const b of own) {
    if (taken.has(b.id)) continue;
    // Held for a line of another order: not this order's, whatever line it lies on.
    if (b.heldForLineId && !ownSet.has(b.heldForLineId)) continue;
    // On another order's line but held for one of ours is still ours; on our line is ours.
    candidates.set(b.id, { b, group: "order" });
  }
  for (const b of plant) {
    if (taken.has(b.id) || candidates.has(b.id)) continue;
    candidates.set(b.id, { b, group: "plant" });
  }
  if (candidates.size === 0) return empty;

  // The scan's own verdict: only bundles that would be "added" are offered.
  const found = new Map([...candidates.values()].map(({ b }) => [b.serial, b]));
  const { results, oneSo } = await classifyBundles(
    { db, companyId },
    { id: d.id, customerId: d.customerId, salesOrderId: d.salesOrderId },
    [...found.keys()],
    found,
    new Map(),
    // Legacy stock on no order line (never moved to plant stock) is not offered: adding it is a
    // deliberate act of the office (`allowUnassigned`), not a suggestion.
    { allowUnassigned: false },
  );
  const ok = new Set(results.filter((r) => r.outcome === "added").map((r) => r.bundleId));

  const sections = new Map(
    (
      await mapInChunks([...new Set([...candidates.values()].map(({ b }) => b.dieId))], (ids) =>
        db
          .select({ id: die.id, sectionCode: die.sectionCode, series: die.series, name: die.name })
          .from(die)
          .where(and(eq(die.companyId, companyId), inArray(die.id, ids))),
      )
    ).map((r) => [r.id, r]),
  );

  // The line each would go to, as the add will pick it (`suggestLines`, review r1 I-2): its own /
  // held line, else the order's line of the same die AND cut length with room left (greedy, in this
  // order), else that die + length's first line (it would run past the order).
  const lineOrder = new Map(lines.map((l, i) => [l.lineId, i]));
  const sameDieLength = (b: ScanBundle) => lines.filter((l) => l.sectionId === b.dieId && l.cutLengthMm === b.lengthMm);
  const placed = [...candidates.values()]
    .filter(({ b }) => ok.has(b.id))
    .map(({ b, group }) => {
      const lineId = group === "order" ? ((b.heldForLineId && ownSet.has(b.heldForLineId) ? b.heldForLineId : b.salesOrderLineId) as string | null) : null;
      const own = lineId ? lineById.get(lineId) : undefined;
      return { b, group, own, first: own ?? sameDieLength(b)[0] };
    })
    .filter((x) => x.first != null);
  placed.sort(
    (a, b) =>
      Number(b.group === "order") - Number(a.group === "order") ||
      (lineOrder.get(a.first!.lineId) ?? 0) - (lineOrder.get(b.first!.lineId) ?? 0) ||
      a.b.createdAt.getTime() - b.b.createdAt.getTime() ||
      a.b.serial.localeCompare(b.b.serial),
  );

  const left = new Map(progress.lines.map((l) => [l.lineId, l.leftG]));
  const items: SuggestedBundle[] = [];
  const counts = { order: 0, plant: 0, fits: 0 };
  let fitsG = 0;
  for (const { b, group, own } of placed) {
    const sec = sections.get(b.dieId);
    const target = own ?? sameDieLength(b).find((l) => (left.get(l.lineId) ?? 0) > 0) ?? sameDieLength(b)[0]!;
    const room = left.get(target.lineId) ?? 0;
    // Q37 one_so: plant stock past the order's room would be refused by the scan; not offered.
    if (oneSo && !own && room <= 0) continue;
    const fits = b.weightG <= room;
    if (fits) {
      left.set(target.lineId, room - b.weightG);
      counts.fits += 1;
      fitsG += b.weightG;
    }
    counts[group] += 1;
    items.push({
      id: b.id,
      serial: b.serial,
      partyNo: b.partyNo,
      group,
      dieId: b.dieId,
      sectionCode: sec?.sectionCode ?? "",
      series: sec?.series ?? "",
      sectionName: sec?.name ?? null,
      lengthMm: b.lengthMm,
      pcs: b.quantity,
      weightG: b.weightG,
      lineId: target.lineId,
      lineNo: target.lineNo,
      fits,
      held: b.heldForLineId != null,
      packedAt: b.createdAt.getTime(),
    });
  }
  const truncated = capped || items.length > opts.limit;
  return { items: items.slice(0, opts.limit), progress, counts, fitsG, truncated };
}
