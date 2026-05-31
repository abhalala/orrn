import { useQuery } from "@tanstack/react-query";
import { Link, Stack } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpFilterChip,
  ErpFilterRow,
  ErpLoading,
  ErpMutedText,
  ErpScreen,
  ErpSummaryCard,
  ErpSummaryGrid,
  ErpTitleText,
} from "@/components/erp";
import { trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export default function StockScreen() {
  const [status, setStatus] = useState<BundleStatus>("available");
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.stockSummary.queryOptions({ status }),
  });

  const items = data?.items ?? [];
  const totals = data?.totals ?? {
    bundleCount: 0,
    totalQuantity: 0,
    totalWeightG: 0,
    totalLengthMm: 0,
  };

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: "Stock" }} />

      <ErpFilterRow>
        {bundleStatuses.map((s) => (
          <ErpFilterChip
            key={s}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            active={s === status}
            onPress={() => setStatus(s)}
          />
        ))}
      </ErpFilterRow>

      <ErpSummaryGrid>
        <ErpSummaryCard label="Bundles" value={Number(totals.bundleCount).toString()} />
        <ErpSummaryCard label="Quantity" value={Number(totals.totalQuantity).toString()} />
        <ErpSummaryCard
          label="Weight (g)"
          value={Number(totals.totalWeightG).toLocaleString()}
        />
        <ErpSummaryCard
          label={`Length (${lu.label})`}
          value={lu.formatLength(Number(totals.totalLengthMm))}
        />
      </ErpSummaryGrid>

      {isLoading ? (
        <ErpLoading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.dieId}
          contentContainerClassName="px-4 pb-4 gap-2"
          renderItem={({ item }) => (
            <Link
              href={{
                pathname: "/bundles",
                params: { dieId: item.dieId, status },
              }}
              asChild
            >
              <ErpCardPressable className="flex-row items-center">
                <View className="flex-1">
                  <ErpTitleText>
                    {item.dieSeries} / {item.dieSectionCode}
                  </ErpTitleText>
                  {item.dieName ? <ErpMutedText>{item.dieName}</ErpMutedText> : null}
                </View>
                <View className="items-end">
                  <ErpTitleText>{Number(item.bundleCount)}</ErpTitleText>
                  <ErpMutedText>{Number(item.totalWeightG)} g</ErpMutedText>
                </View>
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={<ErpEmpty>No {status} stock.</ErpEmpty>}
        />
      )}
    </ErpScreen>
  );
}
