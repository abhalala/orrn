import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import {
  addPlanLine,
  blockerText,
  copyChoiceInput,
  blockersFromMessage,
  defaultWindow,
  dieTitle,
  fromLocalInput,
  isMovable,
  lengthMismatches,
  movePlanDie,
  addPlanLines,
  draftCounts,
  draftGroups,
  draftOrderCount,
  soLines,
  parseBlocker,
  poRepeatFromMessage,
  reallocateProblem,
  removePlanLine,
  statusActions,
  stripCells,
  timelineLabel,
  toLocalInput,
  toggleUrgent,
  windowState,
  type DraftDie,
  type Strip,
} from "./view";

const strip: Strip = {
  orderedG: 480_000,
  orderedPcs: 200,
  plannedG: 0,
  pressedG: 0,
  agedG: 0,
  packedG: 105_895,
  inStockG: 105_895,
  dispatchedG: 0,
  bakiG: 480_000,
  bakiPcs: 200,
  overG: 0,
};

describe("stripCells", () => {
  test("eight figures in the plant's order, kg to the gram, pieces only where the server gave them", () => {
    const cells = stripCells(strip);
    expect(cells.map((c) => c.key)).toEqual(["orderedG", "plannedG", "pressedG", "agedG", "packedG", "inStockG", "dispatchedG", "bakiG"]);
    expect(cells[0]).toMatchObject({ kg: "480.000", pcs: "200", open: false });
    expect(cells[4]).toMatchObject({ kg: "105.895", pcs: null });
    expect(cells[7]).toMatchObject({ kg: "480.000", pcs: "200", open: true });
  });

  test("a settled baki is not flagged open", () => {
    const done = stripCells({ ...strip, bakiG: 0, bakiPcs: 0 });
    expect(done[7]).toMatchObject({ kg: "0.000", pcs: "0", open: false });
  });
});

describe("confirm blockers", () => {
  test("codes are read into the sentence's parts", () => {
    expect(parseBlocker("po_number")).toEqual({ kind: "po_number" });
    expect(parseBlocker("no_lines")).toEqual({ kind: "no_lines" });
    expect(parseBlocker("line_2_die_or_tier")).toEqual({ kind: "line", n: 2, problem: "die_or_tier" });
    expect(parseBlocker("line_1_pcs")).toEqual({ kind: "line", n: 1, problem: "pcs" });
    expect(parseBlocker("line_1_weird")).toEqual({ kind: "unknown", code: "line_1_weird" });
  });

  test("worded in English and Hindi", () => {
    const en = createI18n("en").t;
    expect(blockerText("po_number", en)).toBe("Add the PO number.");
    expect(blockerText("line_3_length", en)).toBe("Line 3: add the cut length");
    expect(blockerText("no_lines", en)).toBe("Add at least one line.");
    const hi = createI18n("hi").t;
    expect(blockerText("po_number", hi)).toBe("PO नंबर डालें।");
    expect(blockerText("line_1_kg", hi)).toContain("लाइन 1");
    // A code this screen does not know is marked as the server's (review m-8).
    expect(blockerText("line_1_weird", en)).toBe("line_1_weird");
    expect(blockerText("line_1_weird", hi)).toBe("सर्वर का जवाब: line_1_weird");
  });

  test("the server refusal text yields its codes", () => {
    expect(blockersFromMessage("Fill these before confirming: po_number, line_1_pcs, line_2_die_or_tier")).toEqual([
      "po_number",
      "line_1_pcs",
      "line_2_die_or_tier",
    ]);
    expect(blockersFromMessage("Order not found")).toEqual([]);
    expect(blockersFromMessage(undefined)).toEqual([]);
  });

  test("a repeated PO is recognised", () => {
    expect(poRepeatFromMessage("PO PO-4471 is already on SO-1 for this customer")).toEqual({ po: "PO-4471", code: "SO-1" });
    expect(poRepeatFromMessage("Something else")).toBeNull();
  });
});

describe("statusActions", () => {
  test("which buttons each status offers", () => {
    expect(statusActions("booking")).toEqual({ edit: true, confirm: true, close: false, cancel: true, move: true });
    expect(statusActions("confirmed")).toEqual({ edit: true, confirm: false, close: true, cancel: true, move: true });
    expect(statusActions("dispatching")).toEqual({ edit: false, confirm: false, close: true, cancel: false, move: true });
    expect(statusActions("closed")).toEqual({ edit: false, confirm: false, close: false, cancel: false, move: false });
  });
});

