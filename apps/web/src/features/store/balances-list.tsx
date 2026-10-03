import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useId, useMemo, useState, type ReactNode } from "react";

import { categoryLabel, unitShort } from "./store-labels";
import { formatQty, STORE_CATEGORIES } from "./store-qty";
import { storeItemPath } from "./store-ui";

/** One row of the list: a balance row (store.balances) or an item with its balance (Store items page). */
export type BalanceRow = {
  id: string;
  name: string;
  unit: string;
  category: string;
  active: boolean;
  balanceMilli: number;
};

/** Case and spacing do not matter: "coverflux" finds "Cover flux". */
function matches(name: string, query: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const q = key(query);
  return q === "" || key(name).includes(q);
}

export function useBalanceFilter(rows: BalanceRow[]) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const filtered = useMemo(
    () => rows.filter((r) => matches(r.name, query) && (category === "" || r.category === category)),
    [rows, query, category],
  );
  return { query, setQuery, category, setCategory, filtered };
}

/** Search box and category picker above a store list. */
export function BalanceFilters({
  query,
  onQuery,
  category,
  onCategory,
}: {
  query: string;
  onQuery(q: string): void;
  category: string;
  onCategory(c: string): void;
}) {
  const { t } = useT();
  // NativeSelect does not read the Field context, so the label is tied by id.
  const categoryId = `store-category-${useId().replace(/:/g, "")}`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
      <Field label={t("store.search")}>
        <TextInput type="search" value={query} onChangeText={onQuery} autoComplete="off" enterKeyHint="search" />
      </Field>
      <Field label={t("store.category")} id={categoryId}>
        <NativeSelect id={categoryId} value={category} onChange={(e) => onCategory(e.currentTarget.value)}>
          <option value="">{t("store.allCategories")}</option>
          {STORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(t, c)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

/** "12.5 kg" with the number in mono. Never truncated. */
export function Qty({ milli, unit, className }: { milli: number; unit: string; className?: string }) {
  const { t } = useT();
  return (
    <span data-no-truncate="" className={className}>
      <span className="font-mono font-medium tabular-nums">{formatQty(milli)}</span>{" "}
      <span className="text-muted-foreground">{unitShort(t, unit, Math.abs(milli))}</span>
    </span>
  );
}

/** The status word for a store item: empty (amber), retired (quiet), or nothing to flag. */
export function ItemStatus({ row, showInUse = false }: { row: Pick<BalanceRow, "active" | "balanceMilli">; showInUse?: boolean }) {
  const { t } = useT();
  if (!row.active) return <Chip tone="neutral">{t("store.status.retired")}</Chip>;
  if (row.balanceMilli <= 0) return <Chip tone="amber">{t("store.status.empty")}</Chip>;
  return showInUse ? <span className="text-[14px] text-muted-foreground">{t("store.status.inUse")}</span> : null;
}

/**
 * Store items with what is in the store, one link per row to the item page. Table from 1024px,
 * stacked rows below. `extraColumns` lets the Store items page add the unit.
 */
export function BalancesList({
  rows,
  loading,
  empty,
  label,
  showUnit = false,
  showInUse = false,
}: {
  rows: BalanceRow[];
  loading: boolean;
  empty: ReactNode;
  label: string;
  showUnit?: boolean;
  showInUse?: boolean;
}) {
  const { t } = useT();
  const columns: ResponsiveListColumn<BalanceRow>[] = [
    { key: "item", header: t("store.columns.item"), cell: (r) => <span className="break-words">{r.name}</span> },
    {
      key: "inStore",
      header: t("store.columns.inStore"),
      align: "end",
      cell: (r) => <Qty milli={r.balanceMilli} unit={r.unit} />,
    },
    { key: "category", header: t("store.columns.category"), cell: (r) => categoryLabel(t, r.category) },
    ...(showUnit
      ? [{ key: "unit", header: t("store.columns.unit"), cell: (r: BalanceRow) => unitShort(t, r.unit) }]
      : []),
    {
      key: "status",
      header: t("store.columns.status"),
      cell: (r) => <ItemStatus row={r} showInUse={showInUse} />,
    },
  ];
  return (
    <ResponsiveList
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      rowHref={(r) => storeItemPath(r.id)}
      loading={loading}
      label={label}
      empty={empty}
    />
  );
}

/** Empty list: no items at all, or nothing matching the search or category. */
export function BalancesEmpty({
  hasAny,
  query,
  action,
}: {
  hasAny: boolean;
  query: string;
  action?: ReactNode;
}) {
  const { t } = useT();
  if (!hasAny) return <EmptyState title={t("store.noItems")} body={t("store.noItemsBody")} action={action} />;
  if (query.trim()) return <EmptyState title={t("common.noResults", { query: query.trim() })} />;
  return <EmptyState title={t("store.noItemsInCategory")} />;
}
