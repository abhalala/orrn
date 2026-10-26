import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { orderKgText } from "@/features/orders/format";
import { Can } from "@/shared/components/can";

type TruckDispatch = { id: string; code: string; status: string; plNumber: string | null; customerName: string; bundles: number; weightG: number };

/**
 * The packing lists on one truck (Q37 per_truck): each customer's own dispatch, under the same
 * vehicle. Shown on every dispatch of a truck; while this one is still being built, another
 * customer can be added.
 */
export function TruckPanel({ truck, currentId, canAdd }: { truck: { id: string; dispatches: TruckDispatch[] }; currentId: string; canAdd: boolean }) {
  const { t } = useT();
  return (
    <section aria-label={t("dispatch.truck.title")} data-truck-panel="" className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
      <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{t("dispatch.truck.title")}</h2>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dispatch.truck.hint")}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {truck.dispatches.map((d) => (
          <li key={d.id} data-truck-dispatch={d.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            {d.id === currentId ? (
              <span className="text-[15px] font-semibold">{t("dispatch.truck.item", { code: d.code, customer: d.customerName })}</span>
            ) : (
              <Link to="/dispatch/$id" params={{ id: d.id }} className="text-[15px] font-semibold underline-offset-4 hover:underline">
                {t("dispatch.truck.item", { code: d.code, customer: d.customerName })}
              </Link>
            )}
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                {t("units.bundles", { count: d.bundles })} · {orderKgText(d.weightG)} {t("units.kg")}
              </span>
              {d.plNumber ? <Chip tone="green">{d.plNumber}</Chip> : null}
            </span>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <Can do="dispatch.create">
          <Button variant="secondary" className="self-start" asChild>
            <Link to="/dispatch/new" search={{ truckOf: currentId }} data-truck-add="">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("dispatch.truck.add")}
            </Link>
          </Button>
        </Can>
      ) : null}
    </section>
  );
}