describe("reallocate checks", () => {
  const bundles = [
    { id: "a", status: "available", lengthMm: 3658 },
    { id: "b", status: "available", lengthMm: 5486 },
    { id: "c", status: "dispatched", lengthMm: 3658 },
  ];

  test("only available, unmoved bundles move", () => {
    expect(bundles.map(isMovable)).toEqual([true, true, false]);
    expect(isMovable({ status: "available", movedAway: true })).toBe(false);
  });

  test("length mismatch lists the selected bundles of another length", () => {
    expect(lengthMismatches(bundles, new Set(["a", "b"]), 3658)).toEqual(["b"]);
    expect(lengthMismatches(bundles, new Set(["a"]), 3658)).toEqual([]);
    expect(lengthMismatches(bundles, new Set(["a", "b"]), null)).toEqual([]);
  });

  test("what the sheet asks for before Move", () => {
    const base = { selected: 2, max: 100, mismatch: false, reasonCode: "", note: "" };
    expect(reallocateProblem({ ...base, selected: 0 })).toBe("reallocate.pickBundles");
    expect(reallocateProblem({ ...base, selected: 101 })).toBe("reallocate.tooMany");
    expect(reallocateProblem(base)).toBe("reallocate.reasonNeeded");
    expect(reallocateProblem({ ...base, note: "wrong order" })).toBeNull();
    expect(reallocateProblem({ ...base, reasonCode: "customer_request" })).toBeNull();
    expect(reallocateProblem({ ...base, mismatch: true, note: "x" })).toBe("reallocate.lengthMismatch");
    expect(reallocateProblem({ ...base, mismatch: true, reasonCode: "length_mismatch" })).toBeNull();
    expect(reallocateProblem({ ...base, reasonCode: "other" })).toBe("common.noteRequired");
    expect(reallocateProblem({ ...base, reasonCode: "other", note: "why" })).toBeNull();
  });
});

describe("timelineLabel", () => {
  test("a reallocation reads by its status", () => {
    expect(timelineLabel({ action: "order.reallocate", meta: { status: "pending", bundles: 2, kgG: 105_895 } })).toEqual({
      key: "orders.timeline.reallocatePending",
      vars: { count: 2, kg: "105.895" },
    });
    expect(timelineLabel({ action: "order.reallocate", meta: { status: "applied", bundles: 1, kgG: 5 } }).key).toBe("orders.timeline.reallocateApplied");
  });

  test("a plan names its number; an unknown action is shown as is", () => {
    expect(timelineLabel({ action: "plan.release", meta: { number: "PP-3" } })).toEqual({ key: "orders.timeline.planRelease", vars: { number: "PP-3" } });
    expect(timelineLabel({ action: "plan.update", meta: { number: "PP-3" } })).toEqual({ key: "orders.timeline.planUpdate", vars: { number: "PP-3" } });
    expect(timelineLabel({ action: "mystery.thing", meta: null })).toEqual({ key: "orders.timeline.other", vars: { action: "mystery.thing" } });
  });
});

describe("plan draft", () => {
  const d = (sectionId: string, ...lineIds: string[]): DraftDie => ({ sectionId, urgent: false, lineIds });

  test("lines group under their die; a die with no lines leaves the draft", () => {
    let draft: DraftDie[] = [];
    draft = addPlanLine(draft, "s1", "l1");
    draft = addPlanLine(draft, "s2", "l2");
    draft = addPlanLine(draft, "s1", "l3");
    draft = addPlanLine(draft, "s1", "l3");
    expect(draft).toEqual([d("s1", "l1", "l3"), d("s2", "l2")]);
    draft = removePlanLine(draft, "s2", "l2");
    expect(draft).toEqual([d("s1", "l1", "l3")]);
  });

  test("move earlier and later stay inside the list", () => {
    const draft = [d("a", "1"), d("b", "2"), d("c", "3")];
    expect(movePlanDie(draft, "c", -1).map((x) => x.sectionId)).toEqual(["a", "c", "b"]);
    expect(movePlanDie(draft, "a", -1).map((x) => x.sectionId)).toEqual(["a", "b", "c"]);
    expect(movePlanDie(draft, "c", 1).map((x) => x.sectionId)).toEqual(["a", "b", "c"]);
  });

  test("urgent goes ahead of the calm dies and stays behind earlier urgent ones", () => {
    let draft = [d("a", "1"), d("b", "2"), d("c", "3")];
    draft = toggleUrgent(draft, "c");
    expect(draft.map((x) => [x.sectionId, x.urgent])).toEqual([["c", true], ["a", false], ["b", false]]);
    draft = toggleUrgent(draft, "b");
    expect(draft.map((x) => x.sectionId)).toEqual(["c", "b", "a"]);
    draft = toggleUrgent(draft, "c");
    expect(draft.map((x) => [x.sectionId, x.urgent])).toEqual([["c", false], ["b", true], ["a", false]]);
  });

  test("add all of one SO puts each of its lines under its own die (review I-6)", () => {
    const open = [
      { sectionId: "s1", lines: [{ lineId: "l1", orderId: "o1" }, { lineId: "l2", orderId: "o2" }] },
      { sectionId: "s2", lines: [{ lineId: "l3", orderId: "o1" }] },
    ];
    expect(soLines(open, "o1")).toEqual([
      { sectionId: "s1", lineId: "l1" },
      { sectionId: "s2", lineId: "l3" },
    ]);
    const draft = addPlanLines([d("s1", "l9")], soLines(open, "o1"));
    expect(draft).toEqual([d("s1", "l9", "l1"), d("s2", "l3")]);
    // Adding again changes nothing.
    expect(addPlanLines(draft, soLines(open, "o1"))).toEqual(draft);
  });

  test("the draft footer counts dies and lines", () => {
    expect(draftCounts([])).toEqual({ dies: 0, lines: 0 });
    expect(draftCounts([d("s1", "l1", "l2"), d("s2", "l3")])).toEqual({ dies: 2, lines: 3 });
  });
});

