import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { cityOf } from "@/features/customers/customer-view";
import { PagedList } from "@/features/more/paged-list";
import { useDebounced } from "@/features/more/use-debounced";
import { trpc } from "@/utils/trpc";

const PAGE = 50;

/** Customers: search by name, phone or GSTIN; tap one for contact details and recent dispatches. */
export default function CustomersScreen() {
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void queryClient.invalidateQueries(trpc.customer.list.pathFilter()).finally(() => setRefreshing(false));
      }}
    >
      <Field
        label={t("customers.searchLabel")}
        placeholder={t("customers.search")}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <PagedList
        key={q}
        pageSize={PAGE}
        usePage={(offset) =>
          useQuery({
            ...trpc.customer.list.queryOptions({ search: q || undefined, limit: PAGE, offset }),
            placeholderData: keepPreviousData,
          })
        }
        empty={
          q ? (
            <EmptyState title={t("common.noResults", { query: q })} />
          ) : (
            <EmptyState title={t("customers.empty")} />
          )
        }
        renderRow={(c) => {
          const city = cityOf(c.billingAddress);
          const subtitle = [city, c.phone].filter(Boolean).join(", ") || undefined;
          return (
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={subtitle}
              code={c.taxId ?? undefined}
              onPress={() => router.push({ pathname: "/more/customers/[id]", params: { id: c.id } })}
            />
          );
        }}
      />
    </Screen>
  );
}
