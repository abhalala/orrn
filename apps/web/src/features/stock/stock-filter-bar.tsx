import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Combobox } from "@orrn/ui/components/combobox";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, X } from "lucide-react";
import { useState } from "react";

import { searchCustomers } from "@/features/dispatch/customer-picker";
import { useYards } from "@/features/pack/use-yards";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { activeFilterCount, filterPatch, PROFILE_KINDS, type StockFilter } from "./stock-filters";

type Patch = ReturnType<typeof filterPatch>;

/**
 * The stock filters (FP-PK-08): customer, sales order, plant stock, section, hollow / solid / semi,
 * packed date and (when asked) yard. One bar for the Lengths, Yards and Bundles tabs; every change
 * goes to the URL, the server counts and totals. Closed behind one "Filters" button until used, so a
 * phone sees the list first.
 */
export function StockFilterBar({
  filter,
  onChange,
  onClear,
  showYard = true,
}: {
  filter: StockFilter;
  onChange(patch: Patch): void;
  onClear(): void;
  showYard?: boolean;
}) {
  const { t } = useT();
  const count = activeFilterCount(showYard ? filter : { ...filter, yard: undefined });
  const [open, setOpen] = useState(count > 0);
  const set = (change: Partial<StockFilter>) => onChange(filterPatch(filter, change));
  return (
    <section aria-label={t("stock.filters.title")} data-slot="stock-filters" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" aria-expanded={open} aria-controls="stock-filter-panel" onClick={() => setOpen((o) => !o)} data-testid="filters-toggle">
          <ListFilter aria-hidden="true" strokeWidth={2} />
          {count > 0 ? t("stock.filters.titleCount", { count }) : t("stock.filters.title")}
        </Button>
        {count > 0 ? (
          <Button variant="ghost" onClick={onClear} data-testid="filters-clear">
            <X aria-hidden="true" strokeWidth={2} />
            {t("stock.filters.clear")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div id="stock-filter-panel" className="grid min-w-0 gap-4 rounded-card border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          {showYard ? <YardField value={filter.yard} onChange={(yard) => set({ yard })} /> : null}
          <CustomerField value={filter.customer} onChange={(customer) => set({ customer })} />
          {filter.customer ? <OrderField customerId={filter.customer} value={filter.order} onChange={(order) => set({ order })} /> : null}
          <SectionField value={filter.dieId} onChange={(dieId) => set({ dieId })} />
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="text-[14px] font-semibold leading-5">
              {t("stock.filters.kind")}
            </span>
            <SegmentedControl
              label={t("stock.filters.kind")}
              value={filter.kind ?? "all"}
              onChange={(kind) => set({ kind: kind === "all" ? undefined : kind })}
              options={[
                { value: "all", label: t("common.all") },
                ...PROFILE_KINDS.map((k) => ({ value: k, label: t(`packingList.v2.summary.${k}`) })),
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("stock.filters.from")}>
              <TextInput type="date" value={filter.from ?? ""} onChangeText={(from) => set({ from: from || undefined })} />
            </Field>
            <Field label={t("stock.filters.to")}>
              <TextInput type="date" value={filter.to ?? ""} onChangeText={(to) => set({ to: to || undefined })} />
            </Field>
          </div>
          <div className="flex items-center gap-3 self-end pb-2">
            <Checkbox
              id="filter-plant"
              checked={filter.plant === true}
              onCheckedChange={(v) => set({ plant: v === true ? true : undefined })}
            />
            <label htmlFor="filter-plant" className="text-[15px] leading-5 font-semibold">
              {t("stock.filters.plant")}
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function YardField({ value, onChange }: { value?: string; onChange(v: string | undefined): void }) {
  const { t } = useT();
  const yards = useYards();
  return (
    <Field label={t("stock.filters.yard")} id="filter-yard">
      <NativeSelect id="filter-yard" value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value || undefined)} data-testid="filter-yard">
        <option value="">{t("stock.filters.allYards")}</option>
        {yards.yards.map((y) => (
          <option key={y.id} value={y.id}>
            {y.code}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function CustomerField({ value, onChange }: { value?: string; onChange(v: string | undefined): void }) {
  const { t } = useT();
  const one = useQuery({ ...trpc.customer.get.queryOptions({ id: value ?? "" }), enabled: Boolean(value), staleTime: 60_000 });
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Field label={t("stock.filters.customer")}>
        <Combobox<string>
          value={value ?? null}
          valueLabel={one.data?.name}
          onChange={(id) => onChange(id)}
          search={searchCustomers}
          placeholder={t("dispatch.new.customerSearch")}
        />
      </Field>
      {value ? (
        <Button variant="ghost" className="self-start px-3" onClick={() => onChange(undefined)}>
          <X aria-hidden="true" strokeWidth={2} />
          {t("stock.filters.anyCustomer")}
        </Button>
      ) : null}
    </div>
  );
}

function OrderField({ customerId, value, onChange }: { customerId: string; value?: string; onChange(v: string | undefined): void }) {
  const { t } = useT();
  const orders = useQuery({ ...trpc.orders.list.queryOptions({ customerId, limit: 100 }), staleTime: 30_000 });
  return (
    <Field label={t("stock.filters.order")} id="filter-order">
      <NativeSelect id="filter-order" value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value || undefined)} data-testid="filter-order">
        <option value="">{t("stock.filters.anyOrder")}</option>
        {(orders.data?.items ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {[o.number, o.poNumber].filter(Boolean).join(" · ")}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function SectionField({ value, onChange }: { value?: string; onChange(v: string | undefined): void }) {
  const { t } = useT();
  const one = useQuery({ ...trpc.die.get.queryOptions({ id: value ?? "" }), enabled: Boolean(value), staleTime: 60_000 });
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Field label={t("stock.filters.section")}>
        <Combobox<string>
          value={value ?? null}
          valueLabel={one.data ? [one.data.sectionCode, one.data.series].filter(Boolean).join(" ") : undefined}
          onChange={(id) => onChange(id)}
          search={async (q) => {
            const res = await trpcClient.die.list.query({ search: q, status: "active", limit: 20, offset: 0 });
            return res.items.map((d) => ({ value: d.id, label: [d.sectionCode, d.series].filter(Boolean).join(" "), hint: d.name ?? undefined }));
          }}
          placeholder={t("stock.filters.sectionSearch")}
        />
      </Field>
      {value ? (
        <Button variant="ghost" className="self-start px-3" onClick={() => onChange(undefined)}>
          <X aria-hidden="true" strokeWidth={2} />
          {t("stock.filters.anySection")}
        </Button>
      ) : null}
    </div>
  );
}
