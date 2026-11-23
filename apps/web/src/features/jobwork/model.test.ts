import { describe, expect, test } from "bun:test";

import {
  addPick,
  ageTone,
  bucketCells,
  bundleStepBadge,
  challanTotals,
  chemicalsOf,
  costPreview,
  defaultMode,
  finishParts,
  finishStateOf,
  gramsOf,
  gramsOrZero,
  groupPendingByVendor,
  isCoat,
  limitState,
  lineValuePaise,
  mmOf,
  needsYard,
  paiseDraft,
  paiseOf,
  parseCodes,
  pcsOf,
  pcsOrZero,
  percentOfBp,
  previewNew,
  previewSame,
  receivePayload,
  refusalKeyOf,
  routerOf,
  sendPayload,
  sendProblems,
  splitPicks,
  startPayload,
  startProblems,
  stepActions,
  toggleOp,
  type InputRow,
  type PendingItem,
} from "./model";

const row = (n: number, weightG: number, pcs = 10): InputRow => ({ bundleId: `b${n}`, serial: `26I${n}`, weightG, pcs, lengthMm: 3000, returnId: null, dieId: "d1", sectionCode: "1001" });

const pend = (o: Partial<PendingItem> & { id: string }): PendingItem => ({
  number: o.id,
  process: "anodise",
  finishCode: null,
  vendorId: "v1",
  vendorName: "Alpha",
  vendorCode: "AL",
  expectedReturn: null,
  outBundles: 1,
  outPcs: 10,
  outG: 100_000,
  days: 1,
  bucket: "d0_7",
  overdue: false,
  daysToLimit: 300,
  ...o,
});

describe("typed text to stored integers", () => {
  test("kg text to grams, blank or zero is null", () => {
    expect(gramsOf("12.5")).toBe(12_500);
    expect(gramsOf("0.001")).toBe(1);
    expect(gramsOf("")).toBeNull();
    expect(gramsOf("0")).toBeNull();
    expect(gramsOf("abc")).toBeNull();
  });
  test("an optional weight: blank is zero, text that is not a weight is null", () => {
    expect(gramsOrZero("")).toBe(0);
    expect(gramsOrZero("  ")).toBe(0);
    expect(gramsOrZero("2")).toBe(2000);
    expect(gramsOrZero("x")).toBeNull();
  });
  test("mm text, whole pieces and rupees", () => {
    expect(mmOf("3000")).toBe(3000);
    expect(mmOf("0")).toBeNull();
    expect(pcsOf("12")).toBe(12);
    expect(pcsOf("1,200")).toBe(1200);
    expect(pcsOf("1.5")).toBeNull();
    expect(pcsOf("0")).toBeNull();
    expect(pcsOrZero("")).toBe(0);
    expect(pcsOrZero("0")).toBe(0);
    expect(pcsOrZero("x")).toBeNull();
    expect(paiseOf("198.50")).toBe(19_850);
    expect(paiseOf("0")).toBeNull();
    expect(paiseOf("")).toBeNull();
    expect(paiseDraft(19_850)).toBe("198.5");
    expect(paiseDraft(20_000)).toBe("200");
    expect(paiseDraft(null)).toBe("");
  });
  test("percent of basis points has one decimal and no sign", () => {
    expect(percentOfBp(250)).toBe("2.5");
    expect(percentOfBp(-250)).toBe("2.5");
    expect(percentOfBp(0)).toBe("0");
  });
});

