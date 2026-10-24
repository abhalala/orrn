import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
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
 * `orders.matchStock`, best first. The server groups and ranks them; this lists them. Moving a
 * bundle onto the order is `Move bundles` on the saved order.
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
          GROUPS.map((group) => {
            const rows = items.filter((i) => i.allocation === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="flex min-w-0 flex-col gap-2">
                <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t(`orders.stock.group.${group}`)}</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rows.map((row) => (
                    <li key={row.id} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card px-3 py-3">
                      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium leading-5">
                        <span className="font-mono tabular-nums">{row.serial}</span>
                        <span className="font-mono tabular-nums">
                          {orderKgText(row.weightG)} {t("units.kg")} · {pcsText(row.pcs)} {t("units.pcs")}
                        </span>
                      </p>
                      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-muted-foreground">
                        <span>{formatLength(row.lengthMm)}</span>
                        {row.orderNumber ? (
                          <span className="font-mono">
                            {row.orderNumber}
                            {row.poNumber ? ` · ${row.poNumber}` : ""}
                          </span>
                        ) : null}
                        {row.lengthMatch ? <Chip tone="green" truncate={false}>{t("orders.stock.sameLength")}</Chip> : null}
                        {row.needsApproval ? <Chip tone="amber" truncate={false}>{t("orders.stock.needsApproval")}</Chip> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
