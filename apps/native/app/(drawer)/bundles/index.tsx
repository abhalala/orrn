import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { useLengthUnit } from "../../../utils/length";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];
type StatusFilter = BundleStatus | "all";

const STATUS_FILTERS: StatusFilter[] = ["all", ...bundleStatuses];

export default function BundlesScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const lu = useLengthUnit();
  const primaryColor = useThemeColor("link");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
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
          title: "Bundles",
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
        placeholder="Search by serial..."
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
            <Link href={`/bundles/${item.id}`} asChild>
              <ErpCardPressable>
                <ErpRowBetween>
                  <ErpTitleText mono>{item.serial}</ErpTitleText>
                  <StatusBadge kind="bundle" value={item.status} />
                </ErpRowBetween>
                <ErpMutedText>
                  Die: {item.dieSeries} / {item.dieSectionCode}
                </ErpMutedText>
                <ErpMutedText>Receipt: {item.groupCode}</ErpMutedText>
                <ErpMutedText className="mt-1">
                  Qty {item.quantity} · {item.weightG}g · {lu.formatLength(item.lengthMm)}
                </ErpMutedText>
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={
            <ErpEmpty>
              {search ? "No bundles match this search." : "No bundles yet."}
            </ErpEmpty>
          }
        />
      )}
    </ErpScreen>
  );
}
