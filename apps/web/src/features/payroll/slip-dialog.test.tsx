import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import { slipFigures } from "./fixtures";
import { SlipBody } from "./slip-dialog";

const render = (locale: "en" | "hi" | "gu") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <SlipBody figures={slipFigures({ basic: 20_000_00, overtimeMin: 90, deductions: [{ code: "tds", paise: 300_00 }], lopHalves: 2 })} />
    </I18nProvider>,
  );

describe("the payslip body", () => {
  test("names every line, explains EPF in words and shows the net", () => {
    const html = render("en");
    expect(html).toContain("Earnings");
    expect(html).toContain("Income tax (TDS)");
    expect(html).toContain("EPF 12% of 15,000, the wage ceiling");
    expect(html).toContain("1 days without pay");
    expect(html).toContain("Net pay");
    expect(html).toContain("November 2026");
  });
  test("reads in Hindi and in Gujarati", () => {
    expect(render("hi")).toContain("कमाई");
    expect(render("gu")).toContain("કમાણી");
  });
});
