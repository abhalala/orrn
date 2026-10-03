# @orrn/ui/charts

The chart kit for owner and manager screens (analytics addendum A2, A3). SVG plus d3-scale, d3-shape and d3-array, built on the C2 tokens and the dataviz skill's rules.

## Rules for screens

- **Every chart sits in a `ChartCard`.** The card's "Show table" view is the fallback for the categorical colours under 3:1 (slot 7 on white; slots 3, 7 and 8 on the canvas) and for end labels that are dropped on phones. Never mount `TimeSeriesChart`, `BarChart` or `RankedBars` on their own.
- **Build the table with the builders** (`timeSeriesTable`, `barTable`, `rankedTable`). Pass them the same data and the same `format` as the chart, so the two never disagree.
- **Build the legend from the series:** `legend={{ series, colorDomain }}`. Colour comes from the series key through `assignSeriesSlots` and never from a position. Pass the same `colorDomain` to the chart when a filter can hide series, so the series that remain keep their colours.
- **Mark an open period with `partial: true`** on the last point or bar (today, this month). It is drawn as provisional and reads "so far" in the tooltip, the accessible name and the table.
- **One unit per axis.** The default tick labels come from `formatAxisTicksIN` (`0, 0.5L, 1L`). To override them, pass `formatTicks(ticks)`, which receives the whole axis.
- **Load lazily.** Import the kit only from routes that are loaded lazily. `apps/web/scripts/check-modulepreload.ts` fails the build if the kit (the `data-chart-kit` marker) or d3 code appears in the entry chunk.
- **Gate it** with `<Can do="analytics.view">`. Charts are for owners and managers, not floor roles.
- A card's `controls` slot is only for a control that scopes nothing outside the card. A period that also scopes a list goes in one row above both.

## Pieces

| Export | Use |
|---|---|
| `ChartCard` | Title, subtitle, table toggle, legend, and the loading, empty, error and refreshing states |
| `TimeSeriesChart` | Line or area over time, 1 to 8 series, crosshair, roving keyboard focus |
| `BarChart` | Vertical bars, one series, or the ordinal ramp for ordered buckets |
| `RankedBars` | Leaderboard on one scale, top N plus Other, share and movement in words |
| `Sparkline` | Trend line for a stat tile, with an accessible summary (pass `unit`) |
| `seriesColor`, `seriesLegend`, `assignSeriesSlots`, `foldToOther` | Colour and series helpers |

Palette values live in `../tokens.ts` (`chartCategorical`, `chartSequential`, `chartOrdinal`, `chartChrome`). They are validated by `palette.test.ts` with the vendored `scripts/validate_palette.js`.
