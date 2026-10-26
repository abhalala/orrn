import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";

import { unitShort } from "./store-labels";
import { formatQty } from "./store-qty";

/** A balance at reading size: the number in Bricolage like every C2 big number, the unit beside it. Never truncated. */
export function BigQty({ milli, unit, className }: { milli: number; unit: string; className?: string }) {
  const { t } = useT();
  return (
    <p data-no-truncate="" className={cn("m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className="font-display text-[40px] font-extrabold leading-[0.95] tracking-[-0.04em] tabular-nums [overflow-wrap:anywhere]">
        {formatQty(milli)}
      </span>
      <span className="text-[15px] font-semibold text-muted-foreground">{unitShort(t, unit, Math.abs(milli))}</span>
    </p>
  );
}
