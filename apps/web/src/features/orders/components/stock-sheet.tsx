import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";

import { orderKgText, pcsText } from "../format";

export type StockItem = {
  id: string;
  serial: string;
  weightG: number;
  pcs: number;
  lengthMm: number;
  allocation: "plant" | "unassigned" | "same_customer" | "other_customer";
  orderNumber: string | null;
  poNumber: string | null;
  lengthMatch: boolean;
  needsApproval: boolean;
};

const GROUPS = ["plant", "unassigned", "same_customer", "other_customer"] as const;

/**
 * The ready-stock prompt (FP-OP-10): bundles of this die that a new line could take, from
 * `orders.matchStock`, best first. The server groups and ranks them; this lists them. Taking a
 * bundle onto the order is "Take ready stock" on the saved order's line (`TakeStockSheet`).
 */
export function StockSheet({
  open,
  onOpenChange,
  items,
  loading,
  failed,
  formatLength,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: readonly StockItem[] | undefined;
  loading: boolean;
  failed: boolean;
  formatLength(mm: number): string;
}) {
  const { t } = useT();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.stock.title")}
      description={t("orders.stock.hint")}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : failed ? (
          <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
            {t("errors.generic")}
          </p>
        ) : !items || items.length === 0 ? (
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("orders.stock.none")}</p>
        ) : (
          <StockList items={items} formatLength={formatLength} />
        )}
      </div>
    </Sheet>
  );
}

/** The matched bundles by group, best first; with `selected` + `onToggle` each row is a checkbox. */
export function StockList({
  items,
  formatLength,
  selected,
  onToggle,
}: {
  items: readonly StockItem[];
  formatLength(mm: number): string;
  selected?: ReadonlySet<string>;
  onToggle?(id: string, on: boolean): void;
}) {
  const { t } = useT();
  return (
    <>
      {GROUPS.map((group) => {
        const rows = items.filter((i) => i.allocation === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className="flex min-w-0 flex-col gap-2" data-stock-group={group}>
            <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t(`orders.stock.group.${group}`)}</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {rows.map((row) => {
                const body = (
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium leading-5">
                      <span className="font-mono tabular-nums">{row.serial}</span>
                      <span className="font-mono tabular-nums">
                        {orderKgText(row.weightG)} {t("units.kg")} · {pcsText(row.pcs)} {t("units.pcs")}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-muted-foreground">
                      <span>{formatLength(row.lengthMm)}</span>
                      {row.orderNumber ? (
                        <span className="font-mono">
                          {row.orderNumber}
                          {row.poNumber ? ` · ${row.poNumber}` : ""}
                        </span>
                      ) : null}
                      {row.lengthMatch ? <Chip tone="green" truncate={false}>{t("orders.stock.sameLength")}</Chip> : null}
                      {row.needsApproval ? <Chip tone="amber" truncate={false}>{t("orders.stock.needsApproval")}</Chip> : null}
                    </span>
                  </span>
                );
                return (
                  <li key={row.id} data-stock-bundle={row.serial}>
                    {onToggle && selected ? (
                      <label
                        htmlFor={`sb-${row.id}`}
                        className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-card border border-border bg-card px-3 py-3"
                      >
                        <Checkbox id={`sb-${row.id}`} checked={selected.has(row.id)} onCheckedChange={(v) => onToggle(row.id, v === true)} />
                        {body}
                      </label>
                    ) : (
                      <div className="flex min-w-0 rounded-card border border-border bg-card px-3 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
