import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

const { TodayToolingTile } = await import("./tooling-tile");

const render = (short: { type: string; held: number; min: number }[] | undefined, locale: "en" | "hi" = "en") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <TodayToolingTile short={short} />
    </I18nProvider>,
  );

describe("Today tooling tile", () => {
  test("nothing when no type is short", () => {
    expect(render([])).toBe("");
    expect(render(undefined)).toBe("");
  });
  test("one block per short type with held of min, linking to tooling", () => {
    const html = render([
      { type: "bolster", held: 1, min: 3 },
      { type: "liner", held: 0, min: 2 },
    ]);
    expect(html).toContain("Bolster");
    expect(html).toContain("Liner");
    expect(html).toContain("1 of 3");
    expect(html).toContain("0 of 2");
    expect(html).toContain('href="/masters/tooling"');
  });
  test("reads in Hindi", () => {
    expect(render([{ type: "bolster", held: 1, min: 3 }], "hi")).toContain("3 में से 1");
  });
});
