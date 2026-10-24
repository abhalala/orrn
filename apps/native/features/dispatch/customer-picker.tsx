import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";
import { useState } from "react";

import { useDebounced } from "./use-debounced";

export type PickedCustomer = { id: string; name: string };

/**
 * Pick the customer: a search box over `customer.list` (name, phone or
 * GSTIN) with the matches below it. Once one is picked it shows as a single
 * card with a Change button.
 */
export function CustomerPicker({
  selected,
  onSelect,
  onClear,
  error,
}: {
  selected: PickedCustomer | null;
  onSelect: (customer: PickedCustomer) => void;
  onClear: () => void;
  error?: string | null;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const search = useDebounced(text.trim());
  const list = useQuery({
    ...trpc.customer.list.queryOptions({ search: search || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled: !selected,
  });

  if (selected) {
    return (
      <View className="gap-2">
        <Text className="font-sans-medium text-sm text-ink">{t("dispatch.new.customer")}</Text>
        <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
          <Text accessibilityLabel={t("native.dispatch.customerPicked", { name: selected.name })} className="font-sans-semibold text-base text-ink">
            {selected.name}
          </Text>
          <Button variant="secondary" label={t("native.dispatch.changeCustomer")} onPress={onClear} />
        </View>
      </View>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <View className="gap-3">
      <Field
        label={t("dispatch.new.customer")}
        placeholder={t("dispatch.new.customerSearch")}
        value={text}
        onChangeText={setText}
        error={error}
        autoCorrect={false}
        returnKeyType="search"
      />
      {list.isPending ? <LoadingBlock /> : null}
      {list.isError ? <Text className="font-sans text-[15px] text-destructive">{t("errors.network")}</Text> : null}
      {list.isSuccess && items.length === 0 ? (
        <Text className="font-sans text-[15px] text-ink-muted">{search ? t("common.noResults", { query: search }) : t("customers.empty")}</Text>
      ) : null}
      {items.map((c) => (
        <ListRow key={c.id} title={c.name} subtitle={c.phone ?? c.taxId ?? undefined} onPress={() => onSelect({ id: c.id, name: c.name })} />
      ))}
    </View>
  );
}
