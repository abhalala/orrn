import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field } from "@orrn/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { orderKgText } from "@/features/orders/format";
import { trpc, trpcClient } from "@/shared/utils/trpc";

export type PickedOrder = { id: string; number: string; customerName: string };

/**
 * "From sales order" (FP-PK-17): search the open orders that can still send kg (confirmed or
 * dispatching, baki left) by number, PO or customer. The order's party becomes the dispatch's, so
 * there is no customer to pick.
 */
export function OrderPicker({ value, onChange, error }: { value: PickedOrder | null; onChange(next: PickedOrder): void; error?: string }) {
  const { t } = useT();
  const seen = useRef(new Map<string, PickedOrder>());
  // The order named in the URL (Dispatch on an order's page) shows its label before any search.
  const known = useQuery({
    ...trpc.orders.get.queryOptions({ id: value?.id ?? "" }),
    enabled: Boolean(value?.id) && !value?.number,
    staleTime: 60_000,
  });
  const label = value?.number ? `${value.number} · ${value.customerName}` : known.data ? `${known.data.order.number} · ${known.data.order.customerName}` : undefined;
  return (
    <Field label={t("dispatch.fromOrder.order")} hint={t("dispatch.fromOrder.hint")} error={error}>
      <Combobox<string>
        value={value?.id ?? null}
        valueLabel={label}
        onChange={(id) => {
          const hit = seen.current.get(id);
          if (hit) onChange(hit);
        }}
        search={async (q) => {
          const res = await trpcClient.orders.list.query({ openOnly: true, ...(q.trim() ? { search: q.trim() } : {}), limit: 50 });
          return res.items
            .filter((o) => o.status !== "booking" && o.bakiG > 0)
            .slice(0, 20)
            .map((o): ComboboxOption<string> => {
              seen.current.set(o.id, { id: o.id, number: o.number, customerName: o.customerName });
              return {
                value: o.id,
                label: `${o.number} · ${o.customerName}`,
                hint: `${t("dispatch.fromOrder.baki", { kg: orderKgText(o.bakiG) })}${o.poNumber ? ` · ${o.poNumber}` : ""}`,
              };
            });
        }}
        placeholder={t("dispatch.fromOrder.search")}
      />
    </Field>
  );
}
