import { describe, expect, test } from "bun:test";

import { blankEnquiry, canMakeQuote, draftFromEnquiry, enquiryParty, enquiryProblems, enquirySection, toEnquiryCreate, toEnquiryUpdate } from "./enquiry-model";

describe("enquiry model", () => {
  test("a customer or a buyer's name is needed", () => {
    expect(enquiryProblems(blankEnquiry()).party).toBeDefined();
    expect(enquiryProblems({ ...blankEnquiry(), prospectName: "Raju" }).party).toBeUndefined();
    expect(enquiryProblems({ ...blankEnquiry(), customer: { id: "c", label: "C" } }).party).toBeUndefined();
  });
  test("create sends only what was filled in", () => {
    const d = { ...blankEnquiry(), prospectName: " Raju ", kgText: "5", followUpDate: "2026-12-01" };
    expect(toEnquiryCreate(d)).toEqual({ prospectName: "Raju", kgG: 5000, followUpDate: "2026-12-01" });
  });
  test("update spells every field out, null clears", () => {
    const u = toEnquiryUpdate({ ...blankEnquiry(), prospectName: "Raju", status: "lost" }, "e1", 7);
    expect(u).toEqual({ id: "e1", serverSeq: 7, customerId: null, prospectName: "Raju", contact: null, sectionId: null, sectionText: null, kgG: null, followUpDate: null, note: null, status: "lost" });
  });
  test("a stored row becomes a draft and back to the same party and section words", () => {
    const row = { id: "e", serverSeq: 3, customerId: null, customerName: null, prospectName: "Raju", contact: "98", sectionId: null, sectionCode: null, sectionText: "Domal", kgG: 1500, followUpDate: "2026-12-01", note: null, status: "quoted" };
    const d = draftFromEnquiry(row);
    expect(d.kgText).toBe("1.500");
    expect(d.status).toBe("quoted");
    expect(enquiryParty(row)).toBe("Raju");
    expect(enquirySection(row)).toBe("Domal");
  });
  test("a quote can be made only from an open or quoted enquiry", () => {
    expect(canMakeQuote("open")).toBe(true);
    expect(canMakeQuote("quoted")).toBe(true);
    expect(canMakeQuote("won")).toBe(false);
  });
});
