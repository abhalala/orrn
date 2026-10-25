import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";

import { stripCells, type Strip } from "../view";
import { orderKgText } from "../format";

/**
 * The eight figures of an order line, straight from the server's `strip`: ordered, planned,
 * pressed, aged, packed, in stock, dispatched, baki. Nothing is added up here. The baki cell turns
 * amber while kg are still to dispatch; kg produced past the order show as an "over" chip.
 */
export function BakiStrip({ strip, label }: { strip: Strip; label?: string }) {
  const { t } = useT();
  const cells = stripCells(strip);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dl aria-label={label ?? t("orders.strip.label")} className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4">
        {cells.map((cell) => (
          <div
            key={cell.key}
            data-strip={cell.key}
            className={cn(
              "min-w-0 rounded-card px-3 py-3",
              cell.open ? "bg-tone-amber-tint text-tone-amber-ink" : "bg-surface-sunken text-foreground",
            )}
          >
            <dt className={cn("m-0 text-xs font-medium", cell.open ? "text-tone-amber-ink" : "text-muted-foreground")}>{t(cell.labelKey)}</dt>
            <dd className="m-0 mt-1 font-mono text-[15px] font-semibold tabular-nums leading-5 break-words sm:text-base">
              {cell.kg} {t("units.kg")}
            </dd>
            {cell.pcs != null ? (
              <dd className={cn("m-0 text-[13px] tabular-nums", cell.open ? "text-tone-amber-ink" : "text-muted-foreground")}>
                {cell.pcs} {t("units.pcs")}
                {cell.bundles != null ? ` · ${t("units.bundles", { count: cell.bundles })}` : ""}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      {strip.overG > 0 ? (
        <div>
          <Chip tone="red" truncate={false}>
            {t("orders.over", { kg: orderKgText(strip.overG) })}
          </Chip>
        </div>
      ) : null}
    </div>
  );
}
