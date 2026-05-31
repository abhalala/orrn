import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import { format } from "date-fns";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpLoading,
  ErpMutedText,
  ErpScreen,
  ErpSearchBar,
  ErpTitleText,
} from "@/components/erp";
import { Can } from "@/components/can";
import { trpc } from "../../../utils/trpc";

export default function ReceiptsScreen() {
  const [search, setSearch] = useState("");
  const primaryColor = useThemeColor("link");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listGroups.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <ErpScreen>
      <Stack.Screen
        options={{
          title: "Receipts",
          headerRight: () => (
            <Can do="receipt.create">
              <Link href="/receipts/new" asChild>
                <TouchableOpacity className="mr-4" accessibilityLabel="New receipt">
                  <Ionicons name="add" size={24} color={primaryColor} />
                </TouchableOpacity>
              </Link>
            </Can>
          ),
        }}
      />

      <ErpSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search by code or PO ref..."
      />

      {isLoading ? (
        <ErpLoading />
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-4 gap-3"
          renderItem={({ item }) => (
            <Link href={`/receipts/${item.id}`} asChild>
              <ErpCardPressable>
                <ErpTitleText mono>{item.code}</ErpTitleText>
                <ErpMutedText>
                  Die: {item.dieSeries} / {item.dieSectionCode} · {item.unit}
                </ErpMutedText>
                {item.purchaseOrderRef ? (
                  <ErpMutedText>PO: {item.purchaseOrderRef}</ErpMutedText>
                ) : null}
                <ErpMutedText>
                  {Number(item.bundleCount)} bundles · {Number(item.totalWeightG)} g total
                </ErpMutedText>
                <ErpMutedText className="mt-1 text-xs">
                  {format(new Date(item.createdAt), "MMM d, yyyy")}
                </ErpMutedText>
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={
            <ErpEmpty>
              {search
                ? "No receipts match this search."
                : "No receipts yet. Tap + to create one."}
            </ErpEmpty>
          }
        />
      )}
    </ErpScreen>
  );
}
