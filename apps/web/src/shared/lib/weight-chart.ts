/**
 * Weight charts in the plant's unit. Charts used to plot kg and write the plant's unit word on the labels, so a lb plant
 * read a 22,046 lb bar against a "10K" gridline. Now the plotted values are the plant's unit, so the gridlines are nice
 * numbers of that unit; the labels and the axis follow the plant's number grouping (K, L and Cr, or K and M).
 *
 * Kept out of `fmt-text.ts`: only the lazy chart screens import it, so the `/` closure does not carry the unit table.
 */
import { convertStorage, formatAxisTicksIN, type Fmt, type UnitId } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMemo } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { kgChartText } from "@/shared/lib/fmt-text";

export type AxisSuffixes = { thousand: string; lakh: string; crore: string; million: string };

export type WeightChart = {
  /** A weight in kg as the plotted value: the same weight in the plant's unit. */
  value(kg: number): number;
  /** The label of a plotted value: "22,046.2 lb"; `zeroPlain` writes an empty bucket as "0 lb". */
  text(plotted: number, zeroPlain?: boolean): string;
  /** The y axis labels for plotted ticks. */
  ticks(ticks: number[]): string[];
};

/** Units of `unit` in one gram, to nine digits (the registry converts whole steps; 1e9 g keeps the ratio exact enough to plot). */
function perGram(unit: UnitId): number {
  return convertStorage(1_000_000_000, "g", unit).value / 1_000_000_000;
}

/** Axis labels with K and M, for a plant whose grouping is international (or none): one unit for the whole axis. */
export function formatAxisTicksIntl(ticks: readonly number[], suffixes: Pick<AxisSuffixes, "thousand" | "million">): string[] {
  if (ticks.length === 0) return [];
  const maxAbs = Math.max(...ticks.map((v) => Math.abs(v)));
  const unit = maxAbs >= 1_000_000 ? { size: 1_000_000, suffix: suffixes.million } : maxAbs >= 1_000 ? { size: 1_000, suffix: suffixes.thousand } : { size: 1, suffix: "" };
  const scaled = ticks.map((v) => v / unit.size);
  let decimals = 0;
  while (decimals < 2 && scaled.some((v) => Math.abs(Number(v.toFixed(decimals)) - v) > 1e-9)) decimals++;
  const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, numberingSystem: "latn" });
  return scaled.map((v) => (v === 0 ? "0" : `${nf.format(v)}${unit.suffix}`));
}

export function weightChart(fmt: Fmt, suffixes: AxisSuffixes, locale: string): WeightChart {
  const unit = fmt.unitOf("mass");
  // A plant on kg plots the kg it always did, with no arithmetic at all.
  const factor = unit.id === "kg" ? null : perGram(unit.id);
  return {
    value: (kg) => (factor === null ? kg : kg * 1000 * factor),
    text: (plotted, zeroPlain = false) => kgChartText(fmt, factor === null ? plotted : plotted / factor / 1000, zeroPlain),
    ticks: (ticks) =>
      fmt.style.grouping === "indian"
        ? formatAxisTicksIN(ticks, locale, { thousand: suffixes.thousand, lakh: suffixes.lakh, crore: suffixes.crore })
        : formatAxisTicksIntl(ticks, suffixes),
  };
}

export function useWeightChart(): WeightChart {
  const fmt = useFmt();
  const { t, locale } = useT();
  const thousand = t("charts.unitThousand");
  const lakh = t("charts.unitLakh");
  const crore = t("charts.unitCrore");
  const million = t("charts.unitMillion");
  return useMemo(() => weightChart(fmt, { thousand, lakh, crore, million }, locale), [fmt, thousand, lakh, crore, million, locale]);
}
