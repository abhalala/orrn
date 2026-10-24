import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { useMemo } from "react";

import { pickerOrder } from "./store-entries";
import { unitShort } from "./store-labels";
import { formatQty } from "./store-qty";
import type { StoreBalance } from "./use-store";

/** Case and spacing do not matter: "coverflux" finds "Cover flux". */
function key(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Store item picker (ARIA combobox). Searches the whole item list, which `store.balances` returns
 * in full (one plant's store is far below its 1,000-row cap, so this is never a truncated list).
 * Recent items come first; with no recent entries yet, a tap lists every item. Each option shows
 * what is in the store; when the entry takes stock out, empty items say so and go last.
 */
export function StoreItemPicker({
  items,
  recentIds,
  value,
  onChange,
  takesStock = false,
}: {
  /** Active items only: retired ones take no entries. */
  items: StoreBalance[];
  recentIds: string[];
  value: string | null;
  onChange(id: string): void;
  /** Issue and Exchange: an item with nothing in the store cannot be issued. */
  takesStock?: boolean;
}) {
  const { t } = useT();
  const toOption = (i: StoreBalance): ComboboxOption<string> => ({
    value: i.id,
    label: i.name,
    hint:
      takesStock && i.balanceMilli <= 0
        ? t("store.form.emptyHint")
        : t("store.form.quantityHint", {
            qty: formatQty(i.balanceMilli),
            unit: unitShort(t, i.unit, i.balanceMilli),
          }),
  });
  const recentItems = useMemo(
    () => recentIds.map((id) => items.find((i) => i.id === id)).filter((i): i is StoreBalance => Boolean(i)),
    [recentIds, items],
  );
  // A fresh store has no recent entries: the whole (short) list then shows on a tap.
  const showAll = recentItems.length === 0;
  const recent = useMemo(
    () => pickerOrder(showAll ? items : recentItems, takesStock).map(toOption),
    // toOption only depends on t and takesStock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAll, items, recentItems, takesStock, t],
  );
  const selected = items.find((i) => i.id === value);

  return (
    <Combobox<string>
      value={value}
      onChange={onChange}
      placeholder={t("store.form.itemPlaceholder")}
      recent={recent}
      recentLabel={showAll ? t("store.form.allItems") : undefined}
      valueLabel={selected?.name}
      search={async (q) => {
        const k = key(q);
        return (
          pickerOrder(
            items.filter((i) => key(i.name).includes(k)),
            takesStock,
          )
            // Long enough for any real search; the list itself is never cut short before filtering.
            .slice(0, 50)
            .map(toOption)
        );
      }}
    />
  );
}
