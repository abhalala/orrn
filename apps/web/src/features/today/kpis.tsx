import type { StatusTone } from "@orrn/domain";
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { riseDelay } from "@orrn/ui/components/motion";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useId } from "react";

import { formatCount, inStock, type TodayData } from "./today-model";

type KpiBlockProps = {
  testId: string;
  tone: Exclude<StatusTone, "neutral">;
  title: string;
  value: number;
  format: (n: number) => string;
  unit: string;
  /** Second fact in the block, one short line ("48 bundles"). */
  meta: string;
  hero?: boolean;
  index: number;
};

/**
 * One KPI as a C2 status block: title, a big Bricolage number that counts up
 * once (off under reduced motion), its unit, and one supporting fact. The
 * number is sized by the block's own width (container query units), so a
 * five-figure kg never spills out of a narrow block: the pair blocks on a
 * phone (about 165 px wide) go down to 26 px, the hero up to 52 px.
 * Text uses the tone's `on` colour at full strength (>= 4.5:1 against the
 * lighter gradient stop, tokens.test.ts).
 */
function KpiBlock({ testId, tone, title, value, format, unit, meta, hero = false, index }: KpiBlockProps) {
  return (
    <li
      data-testid={testId}
      data-tone={tone}
      style={riseDelay(index)}
      className={cn(
        "orrn-block orrn-block-sheen animate-rise @container flex min-w-0 flex-col sm:min-h-[188px] sm:p-5",
        `orrn-block-${tone}`,
        hero ? "orrn-block-hero col-span-2 min-h-[168px] p-[18px]" : "min-h-[132px] p-4",
      )}
    >
      <p className="relative m-0 font-display text-[17px] leading-tight font-bold tracking-[-0.02em] break-words">
        {title}
      </p>
      <p className="relative m-0 mt-auto flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 pt-4 sm:pt-5">
        <BigNumber value={value} format={format} countUp className="text-[clamp(26px,17cqi,52px)]" />
        <span className="text-[15px] leading-5 font-semibold break-words">{unit}</span>
      </p>
      <p className="relative m-0 mt-1.5 text-[15px] leading-5 font-semibold break-words">{meta}</p>
    </li>
  );
}

/**
 * KPI grid: the hero (packed today) always takes a full row of two, with
 * dispatched and in stock side by side under it, on a phone too. Four
 * columns (hero spans two) only once the CONTENT column is about 900 px
 * wide: the sidebar takes 272 px from a 1024 px viewport, so viewport
 * breakpoints squeezed the row at 1024-1279.
 */
const KPI_GRID = "m-0 grid list-none grid-cols-2 gap-3 p-0 @[56rem]:grid-cols-4";

/**
 * Today's numbers (spec §3 Today): kg and bundles packed today (one block),
 * kg dispatched today, and what is in stock now (bundles and kg). Void
 * bundles are never counted as packed (ruling RP11, server side).
 */
export function TodayKpis({ data }: { data: TodayData }) {
  const { t } = useT();
  const headingId = useId();
  const stock = inStock(data.stock);
  const packedBundles = data.packedToday.bundles;
  const dispatches = data.dispatchedToday.dispatches;

  return (
    <section aria-labelledby={headingId} data-testid="today-numbers" className="@container min-w-0">
      <h2 id={headingId} className="sr-only">
        {t("today.numbersHeading")}
      </h2>
      <ul className={KPI_GRID}>
        <KpiBlock
          testId="kpi-packed"
          tone="blue"
          hero
          index={0}
          title={t("today.packed")}
          value={data.packedToday.weightG / 1000}
          format={formatKgTotal}
          unit={t("units.kg")}
          meta={packedBundles > 0 ? t("units.bundles", { count: formatCount(packedBundles) }) : t("today.nothingPackedYet")}
        />
        <KpiBlock
          testId="kpi-dispatched"
          tone="red"
          index={1}
          title={t("today.dispatched")}
          value={data.dispatchedToday.weightG / 1000}
          format={formatKgTotal}
          unit={t("units.kg")}
          meta={dispatches > 0 ? t("today.dispatchesDone", { count: formatCount(dispatches) }) : t("today.noDispatchYet")}
        />
        <KpiBlock
          testId="kpi-stock"
          tone="green"
          index={2}
          title={t("today.inStock")}
          value={stock.bundles}
          format={formatCount}
          unit={t("today.bundleUnit", { count: stock.bundles })}
          meta={t("today.inStockKg", { kg: formatKgTotal(stock.kg) })}
        />
      </ul>
    </section>
  );
}

/** Loading shape of the KPI row: same grid, same block sizes and radii. */
export function TodayKpisSkeleton() {
  return (
    <div className="@container min-w-0">
      <div className={KPI_GRID}>
        <Skeleton className="col-span-2 min-h-[168px] rounded-hero sm:min-h-[188px]" />
        <Skeleton className="min-h-[150px] rounded-block sm:min-h-[188px]" />
        <Skeleton className="min-h-[150px] rounded-block sm:min-h-[188px]" />
      </div>
    </div>
  );
}
