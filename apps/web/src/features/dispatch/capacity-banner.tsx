import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { AlertTriangle, Truck } from "lucide-react";

import type { CapacityReport } from "@/features/scan/scan-outcome";

/**
 * How full the truck is (FP-PK-12), from the server's check: quiet while there is room, amber from 95 %
 * ("near"), red once loaded kg pass the capacity ("over"). It only warns: an over-capacity load still
 * goes, with a reason when it is dispatched. Nothing shows when the dispatch has no capacity set.
 */
export function CapacityBanner({ capacity, compact = false }: { capacity: CapacityReport | null | undefined; compact?: boolean }) {
  const { t } = useT();
  if (!capacity || capacity.state === "none" || capacity.capacityG == null) return null;
  const loaded = formatKgTotal(gToKg(capacity.loadedG));
  const cap = formatKgTotal(gToKg(capacity.capacityG));
  const pct = Math.min(100, Math.round((capacity.fillBp ?? 0) / 100));
  const over = capacity.state === "over";
  const near = capacity.state === "near";
  const headline = over
    ? t("dispatch.capacity.over", { kg: formatKgTotal(gToKg(capacity.overG)) })
    : near
      ? t("dispatch.capacity.near")
      : t("dispatch.capacity.fill", { pct });
  const Icon = over || near ? AlertTriangle : Truck;
  return (
    <div
      role="status"
      data-slot="capacity-banner"
      data-testid="capacity-banner"
      data-state={capacity.state}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-card border px-4 py-2.5",
        over && "border-transparent bg-tone-red-tint text-tone-red-ink",
        near && "border-transparent bg-tone-amber-tint text-tone-amber-ink",
        !over && !near && "border-border bg-card text-foreground",
      )}
    >
      <p className={cn("m-0 flex min-w-0 items-start gap-2 leading-6 font-semibold", compact ? "text-[14px]" : "text-[15px]")}>
        <Icon aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0" />
        <span className="min-w-0 break-words">{headline}</span>
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[14px] font-semibold tabular-nums" data-no-truncate="">
          {t("dispatch.capacity.loaded", { loaded, capacity: cap })}
        </span>
        <div
          role="presentation"
          className={cn("h-1.5 min-w-[96px] flex-1 overflow-hidden rounded-full", over || near ? "bg-black/10" : "bg-surface-sunken")}
        >
          <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
