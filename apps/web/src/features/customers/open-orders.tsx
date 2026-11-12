import { useT } from "@orrn/i18n";
import { useId } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit } from "@/shared/lib/fmt-text";

/** Order book for the customer, once sales orders exist (plant PL-8). Hidden while null. */
export function OpenOrders({ orders }: { orders: { orderedG: number; dispatchedG: number; bakiG: number; lines: number } }) {
  const fmt = useFmt();
  const { t } = useT();
  const titleId = useId();
  const cells = [
    { key: "ordered", label: t("customers.detail.openOrders.ordered"), g: orders.orderedG },
    { key: "dispatched", label: t("customers.detail.openOrders.dispatched"), g: orders.dispatchedG },
    { key: "baki", label: t("customers.detail.openOrders.baki"), g: orders.bakiG },
  ];
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
          {t("customers.detail.openOrders.title")}
        </h2>
        <span className="text-[13px] font-medium text-muted-foreground">
          {t("customers.detail.openOrders.lines", { count: orders.lines })}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3">
        {cells.map((c) => (
          <div key={c.key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[13px] font-medium text-muted-foreground">{c.label}</dt>
            <dd data-no-truncate="" className="m-0 font-mono text-[17px] font-semibold tabular-nums">
              {kgGrouped1(fmt, c.g)} {massUnit(fmt)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