describe("at the vendors", () => {
  test("grouped by vendor, oldest vendor first, oldest challan first inside it", () => {
    const groups = groupPendingByVendor([
      pend({ id: "JW/1", vendorId: "v1", vendorName: "Alpha", days: 3 }),
      pend({ id: "JW/2", vendorId: "v2", vendorName: "Beta", vendorCode: "BE", days: 40, bucket: "d30_plus", overdue: true, outG: 50_000 }),
      pend({ id: "JW/3", vendorId: "v1", vendorName: "Alpha", days: 9, bucket: "d8_15", outG: 200_000, outBundles: 2 }),
    ]);
    expect(groups.map((g) => g.vendorName)).toEqual(["Beta", "Alpha"]);
    const alpha = groups[1]!;
    expect(alpha.steps.map((s) => s.id)).toEqual(["JW/3", "JW/1"]);
    expect(alpha.outG).toBe(300_000);
    expect(alpha.outBundles).toBe(3);
    expect(alpha.oldestDays).toBe(9);
    expect(groups[0]!.overdue).toBe(1);
    expect(alpha.overdue).toBe(0);
  });
  test("overdue is red whatever the age, else the bucket picks the tone", () => {
    expect(ageTone("d0_7", true)).toBe("red");
    expect(ageTone("d0_7", false)).toBe("green");
    expect(ageTone("d8_15", false)).toBe("blue");
    expect(ageTone("d16_30", false)).toBe("amber");
    expect(ageTone("d30_plus", false)).toBe("red");
  });
  test("the strip always has the four buckets in order", () => {
    const cells = bucketCells({ d0_7: { steps: 2, outG: 5 }, d8_15: { steps: 0, outG: 0 }, d16_30: { steps: 1, outG: 9 }, d30_plus: { steps: 0, outG: 0 } });
    expect(cells.map((c) => c.bucket)).toEqual(["d0_7", "d8_15", "d16_30", "d30_plus"]);
    expect(cells[0]).toMatchObject({ steps: 2, outG: 5, tone: "green" });
  });
  test("the one-year limit warns inside 60 days and again once passed", () => {
    expect(limitState(365)).toBe("ok");
    expect(limitState(61)).toBe("ok");
    expect(limitState(60)).toBe("soon");
    expect(limitState(0)).toBe("soon");
    expect(limitState(-1)).toBe("over");
  });
});

describe("what a step may do", () => {
  test("receive while open or part back, cancel only while open", () => {
    expect(stepActions("open")).toEqual({ receive: true, cancel: true });
    expect(stepActions("partial")).toEqual({ receive: true, cancel: false });
    expect(stepActions("done")).toEqual({ receive: false, cancel: false });
    expect(stepActions("cancelled")).toEqual({ receive: false, cancel: false });
  });
  test("the router of a kind, its default mode and when a yard is needed", () => {
    expect(routerOf("jobwork")).toBe("steps");
    expect(routerOf("finish")).toBe("steps");
    expect(routerOf("draw")).toBe("drawbench");
    expect(routerOf("fabricate")).toBe("fabrication");
    expect(defaultMode("jobwork")).toBe("same");
    expect(defaultMode("draw")).toBe("new");
    expect(needsYard("jobwork", "same")).toBe(true);
    expect(needsYard("finish", "same")).toBe(false);
    expect(needsYard("finish", "new")).toBe(true);
  });
  test("coats are anodise, powder coat and PVD", () => {
    expect(isCoat("anodise")).toBe(true);
    expect(isCoat("pvd")).toBe(true);
    expect(isCoat("machining")).toBe(false);
    expect(isCoat("draw")).toBe(false);
  });
  test("each refusal code names a base jw.refusal key", () => {
    expect(refusalKeyOf("no_output")).toBe("jw.refusal.noOutput");
    expect(refusalKeyOf("gain_too_high")).toBe("jw.refusal.gainTooHigh");
    expect(refusalKeyOf("output_over_input")).toBe("jw.refusal.outputOverInput");
    expect(refusalKeyOf("negative_weight")).toBe("jw.refusal.negativeWeight");
  });
});

