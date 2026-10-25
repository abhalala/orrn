import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { agedBreakdown } from "./order-aged-model";

/**
 * Under an order line's balance strip (FP-AG-15): where the line's pieces are on the ageing side, from
 * `ageing.forOrder` (the server counts them): loaded onto trolleys, in the oven, out and not tested, held,
 * released and waiting to be packed, packed. Shows nothing for a line that never went to a trolley, and
 * nothing for a person who may not read ageing figures. One request serves every line of the order.
 */
export function OrderLineAged({ salesOrderId, lineId }: { salesOrderId: string; lineId: string }) {
  return (
    <Can do={["order.manage", "ageing.view", "reports.read"]}>
      <Breakdown salesOrderId={salesOrderId} lineId={lineId} />
    </Can>
  );
}

function Breakdown({ salesOrderId, lineId }: { salesOrderId: string; lineId: string }) {
  const { t } = useT();
  const query = useQuery({ ...trpc.ageing.forOrder.queryOptions({ salesOrderId }), meta: INLINE_ERROR_META, staleTime: 15_000 });
  const line = query.data?.lines.find((l) => l.salesOrderLineId === lineId);
  const parts = line ? agedBreakdown(line) : [];
  if (parts.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="order-line-aged" data-line={lineId}>
      <p className="m-0 text-[13px] font-semibold text-muted-foreground">{t("ageing.forOrder.title")}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("ageing.forOrder.note")}>
        {parts.map((p) => (
          <li key={p.key} data-aged-part={p.key}>
            <Chip tone={p.tone} truncate={false}>
              {t(`ageing.forOrder.${p.key}`)} {t("ageing.forOrder.pcs", { pcs: p.pcs })}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
