import { describe, expect, test } from "bun:test";

import { visibleItems, TENANT_MORE } from "@/shell/nav-items";

import {
  autoAllocate,
  chargesFromBoxes,
  creditLinesFromBoxes,
  kgToGrams,
  checkAllocation,
  docActions,
  financialYearRange,
  bpToPercent,
  irnWord,
  orNull,
  percentToBp,
  paiseToBox,
  ratesFromBoxes,
  recentMonths,
  rupeesToPaise,
  selectable,
  shapeOutstanding,
  statusTone,
} from "./model";
import { paymentsSearch } from "./search";

describe("rupees in a box", () => {
  test("whole paise, grouping allowed, three decimals refused", () => {
    expect(rupeesToPaise("1,250.50")).toBe(125050);
    expect(rupeesToPaise("215")).toBe(21500);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("2,5")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
  test("paise back to a box", () => {
    expect(paiseToBox(125050)).toBe("1250.5");
    expect(paiseToBox(21500)).toBe("215");
    expect(paiseToBox(1)).toBe("0.01");
  });
});

describe("months and years", () => {
  test("recent months run back across a new year", () => {
    expect(recentMonths("2026-02-10", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
  test("financial year is April to March", () => {
    expect(financialYearRange("2026-11-22")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(financialYearRange("2027-02-01")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });
});

describe("status and actions", () => {
  test("tones", () => {
    expect(statusTone("issued")).toBe("green");
    expect(statusTone("cancelled")).toBe("red");
    expect(statusTone("irn_pending")).toBe("amber");
    expect(statusTone("draft")).toBe("amber");
  });
  const base = { kind: "invoice" as const, status: "draft" as const, needsIrn: false, irnStatus: "none", hasIrn: false, ewbStatus: "none", cancelPendingApprovalId: null };
  test("a draft can be issued or discarded and nothing else", () => {
    const a = docActions(base);
    expect(a.issue && a.discard).toBe(true);
    expect(a.askCancel || a.creditNote || a.payment || a.ewbPanel).toBe(false);
  });
  test("an issued invoice asks to cancel, takes a credit note and a payment; a pending ask shows as pending", () => {
    const a = docActions({ ...base, status: "issued" });
    expect(a).toMatchObject({ issue: false, askCancel: true, creditNote: true, payment: true, ewbPanel: true });
    expect(docActions({ ...base, status: "issued", cancelPendingApprovalId: "x" })).toMatchObject({ askCancel: false, cancelPending: true });
  });
  test("a credit note takes no payment and no credit note", () => {
    expect(docActions({ ...base, kind: "credit_note", status: "issued" })).toMatchObject({ creditNote: false, payment: false, ewbPanel: false });
  });
  test("IRN pending offers Generate; a failed one offers Try again; a generated one offers nothing", () => {
    const pending = docActions({ ...base, status: "irn_pending", needsIrn: true, irnStatus: "pending" });
    expect(pending).toMatchObject({ irnPanel: true, irnGenerate: true, ewbFile: true, ewbPanel: false, askCancel: true });
    expect(docActions({ ...base, status: "issued", needsIrn: true, irnStatus: "failed" }).irnGenerate).toBe(true);
    expect(docActions({ ...base, status: "issued", needsIrn: true, irnStatus: "generated", hasIrn: true }).irnGenerate).toBe(false);
    expect(docActions({ ...base, status: "draft", needsIrn: true }).irnPanel).toBe(false);
  });
  test("irn words", () => {
    expect(irnWord("auto_retry")).toBe("retrying");
    expect(irnWord("none")).toBe("none");
    expect(irnWord("weird")).toBe("none");
  });
});

describe("rates and charges", () => {
  test("rates keep good boxes and report empty and bad ones", () => {
    const r = ratesFromBoxes([
      { key: "a", label: "A", text: "215.50" },
      { key: "b", label: "B", text: "" },
      { key: "c", label: "C", text: "0" },
      { key: "d", label: "D", text: "x" },
    ]);
    expect(r.rates).toEqual({ a: 21550 });
    expect(r.empty).toEqual(["b"]);
    expect(r.bad).toEqual(["c", "d"]);
  });
  test("charges skip blank lines and flag half-filled ones", () => {
    const c = chargesFromBoxes([
      { label: "Powder coating", amountText: "5,000", hsnId: "h1" },
      { label: "", amountText: "", hsnId: "" },
      { label: "Packing", amountText: "", hsnId: "" },
      { label: "", amountText: "40", hsnId: "" },
    ]);
    expect(c.charges).toEqual([{ label: "Powder coating", amountPaise: 500000, hsnId: "h1" }]);
    expect(c.bad).toEqual([2, 3]);
  });
  test("once a packing list is ticked only the same customer's others stay open", () => {
    const rows = [
      { id: "1", customerId: "a" },
      { id: "2", customerId: "b" },
      { id: "3", customerId: "a" },
    ];
    expect([...selectable(rows, new Set())]).toEqual(["1", "2", "3"]);
    expect([...selectable(rows, new Set(["1"]))]).toEqual(["1", "3"]);
  });
});

describe("payment allocation", () => {
  const open = [
    { id: "i1", duePaise: 100000 },
    { id: "i2", duePaise: 50000 },
  ];
  test("auto allocation goes oldest first and keeps the rest on account", () => {
    const a = autoAllocate(130000, open);
    expect(a.boxes).toEqual([
      { invoiceId: "i1", text: "1000" },
      { invoiceId: "i2", text: "300" },
    ]);
    expect(a.onAccountPaise).toBe(0);
    expect(autoAllocate(200000, open).onAccountPaise).toBe(50000);
  });
  test("a good split is ok and the unallocated part is on account", () => {
    const r = checkAllocation("1500", open, [{ invoiceId: "i1", text: "1000" }]);
    expect(r.ok).toBe(true);
    expect(r.onAccountPaise).toBe(50000);
    expect(r.allocations).toEqual([{ invoiceId: "i1", amountPaise: 100000 }]);
  });
  test("paying more than an invoice owes, more than the payment, or a bad amount is refused", () => {
    expect(checkAllocation("2000", open, [{ invoiceId: "i2", text: "600" }]).problems.i2).toBe("over_due");
    expect(checkAllocation("1000", open, [{ invoiceId: "i1", text: "600" }, { invoiceId: "i2", text: "500" }]).problems.total).toBe("over_amount");
    expect(checkAllocation("", open, []).problems.total).toBe("amount");
    expect(checkAllocation("100", open, [{ invoiceId: "i1", text: "abc" }]).ok).toBe(false);
  });
});

describe("outstanding table", () => {
  const row = (name: string, d: number, due: number, adv: number) => ({
    customerId: name,
    customerName: name,
    openInvoices: 1,
    buckets: { d0_30: d, d31_60: 0, d61_90: 0, d90_plus: due - d },
    invoicesDuePaise: due,
    onAccountPaise: adv,
    balancePaise: due - adv,
  });
  test("totals add the rows shown", () => {
    const t = shapeOutstanding([row("Shivam", 100, 300, 50), row("Anand", 200, 200, 0)]);
    expect(t.totals).toMatchObject({ invoicesDuePaise: 500, onAccountPaise: 50, balancePaise: 450 });
    expect(t.totals.buckets).toEqual({ d0_30: 300, d31_60: 0, d61_90: 0, d90_plus: 200 });
  });
  test("a search narrows rows and totals", () => {
    const t = shapeOutstanding([row("Shivam", 100, 300, 50), row("Anand", 200, 200, 0)], "anan");
    expect(t.rows.map((r) => r.customerName)).toEqual(["Anand"]);
    expect(t.totals.balancePaise).toBe(200);
  });
});

describe("the Billing nav entry", () => {
  const item = TENANT_MORE.find((i) => i.key === "billing");
  const me = (role: string, modules: string[]) => ({ user: { id: "u1", name: "U", email: "u@orrn.local" }, company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role, modules }, isPlatformAdmin: false, platformRole: null }) as never;
  test("it is there and points at /billing", () => {
    expect(item?.to).toBe("/billing");
    expect(item?.module).toBe("billing");
  });
  test("module off hides it, module on shows it for the office", () => {
    expect(visibleItems([item!], me("office", [])).length).toBe(0);
    expect(visibleItems([item!], me("office", ["billing"])).length).toBe(1);
  });
});

describe("credit note lines", () => {
  const blank = { kind: "weight" as const, description: "", kgText: "", rateText: "", amountText: "", hsnId: "" };
  test("kg to grams, three decimals at most", () => {
    expect(kgToGrams("12.5")).toBe(12500);
    expect(kgToGrams("1,250.125")).toBe(1250125);
    expect(kgToGrams("1.2345")).toBeNull();
  });
  test("weight and amount lines, blank skipped, half filled flagged", () => {
    const r = creditLinesFromBoxes([
      { ...blank, description: "Returned bundle", kgText: "25", rateText: "210" },
      { ...blank, kind: "amount", description: "Rate difference", amountText: "1,000" },
      blank,
      { ...blank, description: "No weight", rateText: "210" },
      { ...blank, kind: "amount", description: "", amountText: "5" },
    ]);
    expect(r.lines).toEqual([
      { kind: "weight", description: "Returned bundle", weightG: 25000, ratePaise: 21000 },
      { kind: "amount", description: "Rate difference", amountPaise: 100000 },
    ]);
    expect(r.bad).toEqual([3, 4]);
  });
});

describe("GST rate and optional boxes", () => {
  test("percent to basis points", () => {
    expect(percentToBp("18")).toBe(1800);
    expect(percentToBp("2.5")).toBe(250);
    expect(percentToBp("28")).toBe(2800);
    expect(percentToBp("29")).toBeNull();
    expect(percentToBp("1.234")).toBeNull();
    expect(percentToBp("")).toBeNull();
    expect(bpToPercent(1800)).toBe("18");
    expect(bpToPercent(250)).toBe("2.5");
  });
  test("an empty optional box is null", () => {
    expect(orNull("  ")).toBeNull();
    expect(orNull(" Surat ")).toBe("Surat");
  });
});

describe("payments search", () => {
  test("keeps an id pair, drops junk and an invoice without its customer", () => {
    expect(paymentsSearch({ customerId: "c1", invoiceId: "i1" })).toEqual({ customerId: "c1", invoiceId: "i1" });
    expect(paymentsSearch({ invoiceId: "i1" })).toEqual({});
    expect(paymentsSearch({ customerId: 5 })).toEqual({});
    expect(paymentsSearch({ customerId: "c1" })).toEqual({ customerId: "c1", invoiceId: undefined });
  });
});