describe("receive sheet, same bundles back", () => {
  const inputs = [row(1, 100_000), row(2, 200_000)];
  test("figures come from the domain: loss, yield and what the server would refuse", () => {
    const { preview, lines } = previewSame({
      inputs,
      drafts: { b1: { weight: "98", rejectPcs: "", rejectKg: "" }, b2: { weight: "195", rejectPcs: "1", rejectKg: "3" } },
      scrapDraft: "1",
      coat: false,
    });
    expect(lines).toEqual([
      { bundleId: "b1", weightG: 98_000, rejectPcs: 0, rejectG: 0 },
      { bundleId: "b2", weightG: 195_000, rejectPcs: 1, rejectG: 3000 },
    ]);
    expect(preview.figures).toMatchObject({ inputG: 300_000, outputG: 293_000, rejectG: 3000, scrapG: 1000, lossG: 3000, lossBp: 100, yieldBp: 9767 });
    expect(preview.refusal).toBeNull();
    expect(preview.ready).toBe(true);
    expect(preview.closing).toBe(2);
  });
  test("a blank row stays out: a part return closes only the typed ones", () => {
    const { preview } = previewSame({ inputs, drafts: { b1: { weight: "99", rejectPcs: "", rejectKg: "" } }, scrapDraft: "", coat: false });
    expect(preview.closing).toBe(1);
    expect(preview.figures?.inputG).toBe(100_000);
    expect(preview.ready).toBe(true);
  });
  test("nothing typed is not ready and has no figures", () => {
    const { preview } = previewSame({ inputs, drafts: {}, scrapDraft: "", coat: false });
    expect(preview.ready).toBe(false);
    expect(preview.figures).toBeNull();
  });
  test("more back than sent is refused unless a coat was put on, and then only up to 5 in 100", () => {
    const heavier = { b1: { weight: "103", rejectPcs: "", rejectKg: "" } };
    expect(previewSame({ inputs, drafts: heavier, scrapDraft: "", coat: false }).preview.refusal).toBe("output_over_input");
    const coat = previewSame({ inputs, drafts: heavier, scrapDraft: "", coat: true }).preview;
    expect(coat.refusal).toBeNull();
    expect(coat.figures?.lossG).toBe(-3000);
    expect(previewSame({ inputs, drafts: { b1: { weight: "110", rejectPcs: "", rejectKg: "" } }, scrapDraft: "", coat: true }).preview.refusal).toBe("gain_too_high");
  });
  test("a row problem: weight that is not a weight, rejects that take every piece", () => {
    const bad = previewSame({ inputs, drafts: { b1: { weight: "x", rejectPcs: "", rejectKg: "" }, b2: { weight: "190", rejectPcs: "10", rejectKg: "" } }, scrapDraft: "", coat: false }).preview;
    expect(bad.rowProblems).toEqual({ b1: "weight", b2: "rejectsAll" });
    expect(bad.ready).toBe(false);
    const scrap = previewSame({ inputs, drafts: { b1: { weight: "99", rejectPcs: "", rejectKg: "" } }, scrapDraft: "?", coat: false }).preview;
    expect(scrap.scrapBad).toBe(true);
    expect(scrap.ready).toBe(false);
  });
});

