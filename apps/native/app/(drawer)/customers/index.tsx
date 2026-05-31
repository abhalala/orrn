import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList } from "react-native";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpLoading,
  ErpMutedText,
  ErpScreen,
  ErpSearchBar,
  ErpTitleText,
} from "@/components/erp";
import { trpc } from "../../../utils/trpc";

export default function CustomersScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.customer.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: "Customers" }} />

      <ErpSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search customers..."
      />

      {isLoading ? (
        <ErpLoading />
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-4 gap-3"
          renderItem={({ item }) => (
            <Link href={`/customers/${item.id}`} asChild>
              <ErpCardPressable>
                <ErpTitleText>{item.name}</ErpTitleText>
                {item.email ? <ErpMutedText>{item.email}</ErpMutedText> : null}
                {item.phone ? <ErpMutedText>{item.phone}</ErpMutedText> : null}
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={
            <ErpEmpty>
              {search ? "No customers found matching search." : "No customers yet."}
            </ErpEmpty>
          }
        />
      )}
    </ErpScreen>
  );
}
