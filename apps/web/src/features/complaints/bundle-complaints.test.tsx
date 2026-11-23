import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

const { ComplaintRows } = await import("./bundle-complaints");

const rows = [
  { id: "c1", number: "CMP/26-27/0002", period: "26-27", status: "replied", kind: "surface", createdAt: 1_700_000_000_000 },
  { id: "c2", number: "CMP/26-27/0001", period: "26-27", status: "closed", kind: "short_supply", createdAt: 1_690_000_000_000 },
];

function render(list: typeof rows, locale: "en" | "hi" = "en") {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ComplaintRows rows={list} when={(at) => `at-${at}`} />
    </I18nProvider>,
  );
}

describe("the complaints card on a bundle", () => {
  test("lists each complaint with its link, problem, date and status word", () => {
    const html = render(rows);
    expect(html).toContain('href="/complaints/c1"');
    expect(html).toContain("CMP/26-27/0002");
    expect(html).toContain("Surface");
    expect(html).toContain("Short supply");
    expect(html).toContain("Replied");
    expect(html).toContain("Closed");
    expect(html).toContain("at-1700000000000");
  });
  test("says so when the bundle has no complaint", () => {
    expect(render([])).toContain("No complaints on this bundle.");
  });
  test("reads in Hindi", () => {
    expect(render(rows, "hi")).toContain("जवाब दिया");
  });
});
