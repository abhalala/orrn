import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { ReadingTrend } = await import("./reading-trend");

// grams per 12 ft: 1.842 kg/12ft first, 1.911 last
const POINTS = [1842, 1875, 1911];
const render = (prefs: ReturnType<typeof screenPrefs> | undefined) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
        <ReadingTrend points={POINTS} label="Readings" />
      </FmtProvider>
    </I18nProvider>,
  );

describe("the die card reading trend", () => {
  test("a plant that changed nothing reads kg/12ft to three decimals, as before", () => {
    const html = render(undefined);
    expect(html).toContain("1.842 kg/12ft");
    expect(html).toContain("1.911 kg/12ft");
  });
  test("a lb per foot plant reads the same readings as the list under it, in lb/ft", () => {
    const html = render(screenPrefs({ units: { linear_mass: "lb_ft" } }));
    expect(html).toContain("lb/ft");
    expect(html).not.toContain("kg/12ft");
    expect(html).not.toContain("1.842");
  });
  test("a kg per metre plant reads kg/m", () => {
    const html = render(screenPrefs({ units: { linear_mass: "kg_m" } }));
    expect(html).toContain("kg/m");
    expect(html).not.toContain("kg/12ft");
  });
});
