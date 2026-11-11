import { describe, expect, test } from "bun:test";

import { blankForm } from "../features/foundry/melt-form";
import { hasValidDigitGrouping, phoneMeltInputOf } from "../features/foundry/phone-quantities";

const ctx = { castId: "cast-1", timeZone: "Asia/Kolkata" };

describe("phone chemical and dip commas", () => {
  test("correct digit grouping is accepted, including Indian grouping and a decimal point", () => {
    for (const text of ["1,000", "1,00,000", "12,345.5", "1,23,456.78", "1000", "2.5"]) {
      expect({ text, valid: hasValidDigitGrouping(text) }).toEqual({ text, valid: true });
    }
  });

  test("a decimal comma or broken grouping is refused", () => {
    for (const text of ["2,5", "4,50", "1,2,3", "12,34.5", "1,000,00"]) {
      expect({ text, valid: hasValidDigitGrouping(text) }).toEqual({ text, valid: false });
    }
  });

  test("the editor does not save Used 2,5 as 25 kg", () => {
    const form = blankForm("2026-11-11");
    form.chemicals = [{ key: "c", storeItemId: "flux", name: "", unit: "", openText: "100", usedText: "2,5", closeText: "" }];
    let requests = 0;
    const result = phoneMeltInputOf(form, ctx);
    if (result.ok) requests++;
    expect(result).toEqual({ ok: false, issue: { code: "chemical", step: "chemicals", line: 0 } });
    expect(requests).toBe(0);
  });

  test("the editor does not save a dip of 4,5 as 45 inches", () => {
    const form = blankForm("2026-11-11");
    form.ldo.start = "4,5";
    let requests = 0;
    const result = phoneMeltInputOf(form, ctx);
    if (result.ok) requests++;
    expect(result).toEqual({ ok: false, issue: { code: "ldo", step: "chemicals" } });
    expect(requests).toBe(0);
  });

  test("grouped quantities still save through the shared parser, and 240 inches is allowed", () => {
    const form = blankForm("2026-11-11");
    form.chemicals = [{ key: "c", storeItemId: "flux", name: "", unit: "", openText: "20,000", usedText: "1,000", closeText: "" }];
    form.ldo.start = "240";
    const result = phoneMeltInputOf(form, ctx);
    if (!result.ok) throw new Error("grouped quantities should save");
    expect(result.input.chemicals).toEqual([{ storeItemId: "flux", openMilli: 20_000_000, usedMilli: 1_000_000, closeMilli: 19_000_000 }]);
    expect(result.input.ldoTenthIn.start).toBe(2400);
  });
});