describe("receive sheet, new bundles", () => {
  const inputs = [row(1, 100_000), row(2, 200_000), { ...row(3, 50_000), returnId: "r1" }];
  test("all inputs still out are used up when picked is null; the back ones are never included", () => {
    const r = previewNew({ inputs, picked: null, outputs: [{ dieId: "", length: "2000", pcs: "20", weight: "290" }], rejectDraft: "", scrapDraft: "5", coat: false });
    expect(r.closingIds).toEqual(["b1", "b2"]);
    expect(r.lines).toEqual([{ lengthMm: 2000, pcs: 20, weightG: 290_000 }]);
    expect(r.preview.figures).toMatchObject({ inputG: 300_000, outputG: 290_000, scrapG: 5000, lossG: 5000 });
    expect(r.preview.ready).toBe(true);
  });
  test("a picked input list closes only those, and an output keeps its die", () => {
    const r = previewNew({ inputs, picked: ["b2"], outputs: [{ dieId: "d9", length: "2000", pcs: "20", weight: "190" }], rejectDraft: "2", scrapDraft: "", coat: false });
    expect(r.closingIds).toEqual(["b2"]);
    expect(r.lines[0]).toEqual({ dieId: "d9", lengthMm: 2000, pcs: 20, weightG: 190_000 });
    expect(r.preview.figures).toMatchObject({ inputG: 200_000, rejectG: 2000 });
  });
  test("an output line with one box missing is a problem on that line; a blank line is ignored", () => {
    const r = previewNew({
      inputs,
      picked: null,
      outputs: [
        { dieId: "", length: "2000", pcs: "", weight: "10" },
        { dieId: "", length: "", pcs: "", weight: "" },
        { dieId: "", length: "25000", pcs: "1", weight: "10" },
      ],
      rejectDraft: "",
      scrapDraft: "",
      coat: false,
    });
    expect(r.preview.rowProblems).toEqual({ "out-0": "pcs", "out-2": "length" });
    expect(r.preview.ready).toBe(false);
  });
  test("unticking every input closes nothing", () => {
    const r = previewNew({ inputs, picked: [], outputs: [{ dieId: "", length: "2000", pcs: "20", weight: "290" }], rejectDraft: "", scrapDraft: "", coat: false });
    expect(r.closingIds).toEqual([]);
    expect(r.preview.ready).toBe(false);
  });
  test("no output line at all is not ready", () => {
    const r = previewNew({ inputs, picked: null, outputs: [], rejectDraft: "", scrapDraft: "", coat: false });
    expect(r.preview.ready).toBe(false);
  });
});

describe("cost and the receive body", () => {
  test("cost per good kg spreads the bill on the input kg over the good output", () => {
    const { preview } = previewSame({ inputs: [row(1, 100_000)], drafts: { b1: { weight: "95", rejectPcs: "", rejectKg: "" } }, scrapDraft: "", coat: true });
    const c = costPreview(15_000, preview.figures);
    expect(c).toEqual({ amountPaise: 1_500_000, costPerKgPaise: 15_789 });
    expect(costPreview(null, preview.figures)).toBeNull();
    expect(costPreview(15_000, null)).toBeNull();
  });
  test("same body: only what was typed, weights as grams", () => {
    const { preview, lines } = previewSame({ inputs: [row(1, 100_000)], drafts: { b1: { weight: "99.5", rejectPcs: "", rejectKg: "" } }, scrapDraft: "", coat: false });
    const body = receivePayload(
      { id: "s1", mode: "same", locationId: "y1", vendorDocNo: " INV-7 ", rateDraft: "150", minutes: "", passes: "", note: "", },
      { same: lines, output: [], closingIds: [], scrapG: preview.figures?.scrapG ?? 0, rejectG: 0, rejectPcs: 0 },
      true,
    );
    expect(body).toEqual({ id: "s1", mode: "same", locationId: "y1", vendorDocNo: "INV-7", ratePaisePerKg: 15_000, scrapG: 0, same: [{ bundleId: "b1", weightG: 99_500, rejectPcs: 0, rejectG: 0 }] });
  });
  test("new body carries the closing ids and output lines, and leaves out a yard it does not need", () => {
    const body = receivePayload(
      { id: "s2", mode: "new", locationId: "", vendorDocNo: "", rateDraft: "", minutes: "45", passes: "3", note: " ok ", },
      { same: [], output: [{ lengthMm: 2000, pcs: 4, weightG: 9000 }], closingIds: ["b1"], scrapG: 500, rejectG: 0, rejectPcs: 0 },
      false,
    );
    expect(body).toEqual({ id: "s2", mode: "new", minutes: 45, passes: 3, note: "ok", scrapG: 500, inputBundleIds: ["b1"], outputs: [{ lengthMm: 2000, pcs: 4, weightG: 9000 }], rejectG: 0, rejectPcs: 0 });
  });
});

