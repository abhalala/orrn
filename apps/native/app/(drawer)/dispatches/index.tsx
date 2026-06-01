import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { StatusBadge } from "@orrn/ui/components/badge";

import { useThemeColor } from "@/lib/theme";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpFilterChip,
  ErpFilterRow,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpSearchBar,
  ErpTitleText,
} from "@/components/erp";
import { Can } from "@/components/can";
import { trpc } from "../../../utils/trpc";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];
type StatusFilter = DispatchStatus | "all";

const STATUS_FILTERS: StatusFilter[] = ["all", ...dispatchStatuses];

export default function DispatchesScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const primaryColor = useThemeColor("link");

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({
      search: search || undefined,
      status: status === "all" ? undefined : status,
      limit: 50,
      offset: 0,
    }),
  });

  return (
    <ErpScreen>
      <Stack.Screen
        options={{
          title: "Dispatches",
          headerRight: () => (
            <Can do="dispatch.create">
              <Link href="/dispatches/new" asChild>
                <TouchableOpacity className="mr-4" accessibilityLabel="New dispatch">
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
        placeholder="Search by code or notes..."
      />

      <ErpFilterRow>
        {STATUS_FILTERS.map((f) => (
          <ErpFilterChip
            key={f}
            label={f.charAt(0).toUpperCase() + f.slice(1)}
            active={f === status}
            onPress={() => setStatus(f)}
          />
        ))}
      </ErpFilterRow>

      {isLoading ? (
        <ErpLoading />
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-4 gap-3"
          renderItem={({ item }) => (
            <Link href={`/dispatches/${item.id}`} asChild>
              <ErpCardPressable>
                <ErpRowBetween>
                  <ErpTitleText mono>{item.code}</ErpTitleText>
                  <StatusBadge kind="dispatch" value={item.status} />
                </ErpRowBetween>
                <ErpMutedText>{item.customerName}</ErpMutedText>
                <ErpMutedText>
                  {Number(item.itemCount)} bundles · {Number(item.totalWeightG)} g
                </ErpMutedText>
                {item.shipDate ? (
                  <ErpMutedText>
                    Ship: {format(new Date(item.shipDate), "MMM d, yyyy")}
                  </ErpMutedText>
                ) : null}
                <ErpMutedText className="mt-1 text-xs">
                  Created {format(new Date(item.createdAt), "MMM d, yyyy")}
                </ErpMutedText>
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={
            <ErpEmpty>
              {search
                ? "No dispatches match this search."
                : "No dispatches yet. Tap + to create one."}
            </ErpEmpty>
          }
        />
      )}
    </ErpScreen>
  );
}
