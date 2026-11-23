import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

const { MaintTodayBlocks } = await import("./today-tile");

const data = { overdue: 2, soon: 1, liveWorkOrders: 3, flaggedReadings: 0 };

describe("maintenance Today tile", () => {
  test("English: four figures linking into maintenance", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <MaintTodayBlocks data={data} />
      </I18nProvider>,
    );
    expect(html).toContain("Plans overdue");
    expect(html).toContain("Open work orders");
    expect(html).toContain("/maintenance/work-orders");
    expect(html).toContain(">3<");
  });
  test("Hindi words", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="hi">
        <MaintTodayBlocks data={data} />
      </I18nProvider>,
    );
    expect(html).toContain("देर वाले प्लान");
    expect(html).not.toContain("Plans overdue");
  });
});