describe("picking bundles", () => {
  test("typed codes: split on lines, commas and spaces; repeats are dropped and counted", () => {
    expect(parseCodes("26I1\n26I2, 26i1  26I3;")).toEqual({ codes: ["26I1", "26I2", "26I3"], repeats: 1 });
    expect(parseCodes("  ")).toEqual({ codes: [], repeats: 0 });
  });
  test("a bundle is added once, whether picked from stock or typed", () => {
    let picks = addPick([], { code: "26I1", label: "26I1", bundleId: "b1", weightG: 1000 });
    expect(picks.repeat).toBe(false);
    picks = addPick(picks.picks, { code: "26I1", label: "26I1", bundleId: "b1" });
    expect(picks.repeat).toBe(true);
    picks = addPick(picks.picks, { code: "26i9", label: "26i9" });
    picks = addPick(picks.picks, { code: "26I9", label: "26I9" });
    expect(picks.repeat).toBe(true);
    expect(picks.picks).toHaveLength(2);
    expect(splitPicks(picks.picks)).toEqual({ bundleIds: ["b1"], codes: ["26i9"] });
    // A serial typed first, then picked from stock, stays one bundle.
    const typed = addPick([], { code: "26I5", label: "26I5" });
    expect(addPick(typed.picks, { code: "26I5", label: "26I5", bundleId: "b5", weightG: 10 }).repeat).toBe(true);
  });
});

describe("new challan", () => {
  const picks = addPick([], { code: "26I1", label: "26I1" }).picks;
  const base = { vendorId: "v1", process: "anodise", finishCode: "", expectedReturn: "", vehicleNo: "", valueDraft: "", note: "", picks };
  test("a complete form has no problems", () => {
    expect(sendProblems(base, "2026-11-22")).toEqual([]);
  });
  test("what stops a challan, in the order the form shows it", () => {
    expect(sendProblems({ ...base, vendorId: "", process: "", picks: [], expectedReturn: "2026-11-01", valueDraft: "x" }, "2026-11-22")).toEqual(["vendor", "process", "bundles", "date", "value"]);
    expect(sendProblems({ ...base, expectedReturn: "2026-11-22" }, "2026-11-22")).toEqual([]);
  });
  test("the body leaves out blanks, and the value only for someone who sees cost", () => {
    const full = { ...base, finishCode: " 20 micron ", expectedReturn: "2026-12-01", vehicleNo: "GJ01AB1234", valueDraft: "300", note: "n" };
    expect(sendPayload(full, true)).toEqual({ vendorId: "v1", process: "anodise", codes: ["26I1"], finishCode: "20 micron", expectedReturn: "2026-12-01", vehicleNo: "GJ01AB1234", valuePaisePerKg: 30_000, note: "n" });
    expect(sendPayload(full, false)).not.toHaveProperty("valuePaisePerKg");
    expect(sendPayload(base, true)).toEqual({ vendorId: "v1", process: "anodise", codes: ["26I1"] });
  });
});

