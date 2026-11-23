import { describe, expect, test } from "bun:test";

import { parseEnquiriesSearch, parseNewQuoteSearch, parseQuotesSearch } from "./search";

describe("pricing search params", () => {
  test("quotes keep a known status, a customer and a positive offset", () => {
    expect(parseQuotesSearch({ status: "sent", customer: " c1 ", offset: "50" })).toEqual({ status: "sent", customer: "c1", offset: 50 });
    expect(parseQuotesSearch({ status: "nope", offset: "-1" })).toEqual({});
  });
  test("a new quote reads the enquiry id", () => {
    expect(parseNewQuoteSearch({ enquiryId: "e1" })).toEqual({ enquiryId: "e1" });
    expect(parseNewQuoteSearch({})).toEqual({});
  });
  test("enquiries: overdue=1 from the Today tile, view=all, otherwise open", () => {
    expect(parseEnquiriesSearch({ overdue: "1" })).toEqual({ view: "overdue" });
    expect(parseEnquiriesSearch({ view: "all" })).toEqual({ view: "all" });
    expect(parseEnquiriesSearch({})).toEqual({});
  });
});
