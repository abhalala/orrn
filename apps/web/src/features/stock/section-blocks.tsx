import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { Chip } from "@orrn/ui/components/chip";
import { riseDelay } from "@orrn/ui/components/motion";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatKgBand } from "./format";
import { sectionLabel, type SectionStock } from "./sections";

const GRID = "m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-4";
/** Rise only the first screenful on first load; the rest appear still. */
const RISE_LIMIT = 8;

/**
 * One section's stock as a C2 colour block (spec §3 Stock): green with the
 * number of bundles in stock, or blue when every bundle of the section is
 * held. The meta carries the kg, the die's kg/12ft band and the held count
 * as a blue chip. The status is always in words too ("in stock", "held").
 */
export function SectionBlock({ section, rise }: { section: SectionStock; rise?: number }) {
  const { t } = useT();
  const allHeld = section.available.bundles === 0 && section.held.bundles > 0;
  const shown = allHeld ? section.held : section.available;
  const band = formatKgBand(section.weightMinG, section.weightMaxG);
  const kg = formatKgTotal(gToKg(section.available.weightG + (allHeld ? section.held.weightG : 0)));

  return (
    <Link
      to="/stock/$dieId"
      params={{ dieId: section.dieId }}
      data-testid="section-block"
      data-die-id={section.dieId}
      data-tone={allHeld ? "blue" : "green"}
      className={cn(
        "orrn-block orrn-block-sheen animate-press flex h-full min-h-[164px] min-w-0 flex-col p-4 text-left no-underline transition-[filter,scale] duration-[var(--dur-fast)] hover:brightness-[1.04] sm:p-[18px]",
        allHeld ? "orrn-block-blue" : "orrn-block-green",
        rise !== undefined && "animate-rise",
      )}
      style={rise !== undefined ? riseDelay(rise) : undefined}
    >
      <span className="relative flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[17px] font-bold leading-tight tracking-[-0.02em] break-words">
            {sectionLabel(section)}
          </span>
          {section.name ? (
            <span className="mt-0.5 block text-[13px] font-medium leading-snug break-words">{section.name}</span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" strokeWidth={2} className="-mr-1 size-5 shrink-0" />
      </span>

      <span className="relative mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-4">
        <BigNumber value={shown.bundles} className="text-[40px] sm:text-[44px]" />
        <span className="min-w-0 text-[13px] font-semibold break-words">
          {t(allHeld ? "stock.block.unitHeld" : "stock.block.unitInStock", { count: shown.bundles })}
        </span>
      </span>

      <span className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-medium leading-snug">
        <span className="font-mono tabular-nums">{t("stock.block.kg", { kg })}</span>
        {band ? <span className="tabular-nums">{t("stock.block.band", { band })}</span> : null}
        {!allHeld && section.held.bundles > 0 ? (
          <Chip tone="blue">{t("stock.heldChip", { count: section.held.bundles })}</Chip>
        ) : null}
      </span>
    </Link>
  );
}

/** The sections grid. Blocks rise in once, the first time stock arrives. */
export function SectionGrid({ sections, label }: { sections: readonly SectionStock[]; label: string }) {
  const firstPaint = useRef(true);
  const rising = firstPaint.current;
  useEffect(() => {
    if (sections.length > 0) firstPaint.current = false;
  }, [sections.length]);

  return (
    <ul aria-label={label} className={GRID} data-testid="section-grid">
      {sections.map((s, i) => (
        <li key={s.dieId} className="min-w-0">
          <SectionBlock section={s} rise={rising && i < RISE_LIMIT ? i : undefined} />
        </li>
      ))}
    </ul>
  );
}

/** Loading: the grid's shape, so nothing jumps when stock arrives. */
export function SectionGridSkeleton() {
  return (
    <ul aria-hidden="true" className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i}>
          <Skeleton className="h-[164px] w-full rounded-block" />
        </li>
      ))}
    </ul>
  );
}
