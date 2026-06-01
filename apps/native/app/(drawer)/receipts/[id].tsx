import { useQuery } from "@tanstack/react-query";
import { Stack, Link, useLocalSearchParams } from "expo-router";
import { FlatList } from "react-native";
import { format } from "date-fns";
import { StatusBadge } from "@orrn/ui/components/badge";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpTitleText,
} from "@/components/erp";
import { trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getGroup.queryOptions({ id: id as string }),
  });

  if (isLoading) {
    return (
      <ErpScreen>
        <ErpLoading />
      </ErpScreen>
    );
  }
  if (!data) {
    return (
      <ErpScreen>
        <ErpMutedText className="mt-5 text-center">Bundling session not found.</ErpMutedText>
      </ErpScreen>
    );
  }

  const { group, die, bundles } = data;
  const totalQuantity = bundles.reduce((s, b) => s + b.quantity, 0);
  const totalWeightG = bundles.reduce((s, b) => s + b.weightG, 0);

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: group.code }} />

      <FlatList
        data={bundles}
        keyExtractor={(item) => item.id}
        contentContainerClassName="pb-6 gap-2"
        ListHeaderComponent={
          <ErpListCard className="mx-4 mt-4 gap-1">
            <ErpTitleText mono>{group.code}</ErpTitleText>
            <ErpMutedText>
              Die: {die ? `${die.series} / ${die.sectionCode}` : "—"}
            </ErpMutedText>
<ErpMutedText>Length unit: {group.unit}</ErpMutedText>
            {group.purchaseOrderRef ? (
              <ErpMutedText>Session PO: {group.purchaseOrderRef}</ErpMutedText>
            ) : null}
            {group.notes ? <ErpMutedText>Notes: {group.notes}</ErpMutedText> : null}
            <ErpMutedText>
              Created {format(new Date(group.createdAt), "PP p")}
            </ErpMutedText>
            <ErpMutedText className="mt-1 font-semibold text-foreground">
              {bundles.length} bundles · {totalQuantity} qty · {totalWeightG} g
            </ErpMutedText>
          </ErpListCard>
        }
        renderItem={({ item }) => (
          <Link href={`/bundles/${item.id}`} asChild>
            <ErpCardPressable className="mx-4">
              <ErpRowBetween>
                <ErpTitleText mono>{item.serial}</ErpTitleText>
                <StatusBadge kind="bundle" value={item.status} size="sm" />
              </ErpRowBetween>
              <ErpMutedText>
                Qty {item.quantity} · {item.weightG}g · {lu.formatLength(item.lengthMm)} · PO {item.poNumber || group.purchaseOrderRef || "—"}
              </ErpMutedText>
            </ErpCardPressable>
          </Link>
        )}
        ListEmptyComponent={<ErpEmpty>No bundles in this session.</ErpEmpty>}
      />
    </ErpScreen>
  );
}
