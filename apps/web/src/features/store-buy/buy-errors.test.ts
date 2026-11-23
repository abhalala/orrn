import { describe, expect, test } from "bun:test";

import { createI18n, type MessageKey } from "@orrn/i18n";

import { buyErrorText } from "./buy-errors";

function server(code: string, message: string) {
  return { name: "TRPCClientError", message, data: { code, httpStatus: 400 } };
}

// The server's messages (routers/storePo.ts, storeIndent.ts, store.ts receive), with sample names.
const CASES: [ReturnType<typeof server>, MessageKey][] = [
  [server("BAD_REQUEST", "Over the order: PO-12 line 2 takes at most 4.5 more kg"), "store2.errors.overReceipt"],
  [server("BAD_REQUEST", "PO-12 line 2 is for another item"), "store2.errors.poWrongItem"],
  [server("CONFLICT", "PO-12 is not open for deliveries"), "store2.errors.poNotOpen"],
  [server("BAD_REQUEST", "Quantity times rate is too large for one GRN"), "store2.errors.tooLarge"],
  [server("NOT_FOUND", "Purchase order line not found"), "store2.errors.notFound"],
  [server("BAD_REQUEST", "Shah Traders is not a confirmed vendor"), "store2.errors.vendorNotConfirmed"],
  [server("CONFLICT", "IND-4 is rejected; only an approved indent becomes an order"), "store2.errors.indentNotApproved"],
  [server("CONFLICT", "IND-4 is no longer approved; open it again"), "store2.errors.indentChanged"],
  [server("CONFLICT", "IND-4 is ordered; it cannot be rejected"), "store2.errors.wrongStatus"],
  [server("BAD_REQUEST", "At most 40 items on one order"), "store2.errors.tooManyLines"],
  [server("BAD_REQUEST", "The same item is on the indent twice"), "store2.errors.sameItemTwice"],
  [server("CONFLICT", "LDO is not below its minimum"), "store2.errors.notBelow"],
  [server("FORBIDDEN", "Only the office can change the order's rate"), "store2.errors.rateOfficeOnlyPo"],
  [server("FORBIDDEN", "Only the office can set a rate; leave it empty and it stays pending"), "store2.errors.rateOfficeOnly"],
  [server("BAD_REQUEST", "All the Cover flux in the store already has a rate"), "store2.errors.allRated"],
  [server("BAD_REQUEST", "Stock from this delivery has already been issued. Record a return to the vendor instead."), "store2.errors.issuedSince"],
  [server("BAD_REQUEST", "This delivery's stock already has an opening rate. Record a return to the vendor instead."), "store2.errors.openingRated"],
];

describe("buyErrorText", () => {
  test("each buying refusal has its own words, in English and Hindi", () => {
    for (const locale of ["en", "hi"] as const) {
      const { t } = createI18n(locale);
      for (const [error, key] of CASES) {
        const text = buyErrorText(t, error);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toBe(error.message);
        if (locale === "en") expect(text.startsWith(t(key, { po: "PO-12", line: "2", qty: "4.5", unit: "kg", number: "IND-4" }).slice(0, 6))).toBe(true);
      }
    }
  });

  test("the over-order refusal keeps the numbers", () => {
    const { t } = createI18n("en");
    expect(buyErrorText(t, server("BAD_REQUEST", "Over the order: PO-12 line 2 takes at most 4.5 more kg"))).toContain("PO-12 line 2 can take only 4.5 kg more");
  });

  test("the rate refusals say the office sets rates, not the generic forbidden", () => {
    const { t } = createI18n("en");
    const text = buyErrorText(t, server("FORBIDDEN", "Only the office can set a rate; leave it empty and it stays pending"));
    expect(text).not.toBe(t("store2.errors.forbidden"));
    expect(text).toContain("office");
  });

  test("forbidden and unknown fall back to plain words", () => {
    const { t } = createI18n("en");
    expect(buyErrorText(t, server("FORBIDDEN", "nope"))).toBe(t("store2.errors.forbidden"));
    expect(buyErrorText(t, server("INTERNAL_SERVER_ERROR", "boom"))).not.toBe("boom");
  });
});
