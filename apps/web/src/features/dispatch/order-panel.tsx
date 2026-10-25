import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Link } from "@tanstack/react-router";

import { orderKgText, pcsText } from "@/features/orders/format";

import { orderState, otherOrderItems, type LinkedItem, type Progress } from "./order-view";

type PanelProgress = Progress & {
  lines: { lineId: string; lineNo: number; sectionCode: string; bakiG: number; onDispatchG: number; leftG: number; overG: number }[];
};

/**
 * The sales order this dispatch was opened from (FP-PK-17): its baki now, what this load carries
 * and what is left after it, per line. Every figure is the server's `salesOrder.progress`; the
 * panel follows each scan because the page reads the dispatch again after every add.
 */
export function OrderPanel({
  order,
  items,
  editable,
}: {
  order: { id: string; number: string; poNumber: string | null; progress: PanelProgress };
  items: readonly LinkedItem[];
  editable: boolean;
}) {
  const { t } = useT();
  const p = order.progress;
  const state = orderState(p);
  const other = otherOrderItems(items, order.id);
  return (
    <section aria-label={t("dispatch.order.title", { number: order.number })} data-order-panel={order.number} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">
          <Link to="/orders/$id" params={{ id: order.id }} className="font-mono underline-offset-4 hover:underline">
            {order.number}
          </Link>
          {order.poNumber ? <span className="font-normal text-muted-foreground"> · {order.poNumber}</span> : null}
        </h2>
        {state === "over" ? (
          <Chip tone="red" truncate={false}>
            {t("dispatch.order.over", { kg: orderKgText(p.overG) })}
          </Chip>
        ) : state === "done" ? (
          <Chip tone="green" truncate={false}>
            {t("dispatch.order.done")}
          </Chip>
        ) : null}
      </div>
      <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Figure k="baki" label={t("dispatch.order.baki")} g={p.bakiG} pcs={p.bakiPcs} />
        <Figure k="onLoad" label={t("dispatch.order.onLoad")} g={p.onDispatchG} pcs={p.onDispatchPcs} />
        <Figure k="left" label={t("dispatch.order.left")} g={p.leftG} pcs={p.leftPcs} open={editable && p.leftG > 0} />
      </dl>
      {p.lines.length > 1 ? (
        <details className="rounded-card border border-border px-3 py-2">
          <summary className="cursor-pointer text-[14px] font-medium">{t("dispatch.order.lines")}</summary>
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
            {p.lines.map((l) => (
              <li key={l.lineId} data-order-line={l.lineNo} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-[14px] font-medium">{t("dispatch.order.lineShort", { n: l.lineNo, die: l.sectionCode })}</span>
                <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                  {t("dispatch.order.lineFigures", { baki: orderKgText(l.bakiG), load: orderKgText(l.onDispatchG), left: orderKgText(l.leftG) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {other.count > 0 ? (
        <p data-other-orders="" className="m-0 text-[13px] leading-5 text-muted-foreground">
          {t("dispatch.order.others", { count: other.count, orders: other.orders.join(", ") })}
        </p>
      ) : null}
    </section>
  );
}

function Figure({ k, label, g, pcs, open }: { k: string; label: string; g: number; pcs: number | null; open?: boolean }) {
  const { t } = useT();
  return (
    <div data-order-figure={k} className={open ? "min-w-0 rounded-card bg-tone-amber-tint px-3 py-2.5 text-tone-amber-ink" : "min-w-0 rounded-card bg-surface-sunken px-3 py-2.5"}>
      <dt className={open ? "m-0 text-xs font-medium" : "m-0 text-xs font-medium text-muted-foreground"}>{label}</dt>
      <dd className="m-0 mt-0.5 font-mono text-[15px] font-semibold tabular-nums leading-5 break-words">
        {orderKgText(g)} {t("units.kg")}
      </dd>
      {pcs != null ? (
        <dd className={open ? "m-0 text-[13px] tabular-nums" : "m-0 text-[13px] tabular-nums text-muted-foreground"}>
          {pcsText(pcs)} {t("units.pcs")}
        </dd>
      ) : null}
    </div>
  );
}
