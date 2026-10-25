import type { StatusTone } from "@orrn/domain";
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { riseDelay } from "@orrn/ui/components/motion";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useId } from "react";

import { formatCount, formatRupees, type TodayData } from "./today-model";

type KpiBlockProps = {
  testId: string;
  tone: Exclude<StatusTone, "neutral">;
  title: string;
  value: number;
  format: (n: number) => string;
  unit: string;
  /** Second fact in the block, one short line ("48 bundles"). */
  meta: string;
  /** Take a whole row (the dispatched-value block). */
  wide?: boolean;
  index: number;
};

/**
 * One KPI as a C2 status block: title, a big Bricolage number that counts up
 * once (off under reduced motion), its unit, and one supporting fact. The
 * number is sized by the block's own width (container query units), so a
 * five-figure kg never spills out of a narrow block: the blocks on a
 * phone (about 165 px wide) go down to 26 px.
 * Text uses the tone's `on` colour at full strength (>= 4.5:1 against the
 * lighter gradient stop, tokens.test.ts).
 */
function KpiBlock({ testId, tone, title, value, format, unit, meta, wide = false, index }: KpiBlockProps) {
  return (
    <li
      data-testid={testId}
      data-tone={tone}
      style={riseDelay(index)}
      className={cn(
        "orrn-block orrn-block-sheen animate-rise @container flex min-w-0 flex-col sm:min-h-[188px] sm:p-5",
        `orrn-block-${tone}`,
        wide ? "col-span-2 min-h-[132px] p-4 @[56rem]:col-span-4" : "min-h-[132px] p-4",
      )}
    >
      <p className="relative m-0 font-display text-[17px] leading-tight font-bold tracking-[-0.02em] break-words">
        {title}
      </p>
      <p className="relative m-0 mt-auto flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 pt-4 sm:pt-5">
        <BigNumber value={value} format={format} countUp className="text-[clamp(26px,17cqi,52px)]" />
        {unit ? <span className="text-[15px] leading-5 font-semibold break-words">{unit}</span> : null}
      </p>
      <p className="relative m-0 mt-1.5 text-[15px] leading-5 font-semibold break-words">{meta}</p>
    </li>
  );
}

/**
 * KPI grid: two by two on a phone and an iPad, one row of four once the CONTENT column is about
 * 900 px wide (the sidebar takes 272 px from a 1024 px viewport, so viewport breakpoints squeezed
 * the row at 1024-1279). The optional dispatched-value block takes its own full row.
 */
const KPI_GRID = "m-0 grid list-none grid-cols-2 gap-3 p-0 @[56rem]:grid-cols-4";

/**
 * Today's four numbers (FP-PF-15), from `dashboard.today.kpis`: kg packed and bundles packed this
 * production day, kg dispatched this production day, and what is in stock now. Every role gets
 * these, a viewer gets nothing else. Void bundles are never counted as packed (ruling RP11, server
 * side). The rate slice (`value`) shows only when the server sent it: it needs the plant's price
 * switch and the price action, and the screen never works that out itself.
 */
export function TodayKpis({ data }: { data: TodayData }) {
  const { t } = useT();
  const headingId = useId();
  const { kpis, value } = data;

  return (
    <section aria-labelledby={headingId} data-testid="today-numbers" className="@container min-w-0">
      <h2 id={headingId} className="sr-only">
        {t("today.numbersHeading")}
      </h2>
      <ul className={KPI_GRID}>
        <KpiBlock
          testId="kpi-packed"
          tone="blue"
          index={0}
          title={t("today.kpi.packed")}
          value={kpis.packedG / 1000}
          format={formatKgTotal}
          unit={t("units.kg")}
          meta={t("today.kpi.packedMeta")}
        />
        <KpiBlock
          testId="kpi-bundles"
          tone="blue"
          index={1}
          title={t("today.kpi.bundles")}
          value={kpis.packedBundles}
          format={formatCount}
          unit={t("today.bundleUnit", { count: kpis.packedBundles })}
          meta={kpis.packedBundles > 0 ? t("today.kpi.bundlesMeta") : t("today.nothingPackedYet")}
        />
        <KpiBlock
          testId="kpi-dispatched"
          tone="red"
          index={2}
          title={t("today.kpi.dispatched")}
          value={kpis.dispatchedG / 1000}
          format={formatKgTotal}
          unit={t("units.kg")}
          meta={kpis.dispatchedG > 0 ? t("today.kpi.dispatchedMeta") : t("today.noDispatchYet")}
        />
        <KpiBlock
          testId="kpi-stock"
          tone="green"
          index={3}
          title={t("today.kpi.stock")}
          value={kpis.inStockG / 1000}
          format={formatKgTotal}
          unit={t("units.kg")}
          meta={t("today.kpi.stockMeta", { count: formatCount(kpis.inStockBundles) })}
        />
        {value ? (
          <KpiBlock
            testId="kpi-value"
            tone="amber"
            index={4}
            wide
            title={t("today.kpi.value")}
            value={value.dispatchedPaise}
            format={formatRupees}
            unit=""
            meta={t("today.kpi.valueMeta", { count: formatCount(value.pricedBundles) })}
          />
        ) : null}
      </ul>
    </section>
  );
}

/** Loading shape of the KPI row: same grid, same block sizes and radii. */
export function TodayKpisSkeleton() {
  return (
    <div className="@container min-w-0">
      <div className={KPI_GRID}>
        <Skeleton className="min-h-[132px] rounded-block sm:min-h-[188px]" />
        <Skeleton className="min-h-[132px] rounded-block sm:min-h-[188px]" />
        <Skeleton className="min-h-[132px] rounded-block sm:min-h-[188px]" />
        <Skeleton className="min-h-[132px] rounded-block sm:min-h-[188px]" />
      </div>
    </div>
  );
}