describe("plan window", () => {
  test("at most 24 hours, end after start", () => {
    const h = 3_600_000;
    expect(windowState(0, 24 * h)).toBe("ok");
    expect(windowState(0, 24 * h + 1)).toBe("long");
    expect(windowState(5, 5)).toBe("order");
    expect(windowState(10, 5)).toBe("order");
  });

  test("the default window starts on the next whole hour and runs 24 hours", () => {
    const now = Date.UTC(2026, 9, 24, 14, 20);
    const w = defaultWindow(now);
    expect(w.start).toBe(Date.UTC(2026, 9, 24, 15, 0));
    expect(w.end - w.start).toBe(24 * 3_600_000);
    expect(defaultWindow(Date.UTC(2026, 9, 24, 15, 0)).start).toBe(Date.UTC(2026, 9, 24, 15, 0));
  });

  test("datetime-local text round-trips", () => {
    const ms = new Date(2026, 9, 24, 20, 0).getTime();
    expect(toLocalInput(ms)).toBe("2026-10-24T20:00");
    expect(fromLocalInput("2026-10-24T20:00")).toBe(ms);
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-10-24")).toBeNull();
  });
});

describe("dieTitle", () => {
  test("code and name, else code and series", () => {
    expect(dieTitle({ sectionCode: "14701", name: 'Patti 1" x 1/8"', series: "PATTI" })).toBe('14701 Patti 1" x 1/8"');
    expect(dieTitle({ sectionCode: "14701", name: " ", series: "PATTI" })).toBe("14701 PATTI");
    expect(dieTitle({ sectionCode: "14701", sectionName: null, series: "" })).toBe("14701");
  });
});

describe("copyChoiceInput", () => {
  test("a choice is a pinned copy, a tier, or nothing", () => {
    expect(copyChoiceInput("any")).toEqual({ dieInstanceId: null, tierRank: null });
    expect(copyChoiceInput("copy:abc")).toEqual({ dieInstanceId: "abc", tierRank: null });
    expect(copyChoiceInput("tier:2")).toEqual({ dieInstanceId: null, tierRank: 2 });
    expect(copyChoiceInput("tier:x")).toEqual({ dieInstanceId: null, tierRank: null });
  });
});

describe("the draft in three views (FP-OP-11)", () => {
  const draft: DraftDie[] = [
    { sectionId: "d1", urgent: false, lineIds: ["l1", "l3"] },
    { sectionId: "d2", urgent: true, lineIds: ["l2"] },
  ];
  const order: Record<string, string> = { l1: "SO-1", l2: "SO-2", l3: "SO-2" };
  const orderOf = (id: string) => order[id];

  test("by die keeps the run order of the dies", () => {
    const g = draftGroups(draft, "die", orderOf);
    expect(g.map((x) => [x.key, x.lines.map((l) => l.lineId)])).toEqual([
      ["d1", ["l1", "l3"]],
      ["d2", ["l2"]],
    ]);
  });

  test("by order groups every line of a sales order together, orders in the order they first appear", () => {
    const g = draftGroups(draft, "order", orderOf);
    expect(g.map((x) => [x.orderNumber, x.lines.map((l) => `${l.sectionId}:${l.lineId}`)])).toEqual([
      ["SO-1", ["d1:l1"]],
      ["SO-2", ["d1:l3", "d2:l2"]],
    ]);
  });

  test("flat is one list in run order, and an empty draft has no groups", () => {
    const g = draftGroups(draft, "flat", orderOf);
    expect(g).toHaveLength(1);
    expect(g[0]!.lines.map((l) => l.lineId)).toEqual(["l1", "l3", "l2"]);
    expect(draftGroups([], "flat", orderOf)).toEqual([]);
    expect(draftGroups([], "order", orderOf)).toEqual([]);
  });

  test("the footer counts orders, dies and lines", () => {
    expect(draftOrderCount(draft, orderOf)).toBe(2);
    expect(draftCounts(draft)).toEqual({ dies: 2, lines: 3 });
  });
});

describe("in stock with its bundle count (FP-OP-05)", () => {
  test("the in-stock cell carries the pieces and bundles; other cells do not", () => {
    const cells = stripCells({ ...strip, inStockG: 100_000, inStockPcs: 50, inStockBundles: 1 });
    expect(cells[5]).toMatchObject({ key: "inStockG", kg: "100.000", pcs: "50", bundles: 1 });
    expect(cells[4]).toMatchObject({ bundles: null });
    expect(stripCells(strip)[5]).toMatchObject({ pcs: null, bundles: null });
  });
});
