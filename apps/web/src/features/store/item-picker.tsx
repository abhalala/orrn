import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { useMemo } from "react";

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
 * Recent items come first; each option shows what is in the store.
 */
export function StoreItemPicker({
  items,
  recentIds,
  value,
  onChange,
}: {
  /** Active items only: retired ones take no entries. */
  items: StoreBalance[];
  recentIds: string[];
  value: string | null;
  onChange(id: string): void;
}) {
  const { t } = useT();
  const toOption = (i: StoreBalance): ComboboxOption<string> => ({
    value: i.id,
    label: i.name,
    hint: t("store.form.quantityHint", { qty: formatQty(i.balanceMilli), unit: unitShort(t, i.unit, i.balanceMilli) }),
  });
  const recent = useMemo(
    () =>
      recentIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is StoreBalance => Boolean(i))
        .map(toOption),
    // toOption only depends on t, which changes with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentIds, items, t],
  );
  const selected = items.find((i) => i.id === value);

  return (
    <Combobox<string>
      value={value}
      onChange={onChange}
      placeholder={t("store.form.itemPlaceholder")}
      recent={recent}
      valueLabel={selected?.name}
      search={async (q) => {
        const k = key(q);
        return items
          .filter((i) => key(i.name).includes(k))
          // Long enough for any real search; the list itself is never cut short before filtering.
          .slice(0, 50)
          .map(toOption);
      }}
    />
  );
}
