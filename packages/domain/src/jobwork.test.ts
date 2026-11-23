import { describe, expect, test } from "bun:test";

import {
  bundleFinishState,
  challanValuePaise,
  daysAtVendor,
  daysToJobworkLimit,
  finishOfProcess,
  isOutKind,
  isOverdue,
  PROCESS_KIND_MODULE,
  processCost,
  processDocType,
  returnFigures,
  returnRefusal,
  vendorAgeBucket,
} from "./jobwork";

const DAY = 86_400_000;

describe("process kinds", () => {
  test("only job-work goes out; each kind has its module", () => {
    expect(isOutKind("jobwork")).toBe(true);
    expect(isOutKind("finish")).toBe(false);
    expect(PROCESS_KIND_MODULE).toEqual({ jobwork: "jobwork", finish: "jobwork", draw: "drawbench", fabricate: "fabrication" });
    expect(processDocType("jobwork")).toBe("jobwork");
    expect(processDocType("draw")).toBe("process_step");
  });
  test("finish of a process: coats only", () => {
    expect(finishOfProcess("anodise")).toBe("anodise");
    expect(finishOfProcess("powder_coat")).toBe("powder_coat");
    expect(finishOfProcess("pvd")).toBe("pvd");
    expect(finishOfProcess("machining")).toBeNull();
    expect(finishOfProcess(null)).toBeNull();
  });
});

describe("return figures", () => {
  test("loss = input − output − rejects − scrap, with loss and yield in basis points", () => {
    const f = returnFigures({ inputG: 100_000, outputG: 97_000, rejectG: 1_000, scrapG: 500 });
    expect(f.lossG).toBe(1_500);
    expect(f.lossBp).toBe(150);
    expect(f.yieldBp).toBe(9_700);
  });
  test("refusals: negative, nothing back, gain without a coat, gain over 5%", () => {
    expect(returnRefusal({ inputG: 100, outputG: -1, rejectG: 0, scrapG: 0 }, { coat: true })).toBe("negative_weight");
    expect(returnRefusal({ inputG: 100, outputG: 0, rejectG: 0, scrapG: 0 }, { coat: true })).toBe("no_output");
    expect(returnRefusal({ inputG: 100_000, outputG: 101_000, rejectG: 0, scrapG: 0 }, { coat: false })).toBe("output_over_input");
    expect(returnRefusal({ inputG: 100_000, outputG: 104_000, rejectG: 0, scrapG: 0 }, { coat: true })).toBeNull();
    expect(returnRefusal({ inputG: 100_000, outputG: 106_000, rejectG: 0, scrapG: 0 }, { coat: true })).toBe("gain_too_high");
    expect(returnRefusal({ inputG: 100_000, outputG: 0, rejectG: 100_000, scrapG: 0 }, { coat: false })).toBeNull();
  });
});

describe("cost in paise", () => {
  test("rate × kg billed; cost per good kg", () => {
    // ₹18.50/kg on 1,000 kg sent, 980 kg good back.
    const c = processCost({ ratePaisePerKg: 1_850, billedG: 1_000_000, outputG: 980_000 });
    expect(c.amountPaise).toBe(1_850_000);
    expect(c.costPerKgPaise).toBe(1_888);
    expect(processCost({ ratePaisePerKg: null, billedG: 1_000, outputG: 0 })).toEqual({ amountPaise: 0, costPerKgPaise: null });
  });
  test("challan value", () => {
    expect(challanValuePaise(25_000, 1_500_000)).toBe(37_500_000);
    expect(challanValuePaise(null, 1_000)).toBe(0);
  });
});

describe("pending at vendor", () => {
  test("days and buckets", () => {
    const sent = Date.UTC(2026, 10, 1);
    expect(daysAtVendor(sent, sent + 3 * DAY + 5)).toBe(3);
    expect(daysAtVendor(sent, sent - DAY)).toBe(0);
    expect(vendorAgeBucket(0)).toBe("d0_7");
    expect(vendorAgeBucket(8)).toBe("d8_15");
    expect(vendorAgeBucket(30)).toBe("d16_30");
    expect(vendorAgeBucket(31)).toBe("d30_plus");
    expect(daysToJobworkLimit(sent, sent + 65 * DAY)).toBe(300);
  });
  test("overdue after the expected date", () => {
    expect(isOverdue("2026-11-20", "2026-11-21")).toBe(true);
    expect(isOverdue("2026-11-21", "2026-11-21")).toBe(false);
    expect(isOverdue(null, "2026-11-21")).toBe(false);
  });
});

describe("order line finish requirement", () => {
  test("states", () => {
    expect(bundleFinishState({ lineFinish: null, bundleFinish: null, atVendor: false, inProcess: false })).toBe("not_needed");
    expect(bundleFinishState({ lineFinish: "none", bundleFinish: null, atVendor: false, inProcess: false })).toBe("not_needed");
    expect(bundleFinishState({ lineFinish: "powder_coat", bundleFinish: "powder_coat", atVendor: false, inProcess: false })).toBe("done");
    expect(bundleFinishState({ lineFinish: "powder_coat", bundleFinish: "anodise", atVendor: true, inProcess: true })).toBe("at_vendor");
    expect(bundleFinishState({ lineFinish: "anodise", bundleFinish: null, atVendor: false, inProcess: true })).toBe("in_process");
    expect(bundleFinishState({ lineFinish: "anodise", bundleFinish: null, atVendor: false, inProcess: false })).toBe("pending");
  });
});
