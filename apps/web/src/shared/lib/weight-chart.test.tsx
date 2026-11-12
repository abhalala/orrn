/**
 * Weight charts plot the plant's unit (review recheck). A lb plant used to read a 22,046 lb bar against a "10K" gridline,
 * and a lakh label on an international plant.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatterFor, screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

import { FmtProvider } from "@/shared/lib/fmt";

// A server render has no measured width, and the chart draws nothing at width 0. Give it one, so the axis is in the markup.
mock.module(new URL("../../../../../packages/ui/src/charts/use-chart-width.ts", import.meta.url).pathname, () => ({
  useChartWidth: () => [{ current: null }, 640] as const,
}));
const { BarChart } = await import("@orrn/ui/charts");
const { formatAxisTicksIntl, useWeightChart, weightChart } = await import("./weight-chart");

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (p: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(p), IST);
const SUFFIX = { thousand: "k", lakh: "L", crore: "Cr", million: "M" };

function Chart({ kg }: { kg: number[] }) {
  const wc = useWeightChart();
  const data = kg.map((v, i) => ({ key: `m${i}`, label: `Month ${i}`, short: `M${i}`, value: wc.value(v) }));
  return <BarChart data={data} format={(v) => wc.text(v)} formatTicks={wc.ticks} ordinal label="Weight by month" />;
}
const ticksOf = (prefs: Parameters<typeof screenPrefs>[0], kg: number[]) => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={screenPrefs(prefs)} timeZone="Asia/Kolkata">
        <Chart kg={kg} />
      </FmtProvider>
    </I18nProvider>,
  );
  return { html, ticks: [...html.matchAll(/data-slot="chart-y-tick"[^>]*>([^<]*)</g)].map((m) => m[1]!) };
};

describe("a weight chart on a pound plant, international grouping", () => {
  const prefs = { units: { mass: "lb" }, number: { grouping: "international" } } as const;
  test("10,000 kg is plotted as 22,046 lb and the axis ends at a lb number, not 10K", () => {
    const { ticks } = ticksOf(prefs, [10_000]);
    expect(ticks.length).toBeGreaterThan(1);
    // 22,046 lb needs a top gridline above it; before, the top gridline was "10k" under a 22,046 lb bar
    expect(ticks.at(-1)).not.toBe("10k");
    expect(ticks.at(-1)).toMatch(/^2[5-9](\.\d)?k$|^[3-9]\d(\.\d)?k$/);
    expect(ticks.some((v) => v.includes("L"))).toBe(false);
  });
  test("the bar label is the same weight in lb", () => {
    expect(ticksOf(prefs, [10_000]).html).toContain("22,046.2 lb");
  });
  test("a quarter of a million kg reads K or M, never lakh", () => {
    const { ticks } = ticksOf(prefs, [250_000]);
    expect(ticks.some((v) => v.includes("L") || v.includes("Cr"))).toBe(false);
    expect(ticks.at(-1)).toMatch(/M$|k$/);
  });
});

describe("a plant that changed nothing keeps its chart", () => {
  test("kg values are plotted untouched and the axis is the Indian K, L, Cr axis", () => {
    const wc = weightChart(fmtOf(), SUFFIX, "en");
    expect(wc.value(12.3)).toBe(12.3);
    expect(wc.text(12.3)).toBe("12.3 kg");
    expect(wc.text(0, true)).toBe("0 kg");
    expect(wc.ticks([0, 50_000, 100_000, 150_000, 200_000])).toEqual(["0", "0.5L", "1L", "1.5L", "2L"]);
    expect(ticksOf({}, [10_000]).ticks).toContain("10k");
  });
});

describe("a tonne plant", () => {
  test("10,000 kg is 10 t on the plot", () => {
    const wc = weightChart(fmtOf({ units: { mass: "t" } }), SUFFIX, "en");
    expect(wc.value(10_000)).toBeCloseTo(10, 6);
    expect(wc.text(10)).toContain("t");
  });
});

describe("international axis labels", () => {
  test("K below a million, M from a million, trailing zeros dropped", () => {
    expect(formatAxisTicksIntl([0, 500, 1000], SUFFIX)).toEqual(["0", "0.5k", "1k"]);
    expect(formatAxisTicksIntl([0, 1_000_000, 2_500_000], SUFFIX)).toEqual(["0", "1M", "2.5M"]);
    expect(formatAxisTicksIntl([0, 20, 40], SUFFIX)).toEqual(["0", "20", "40"]);
  });
});
