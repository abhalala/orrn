import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";

import type { WoStatus } from "./model";
import { orderedMoves } from "./wo-model";

export type SpareRow = {
  storeTxnId: string;
  number: string;
  itemName: string;
  issuedAt: number;
  cancelledAt?: number | null;
  /** Candidates only: issued with this work order's id as the reference. */
  forThis?: boolean;
};

/**
 * Store issues as rows: the number, the item, how much (already worded by the caller in the item's own unit), the date,
 * and one action per row (Remove on linked rows, Add on candidates). No money column: the store rate is not wired yet.
 */
export function SpareRows({
  rows,
  qtyText,
  when,
  actionLabel,
  onAction,
  pendingId,
  emptyText,
}: {
  rows: readonly SpareRow[];
  qtyText: (row: SpareRow) => string;
  when: (at: number) => string;
  actionLabel?: string;
  onAction?: (row: SpareRow) => void;
  pendingId?: string | null;
  emptyText: string;
}) {
  const { t } = useT();
  if (rows.length === 0) return <p className="m-0 text-[15px] text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-border p-0" data-testid="wo-spares">
      {rows.map((r) => (
        <li key={r.storeTxnId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] break-words">
              <span className="font-mono font-semibold whitespace-nowrap">{r.number}</span>
              <span className="ml-2">{r.itemName}</span>
            </span>
            <span className="text-[13px] text-muted-foreground">
              {qtyText(r)}
              {" · "}
              {t("maint.workOrders.spares.issuedOn", { when: when(r.issuedAt) })}
            </span>
            {r.cancelledAt != null || r.forThis ? (
              <span className="flex flex-wrap gap-1.5 pt-0.5">
                {r.cancelledAt != null ? (
                  <Chip tone="neutral" truncate={false}>
                    {t("maint.workOrders.spares.cancelledInStore")}
                  </Chip>
                ) : null}
                {r.forThis ? (
                  <Chip tone="green" truncate={false}>
                    {t("maint.workOrders.spares.forThis")}
                  </Chip>
                ) : null}
              </span>
            ) : null}
          </div>
          {onAction && actionLabel ? (
            <Button variant="secondary" size="sm" loading={pendingId === r.storeTxnId} disabled={pendingId != null} onClick={() => onAction(r)}>
              {actionLabel}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One button per move the server allows (`wo.moves`); cancel is last and quiet. */
export function MoveBar({ moves, onMove, disabled }: { moves: readonly string[]; onMove: (to: WoStatus) => void; disabled?: boolean }) {
  const { t } = useT();
  const list = orderedMoves(moves);
  if (list.length === 0) return null;
  return (
    <div role="group" aria-label={t("maint.workOrders.moves.title")} className="flex flex-wrap gap-2" data-testid="wo-moves">
      {list.map((to) => (
        <Button
          key={to}
          type="button"
          variant={to === "done" ? "primary" : to === "cancelled" ? "danger" : "secondary"}
          disabled={disabled}
          data-move={to}
          onClick={() => onMove(to)}
        >
          {t(`maint.workOrders.moves.${to}`)}
        </Button>
      ))}
    </div>
  );
}
