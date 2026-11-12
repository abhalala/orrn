/**
 * An order line's figures in the plant's units: the baki strip of a line, server rendered. A plant that changed
 * nothing reads kg with Indian grouping; a plant on pounds with international grouping reads those; the unit word
 * in the sentences follows the number.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

import { FmtProvider } from "@/shared/lib/fmt";

import { BakiStrip } from "./components/baki-strip";
import { stripCells, type Strip } from "./view";
import { orderKgText } from "./format";

const STRIP: Strip = {
  orderedG: 123_456_000,
  orderedPcs: 4_000,
  plannedG: 100_000_000,
  pressedG: 90_000_000,
  agedG: 80_000_000,
  packedG: 70_000_000,
  inStockG: 60_000_000,
  inStockPcs: 1_200,
  bakiG: 53_456_000,
  dispatchedG: 70_000_000,
  overG: 1_500,
} as unknown as Strip;

const render = (units: Parameters<typeof screenPrefs>[0]) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={screenPrefs(units)}>
        <BakiStrip strip={STRIP} />
      </FmtProvider>
    </I18nProvider>,
  );

describe("an order line's strip", () => {
  test("a plant that changed nothing: kg, Indian grouping, as before", () => {
    const html = render({});
    expect(html).toContain("1,23,456.000 kg");
    expect(html).toContain("Over by 1.500 kg");
    expect(stripCells(STRIP).map((c) => c.kg)).toEqual(stripCells(STRIP, undefined).map((c) => c.kg));
    expect(stripCells(STRIP)[0]!.kg).toBe(orderKgText(123_456_000));
  });
  test("with the default Fmt the strip text is the old text, cell by cell", () => {
    const fmtHtml = render({});
    for (const c of stripCells(STRIP)) expect(fmtHtml).toContain(`${c.kg} kg`);
  });
  test("a plant on pounds with international grouping: the number and the unit both change", () => {
    const html = render({ units: { mass: "lb" }, number: { grouping: "international" } });
    expect(html).toContain("272,173.89 lb"); // 123,456 kg, exact: 123456 / 0.45359237
    expect(html).toContain("Over by 3.31 lb"); // 1.5 kg
    expect(html).not.toContain("1,23,456.000");
    expect(html).not.toMatch(/\d kg\b/);
  });
});
