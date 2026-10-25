import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import {
  holdableItems,
  addPlanLine,
  blockerText,
  copyChoiceInput,
  blockersFromMessage,
  dieTitle,
  fromZonedInput,
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
  toZonedInput,
  windowWords,
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

  test("BACKLOG 39: Packed says it counts bundles on a truck, so it never reads as the In stock figure (en and hi)", () => {
    const cells = stripCells(strip);
    const packed = cells.find((c) => c.key === "packedG")!;
    const inStock = cells.find((c) => c.key === "inStockG")!;
    for (const lang of ["en", "hi"] as const) {
      const t = createI18n(lang).t;
      expect(t(packed.labelKey)).not.toBe(t(inStock.labelKey));
    }
    expect(createI18n("en").t(packed.labelKey)).toBe("Packed (incl. on a truck)");
    expect(createI18n("en").t(inStock.labelKey)).toBe("In stock");
    expect(createI18n("hi").t(packed.labelKey)).toBe("पैक (गाड़ी पर रखे सहित)");
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
    // A code this screen does not know is never echoed: the generic line, in the person's language (BACKLOG 48).
    expect(blockerText("line_1_weird", en)).toBe(en("refusal.unknown"));
    expect(blockerText("line_1_weird", hi)).toBe(hi("refusal.unknown"));
    expect(blockerText("line_1_weird", createI18n("gu").t)).toBe(createI18n("gu").t("refusal.unknown"));
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
    // W4-MASTERS I-3: a plant code set to need a note in Masters asks for one too.
    expect(reallocateProblem({ ...base, reasonCode: "rush_order", requiresNote: true })).toBe("common.noteRequiredReason");
    expect(reallocateProblem({ ...base, reasonCode: "rush_order" })).toBeNull();
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

  test("BACKLOG 34: a move with the server's summary reads count, kg and from -> to (en and hi)", () => {
    const kd = { customerName: "KD Extrusion", orderNumber: "SO-1", lineNo: 1 };
    const toPlant = timelineLabel({ action: "order.reallocate", meta: { status: "applied" }, move: { count: 3, kgG: 57_000, from: [kd], to: null } });
    expect(toPlant).toEqual({ key: "orders.timeline.moveApplied", vars: { count: 3, kg: "57.000", from: "KD Extrusion", to: "plant stock" } });
    const en = createI18n("en").t;
    expect(en(toPlant.key, toPlant.vars)).toBe("3 bundles, 57.000 kg, moved from KD Extrusion to plant stock");
    const hi = createI18n("hi").t;
    const hiLabel = timelineLabel(
      { action: "order.reallocate", meta: { status: "applied" }, move: { count: 3, kgG: 57_000, from: [kd], to: null } },
      { plant: hi("orders.timeline.plantStock") },
    );
    expect(hi(hiLabel.key, hiLabel.vars)).toBe("3 bundle, 57.000 kg, KD Extrusion से प्लांट स्टॉक को ले जाए गए");
    const royal = { customerName: "Royal Aluminium", orderNumber: "SO-4", lineNo: 1 };
    const asked = timelineLabel({ action: "order.reallocate", meta: { status: "pending" }, move: { count: 1, kgG: 57_046, from: [kd], to: royal } });
    expect(en(asked.key, asked.vars)).toBe("1 bundle, 57.046 kg, from KD Extrusion to Royal Aluminium SO-4, asked. Waiting for a manager.");
    // The server's count and kg win over a row's own (the old "0 bundles, 0.000 kg" decision row).
    const old = timelineLabel({ action: "order.reallocate", meta: { status: "applied", moved: 1 }, move: { count: 1, kgG: 57_046, from: null } });
    expect(old).toEqual({ key: "orders.timeline.reallocateApplied", vars: { count: 1, kg: "57.046" } });
  });

  test("explorer W1 M5: holds read as words, not order.hold / order.release", () => {
    const en = createI18n("en").t;
    const hold = timelineLabel({ action: "order.hold", meta: { lineNo: 1, serials: ["26J4007"], kgG: 62_000 } });
    expect(en(hold.key, hold.vars)).toBe("1 bundle, 62.000 kg, held for line 1");
    const left = timelineLabel({ action: "order.release", meta: { lineNo: 1, serials: ["26J4007"], kgG: 62_000, reason: "dispatched", dispatchCode: "DSP-183" } });
    expect(en(left.key, left.vars)).toBe("1 held bundle, 62.000 kg, left on DSP-183");
    const ended = timelineLabel({ action: "order.release", meta: { lineNo: 2, serials: ["A", "B"], kgG: 100_000, reason: "released" } });
    expect(en(ended.key, ended.vars)).toBe("Hold on line 2 ended: 2 bundles, 100.000 kg");
    expect(createI18n("hi").t(hold.key, hold.vars)).toBe("1 bundle, 62.000 kg, लाइन 1 के लिए होल्ड");
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

  // BACKLOG 51: the fields are the PLANT's wall clock (company zone), whatever zone the browser is in.
  const ist = (iso: string) => new Date(`${iso}+05:30`).getTime();

  test("datetime-local text is the plant's wall clock: Asia/Kolkata round-trips, whatever the browser zone", () => {
    expect(toZonedInput(ist("2026-10-25T08:00:00"), "Asia/Kolkata")).toBe("2026-10-25T08:00");
    expect(fromZonedInput("2026-10-25T08:00", "Asia/Kolkata")).toBe(ist("2026-10-25T08:00:00"));
    expect(toZonedInput(ist("2026-10-26T01:30:00"), "Asia/Kolkata")).toBe("2026-10-26T01:30");
    expect(fromZonedInput("2026-10-26T01:30", "Asia/Kolkata")).toBe(ist("2026-10-26T01:30:00"));
    // Another zone (with summer time) round-trips too, on both sides of its change.
    for (const iso of ["2026-03-29T00:30:00Z", "2026-03-29T03:30:00Z", "2026-10-25T12:00:00Z"]) {
      const ms = new Date(iso).getTime();
      expect(fromZonedInput(toZonedInput(ms, "Europe/London"), "Europe/London")).toBe(ms);
    }
    expect(fromZonedInput("", "Asia/Kolkata")).toBeNull();
    expect(fromZonedInput("2026-10-25", "Asia/Kolkata")).toBeNull();
  });

  test("the window in words, from the production day: today 08:00 to tomorrow 08:00", () => {
    const day = "2026-10-25";
    expect(windowWords(ist("2026-10-25T08:00:00"), ist("2026-10-26T08:00:00"), "Asia/Kolkata", day)).toEqual({
      from: { day: "today", time: "08:00", date: "2026-10-25" },
      to: { day: "tomorrow", time: "08:00", date: "2026-10-26" },
    });
    expect(windowWords(ist("2026-10-26T14:00:00"), ist("2026-10-27T02:00:00"), "Asia/Kolkata", day)).toEqual({
      from: { day: "tomorrow", time: "14:00", date: "2026-10-26" },
      to: { day: "other", time: "02:00", date: "2026-10-27" },
    });
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

describe("holdableItems (FP-OP-17)", () => {
  test("bundles on no line or this line, not held yet", () => {
    const items = [
      { id: "a", lineId: null, heldForLineId: null },
      { id: "b", lineId: "l1", heldForLineId: null },
      { id: "c", lineId: "l2", heldForLineId: null },
      { id: "d", lineId: null, heldForLineId: "l9" },
    ];
    expect(holdableItems(items, "l1").map((i) => i.id)).toEqual(["a", "b"]);
  });
});
