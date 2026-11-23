import { useT } from "@orrn/i18n";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useCostingOn } from "./hooks";
import { bpText } from "./model";
import { Note, useCostSay } from "./ui";

/**
 * The order screen's "Cost and margin" panel. Rendered only when costing is on and the person holds `cost.view`; the
 * query is off otherwise, so a plant without costing behaves exactly as before. Rate and margin appear only when the
 * server sent them (`ratesAllowed`).
 */
export function OrderCostPanel({ orderId }: { orderId: string }) {
  const on = useCostingOn();
  const { data: me } = useMe();
  const allowed = on && can(me, "cost.view");
  const q = useQuery({ ...trpc.costing.orderLines.queryOptions({ orderId }), enabled: allowed, meta: INLINE_ERROR_META });
  const say = useCostSay();
  const { t } = useT();
  if (!allowed) return null;
  return (
    <Card data-testid="order-cost-panel">
      <CardHeader>
        <CardTitle as="h2">{t("cost.order.title")}</CardTitle>
      </CardHeader>
      {q.data === undefined ? (
        q.isError ? <Note>{t("cost.order.failed")}</Note> : null
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <Note>{t("cost.order.hint")}</Note>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {q.data.lines.map((l) => {
              const priced = "margin" in l ? l : null;
              return (
                <li key={l.lineId} className="flex min-w-0 flex-col gap-0.5 rounded-card border border-border px-3 py-2 text-[14px]">
                  <p className="m-0 font-medium">{t("cost.order.line", { n: l.lineNo, section: l.sectionCode })}</p>
                  <p className="m-0">
                    {t("cost.order.cost")}: {l.costPaisePerKg == null ? t("cost.order.unknown") : say.rate(l.costPaisePerKg)}{" "}
                    <span className="text-muted-foreground">({t(`cost.order.basis.${l.costBasis}`)})</span>
                  </p>
                  {priced ? (
                    priced.ratePaise == null ? (
                      <Note>{t("cost.order.noRate")}</Note>
                    ) : !priced.margin ? (
                      <Note>{t("cost.order.noMargin")}</Note>
                    ) : (
                      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{t("cost.order.rate")}: {say.rate(priced.ratePaise)}</span>
                        <span>{t("cost.order.margin")}: {say.rate(priced.margin.marginPaisePerKg)}</span>
                        <span>{t("cost.order.marginPct")}: {bpText(priced.margin.marginBp)}</span>
                        {priced.margin.low ? <Chip tone="amber">{t("cost.order.low")}</Chip> : null}
                      </p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
          {q.data.truncated ? <Note>{t("cost.order.truncated")}</Note> : null}
        </div>
      )}
    </Card>
  );
}