describe("in-house start", () => {
  const picks = addPick([], { code: "26I1", label: "26I1", bundleId: "b1" }).picks;
  const base = { process: "anodise", finishCode: "", batchNo: "", chemicals: [], passes: "", outSize: "", ops: [], note: "", picks };
  test("chemicals: blank rows dropped, a quantity with no name is a problem", () => {
    expect(chemicalsOf([{ name: " Sulphuric acid ", qty: "20 L" }, { name: "", qty: "" }])).toEqual({ chemicals: [{ name: "Sulphuric acid", qty: "20 L" }], bad: false });
    expect(chemicalsOf([{ name: "", qty: "5" }]).bad).toBe(true);
  });
  test("a finishing step needs a process; a bench step does not; passes must be a count", () => {
    expect(startProblems("finish", { ...base, process: "" })).toEqual(["process"]);
    expect(startProblems("finish", { ...base, chemicals: [{ name: "", qty: "5" }] })).toEqual(["chemicals"]);
    expect(startProblems("draw", { ...base, process: "", passes: "2" })).toEqual([]);
    expect(startProblems("draw", { ...base, process: "", passes: "x" })).toEqual(["passes"]);
    expect(startProblems("fabricate", { ...base, process: "", picks: [] })).toEqual(["bundles"]);
  });
  test("each kind sends only its own fields", () => {
    expect(startPayload("finish", { ...base, batchNo: "B7", chemicals: [{ name: "Acid", qty: "2" }], passes: "9" })).toEqual({ bundleIds: ["b1"], process: "anodise", batchNo: "B7", chemicals: [{ name: "Acid", qty: "2" }] });
    expect(startPayload("draw", { ...base, passes: "3", outSize: " 40 x 2 ", note: "x", batchNo: "ignored" })).toEqual({ bundleIds: ["b1"], passes: 3, outSize: "40 x 2", note: "x" });
    expect(startPayload("fabricate", { ...base, ops: ["cut", "punch"] })).toEqual({ bundleIds: ["b1"], ops: ["cut", "punch"] });
  });
  test("operations toggle and keep the plant's order", () => {
    const order = ["cut", "punch", "cnc", "drill", "other"];
    expect(toggleOp(order, ["punch"], "cut")).toEqual(["cut", "punch"]);
    expect(toggleOp(order, ["cut", "punch"], "cut")).toEqual(["punch"]);
  });
});

describe("the challan paper", () => {
  test("totals add the lines; a line's value follows the domain rule", () => {
    expect(
      challanTotals([
        { bundles: 2, pcs: 40, weightG: 120_000, valuePaise: 36_000 },
        { bundles: 1, pcs: 10, weightG: 30_500, valuePaise: 9150 },
      ]),
    ).toEqual({ bundles: 3, pcs: 50, weightG: 150_500, valuePaise: 45_150 });
    expect(challanTotals([])).toEqual({ bundles: 0, pcs: 0, weightG: 0, valuePaise: 0 });
    expect(lineValuePaise(30_000, 120_000)).toBe(3_600_000);
    expect(lineValuePaise(null, 120_000)).toBe(0);
  });
});

describe("order line and bundle page", () => {
  test("only the states that have bundles show, in the order done, vendor, line, not yet", () => {
    const parts = finishParts({ done: { bundles: 3, weightG: 3000 }, at_vendor: { bundles: 0, weightG: 0 }, in_process: { bundles: 1, weightG: 500 }, pending: { bundles: 2, weightG: 900 } });
    expect(parts.map((p) => p.state)).toEqual(["done", "in_process", "pending"]);
    expect(parts[0]).toMatchObject({ bundles: 3, tone: "green" });
    expect(finishParts({})).toEqual([]);
  });
  test("a bundle's finish state is the domain rule", () => {
    expect(finishStateOf({ lineFinish: "anodise", bundleFinish: "anodise", atVendor: false, inProcess: false })).toBe("done");
    expect(finishStateOf({ lineFinish: "anodise", bundleFinish: null, atVendor: true, inProcess: false })).toBe("at_vendor");
    expect(finishStateOf({ lineFinish: null, bundleFinish: null, atVendor: false, inProcess: false })).toBe("not_needed");
  });
  test("the bundle badge says vendor for a job-work hold and process step for an in-house one", () => {
    expect(bundleStepBadge(null)).toBeNull();
    expect(bundleStepBadge({ stepId: "s1", reason: "jobwork", heldAt: 5, number: "JW/2026-27/1", vendorName: "Alpha" })).toMatchObject({ kind: "vendor", number: "JW/2026-27/1", vendorName: "Alpha" });
    expect(bundleStepBadge({ stepId: "s2", reason: "process", heldAt: 5, number: "PS/2026-27/1", vendorName: null })?.kind).toBe("process");
  });
});
