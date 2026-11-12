/**
 * The import preview writes a file's weights in the plant's unit, number and word together (review recheck).
 * It used to print formatKg(kg) under the plant's mass word, so 50 kg read "50.00 lb".
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatKg, screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { Preview } = await import("./import-sheet");

const bundle = { row: 2, data: { dieSeries: "A", dieSectionCode: "12170", quantity: 40, weightG: 50_000, lengthMm: 3658, poNumber: null } };
const die = { row: 3, data: { series: "A", sectionCode: "12170", weightMinG: 2_400, weightMaxG: 2_600 } };

const render = (prefs: ReturnType<typeof screenPrefs> | undefined, kind: "bundles" | "dies") =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
        <Preview kind={kind} unit="mm" ops={[kind === "bundles" ? bundle : die] as never} />
      </FmtProvider>
    </I18nProvider>,
  );

describe("import preview", () => {
  test("a plant that changed nothing reads what it did before", () => {
    expect(render(undefined, "bundles")).toContain("50.00 kg");
    expect(render(undefined, "dies")).toContain("2.40-2.60 kg/12ft");
    expect(formatKg(50)).toBe("50.00");
  });
  test("a pound, lb per foot plant reads the weight and the band in its own unit", () => {
    const prefs = screenPrefs({ units: { mass: "lb", linear_mass: "lb_ft" } });
    const bundles = render(prefs, "bundles");
    expect(bundles).toContain("110.23 lb");
    expect(bundles).not.toContain("50.00 lb");
    const dies = render(prefs, "dies");
    expect(dies).toContain("lb/ft");
    expect(dies).not.toContain("2.40");
    expect(dies).not.toContain("kg/12ft");
  });
  test("a tonne plant says tonnes with a tonne number", () => {
    expect(render(screenPrefs({ units: { mass: "t" } }), "bundles")).not.toContain("50.00 t");
  });
});
