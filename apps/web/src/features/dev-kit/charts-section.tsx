/**
 * Charts section of the dev kit (/__ui). Loaded with `lazy()` from
 * kit-page.tsx, the same way analytics screens load the chart kit: it must
 * never be in the entry chunk. Demo data shaped like the plant's own (kg in
 * en-IN, IST buckets). Copy is hard-coded English like the rest of the kit;
 * the chart chrome (Show table, Legend, Other, movement words) is @orrn/i18n.
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import {
  BarChart,
  ChartCard,
  RankedBars,
  Sparkline,
  TimeSeriesChart,
  barTable,
  chartDateFormat,
  foldToOther,
  rankedTable,
  timeSeriesTable,
  type BarDatum,
  type RankedRow,
  type TimeSeries,
} from "@orrn/ui/charts";
import { ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

const kg = (v: number) => `${formatKgTotal(v)} kg`;

/** Midnight IST for a calendar date. */
const ist = (y: number, m: number, d: number) =>
  new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+05:30`);

/** Deterministic noise so screenshots and tests are stable. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/* Monthly kg dispatched, Oct 2025 to Sep 2026, then October so far (today is 3 Oct). */
const MONTHLY_KG = [148_320.5, 156_910, 139_480.2, 162_775.8, 171_240, 184_905.4, 158_630, 149_215.6, 166_480, 175_912.3, 181_045, 192_370.8];
const OCTOBER_SO_FAR = 17_640.2;
const MONTHS = [...MONTHLY_KG, OCTOBER_SO_FAR].map((v, i) => {
  const month = ((9 + i) % 12) + 1;
  const year = i < 3 ? 2025 : 2026;
  return { t: ist(year, month, 1), v, partial: i === MONTHLY_KG.length };
});

/* 90 days of packed vs dispatched, 6 Jul to today (3 Oct 2026, still open). */
const TREND: TimeSeries[] = (() => {
  const rand = noise(42);
  const packed: TimeSeries["points"] = [];
  const dispatched: TimeSeries["points"] = [];
  const start = ist(2026, 7, 6).getTime();
  for (let i = 0; i < 90; i++) {
    const t = new Date(start + i * 86_400_000);
    const base = 6400 + 900 * Math.sin(i / 9) + i * 14;
    packed.push({ t, v: Math.round((base + rand() * 900 - 450) * 10) / 10 });
    // Dispatch lags packing by a few days and swings with trucks.
    const lagged = 6400 + 900 * Math.sin((i - 4) / 9) + i * 14;
    dispatched.push({ t, v: Math.round(lagged * (0.86 + rand() * 0.24) * 10) / 10 });
  }
  // Today is half a shift in: both buckets are partial, so far.
  Object.assign(packed[packed.length - 1]!, { v: 3_420.6, partial: true });
  Object.assign(dispatched[dispatched.length - 1]!, { v: 2_105, partial: true });
  return [
    { key: "packed", label: "Packed", points: packed },
    { key: "dispatched", label: "Dispatched", points: dispatched },
  ];
})();

/* Weekly kg packed per press, 12 weeks: the colour-follows-key demo. */
const PRESS_DOMAIN = ["press-1", "press-2", "press-3"];
const PRESSES: TimeSeries[] = (() => {
  const rand = noise(5);
  const start = ist(2026, 7, 13).getTime();
  return [
    { key: "press-1", label: "Press 1", base: 15_200 },
    { key: "press-2", label: "Press 2", base: 11_400 },
    { key: "press-3", label: "Press 3", base: 6_900 },
  ].map((p) => ({
    key: p.key,
    label: p.label,
    points: Array.from({ length: 12 }, (_, i) => ({
      t: new Date(start + i * 7 * 86_400_000),
      v: Math.round(p.base * (0.88 + rand() * 0.24) * 10) / 10,
    })),
  }));
})();

const CUSTOMERS: Record<"month" | "quarter" | "year", RankedRow[]> = (() => {
  // Kutch Facade has no previous-period figure: movement unknown, not "Same".
  const base: { key: string; label: string; kg: number; movement?: number | null }[] = [
    { key: "c-sga", label: "Shree Ganesh Aluminium", kg: 28_460.5, movement: 2 },
    { key: "c-kde", label: "KD Extrusion Private Limited, Rajkot", kg: 24_105, movement: 0 },
    { key: "c-pwd", label: "Patel Windows and Doors", kg: 19_870.2, movement: -1 },
    { key: "c-mga", label: "Mahadev Glass and Aluminium Works, Morbi", kg: 15_342.8, movement: null },
    { key: "c-osf", label: "Om Sai Fabricators", kg: 12_910, movement: 1 },
    { key: "c-jat", label: "Jay Ambe Traders", kg: 9_688.4, movement: -2 },
    { key: "c-rhm", label: "Rajkot Hardware Mart", kg: 8_215, movement: 0 },
    { key: "c-kfs", label: "Kutch Facade Systems", kg: 6_930.6 },
    { key: "c-svs", label: "Sai Vijay Steel and Aluminium", kg: 4_120, movement: -1 },
    { key: "c-bhs", label: "Bhavani Sales", kg: 3_310.5, movement: 0 },
    { key: "c-amt", label: "Ambika Metal Traders", kg: 2_205, movement: 1 },
  ];
  const build = (scale: number, jitter: number) => {
    const rand = noise(jitter);
    const rows = base
      .map((c) => ({ ...c, value: Math.round(c.kg * scale * (0.85 + rand() * 0.3) * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      share: (r.value / total) * 100,
      movement: r.movement,
    }));
  };
  return { month: build(1, 7), quarter: build(3.1, 11), year: build(11.6, 23) };
})();

const AGEING: BarDatum[] = [
  { key: "0-15", label: "0-15 days", short: "0-15", value: 18_412.6 },
  { key: "16-30", label: "16-30 days", short: "16-30", value: 9_650.2 },
  { key: "31-60", label: "31-60 days", short: "31-60", value: 6_118.9 },
  { key: "60+", label: "60+ days", short: "60+", value: 3_871.4 },
];

export default function ChartsSection() {
  const { t, locale } = useT();
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");

  const monthDates = useMemo(() => chartDateFormat("month", locale), [locale]);
  const dayDates = useMemo(() => chartDateFormat("day", locale), [locale]);
  const volume: BarDatum[] = useMemo(
    () =>
      MONTHS.map((m) => ({
        key: m.t.toISOString(),
        label: monthDates.long(m.t),
        short: monthDates.short(m.t),
        value: m.v,
        partial: m.partial,
      })),
    [monthDates],
  );
  const leaders = foldToOther(CUSTOMERS[period], 8);
  const [presses, setPresses] = useState<"all" | "without-1">("all");
  const pressSeries = presses === "all" ? PRESSES : PRESSES.slice(1);
  const weekDates = useMemo(() => chartDateFormat("day", locale), [locale]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <ChartCard
          data-testid="chart-volume"
          title="Dispatch volume"
          subtitle="kg dispatched per month, last 12 months and October so far"
          table={barTable(volume, { t, format: kg, labelHeader: "Month", valueHeader: "Dispatched" })}
        >
          <BarChart data={volume} format={kg} label="Dispatch volume, kg per month" />
        </ChartCard>

        <ChartCard
          data-testid="chart-leaders"
          title="Who is leading"
          subtitle="kg dispatched per customer, top 8 and the rest"
          controls={
            <SegmentedControl
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "month", label: "This month" },
                { value: "quarter", label: "Quarter" },
                { value: "year", label: "Year" },
              ]}
            />
          }
          table={rankedTable(leaders.rows, {
            t,
            format: kg,
            valueHeader: "Dispatched",
            other: leaders.other,
            otherLabel: "Other customers",
          })}
        >
          <RankedBars
            rows={leaders.rows}
            other={leaders.other}
            otherLabel="Other customers"
            format={kg}
            label="Customers by kg dispatched"
          />
        </ChartCard>

        <ChartCard
          data-testid="chart-trend"
          className="md:col-span-2"
          title="Packed and dispatched"
          subtitle="kg per day, last 90 days, today so far"
          legend={{ series: TREND, shape: "line" }}
          table={timeSeriesTable(TREND, { t, format: kg, formatDate: dayDates.long, dateHeader: "Date" })}
        >
          <TimeSeriesChart series={TREND} kind="line" format={kg} formatDate={dayDates} height={260} label="Packed and dispatched, kg per day" />
        </ChartCard>

        <ChartCard
          data-testid="chart-ageing"
          title="Stock age"
          subtitle="kg in stock by days since packing"
          table={barTable(AGEING, { t, format: kg, labelHeader: "Age", valueHeader: "In stock" })}
        >
          <BarChart data={AGEING} format={kg} ordinal label="Stock age, kg by days since packing" />
        </ChartCard>

        <div data-testid="chart-spark" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
          <span className="text-[14px] font-semibold">Dispatched in September</span>
          <span data-no-truncate="" className="font-mono text-[34px] leading-none font-semibold tracking-[-0.02em]">
            {formatKgTotal(MONTHLY_KG[11]!)}
            <span className="ml-1.5 font-sans text-[15px] font-medium text-muted-foreground">kg</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-tone-green-ink">
            <ArrowUp aria-hidden="true" className="size-3.5" strokeWidth={2} />
            Up 6.3% on August
          </span>
          <Sparkline points={MONTHLY_KG} label="Dispatched, last 12 months" unit="kg" />
        </div>

        <ChartCard
          data-testid="chart-presses"
          className="md:col-span-2"
          title="Packed by press"
          subtitle="kg packed per week, last 12 weeks"
          controls={
            <SegmentedControl
              label="Presses"
              value={presses}
              onChange={setPresses}
              options={[
                { value: "all", label: "All presses" },
                { value: "without-1", label: "Presses 2 and 3" },
              ]}
            />
          }
          legend={{ series: pressSeries, colorDomain: PRESS_DOMAIN, shape: "line" }}
          table={timeSeriesTable(pressSeries, { t, format: kg, formatDate: weekDates.long, dateHeader: "Week of" })}
        >
          <TimeSeriesChart
            series={pressSeries}
            colorDomain={PRESS_DOMAIN}
            kind="line"
            format={kg}
            formatDate={weekDates}
            label="Packed by press, kg per week"
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ChartCard data-testid="chart-loading" title="Loading" subtitle="Holds the plot's shape" state="loading" plotHeight={160} table={{ columns: [], rows: [] }}>
          {null}
        </ChartCard>
        <ChartCard data-testid="chart-empty" title="Empty" subtitle="Nothing dispatched yet" state="empty" table={{ columns: [], rows: [] }}>
          {null}
        </ChartCard>
        <ChartCard
          data-testid="chart-error"
          title="Error"
          subtitle="The request failed"
          state="error"
          onRetry={() => {}}
          table={{ columns: [], rows: [] }}
        >
          {null}
        </ChartCard>
      </div>
    </div>
  );
}
