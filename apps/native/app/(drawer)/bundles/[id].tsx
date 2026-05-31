import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { format } from "date-fns";

import {
  ErpKvRow,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpSectionTitle,
} from "@/components/erp";
import { Can } from "@/components/can";
import { queryClient, trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export default function BundleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState("");
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getBundle.queryOptions({ id: id as string }),
  });

  const transitionMutation = useMutation({
    ...trpc.bundle.transitionStatus.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Status updated");
      setReason("");
      queryClient.invalidateQueries({
        queryKey: trpc.bundle.getBundle.queryKey({ id: id as string }),
      });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to update status");
    },
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
        <ErpMutedText className="mt-5 text-center">Bundle not found.</ErpMutedText>
      </ErpScreen>
    );
  }

  const { bundle, die, group, events } = data;
  const isAvailable = bundle.status === "available";
  const isVoid = bundle.status === "void";
  const canTransition = isAvailable || isVoid;
  const targetStatus: BundleStatus | null = isAvailable ? "void" : isVoid ? "available" : null;

  const confirmTransition = () => {
    if (!targetStatus) return;
    Alert.alert(
      isAvailable ? "Void bundle" : "Restore bundle",
      isAvailable
        ? "Mark this bundle as void? It will be removed from available stock."
        : "Restore this bundle to available stock?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isAvailable ? "Void" : "Restore",
          style: isAvailable ? "destructive" : "default",
          onPress: () =>
            transitionMutation.mutate({
              id: id as string,
              toStatus: targetStatus,
              reason: reason || null,
            }),
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: bundle.serial }} />

      <ErpListCard className="mx-4 mt-4 gap-3">
        <ErpRowBetween>
          <View className="flex-1">
            <Text className="font-mono text-xl font-bold text-foreground">{bundle.serial}</Text>
          </View>
          <StatusBadge kind="bundle" value={bundle.status} />
        </ErpRowBetween>

        <ErpKvRow
          label="Die"
          value={die ? `${die.series} / ${die.sectionCode}` : "—"}
        />
        <ErpKvRow label="Receipt" value={group?.code ?? "—"} />
        <ErpKvRow label="Quantity" value={bundle.quantity} />
        <ErpKvRow label="Weight" value={`${bundle.weightG} g`} />
        <ErpKvRow label="Length" value={lu.formatLength(bundle.lengthMm)} />
        <ErpKvRow label="Created" value={format(new Date(bundle.createdAt), "PP p")} />
      </ErpListCard>

      {canTransition && targetStatus ? (
        <Can do="bundle.transition">
          <ErpListCard className="mx-4 mt-4 gap-3">
            <ErpSectionTitle>
              {isAvailable ? "Void this bundle" : "Restore this bundle"}
            </ErpSectionTitle>
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              height={48}
            />
            <View className="mt-2 min-h-12">
              <Button
                variant={isAvailable ? "destructive" : "default"}
                size="lg"
                disabled={transitionMutation.isPending}
                onPress={confirmTransition}
              >
                {transitionMutation.isPending
                  ? "Saving…"
                  : isAvailable
                    ? "Void bundle"
                    : "Restore bundle"}
              </Button>
            </View>
          </ErpListCard>
        </Can>
      ) : (
        <ErpListCard className="mx-4 mt-4 bg-muted">
          <ErpMutedText>
            This bundle is currently {bundle.status}. Status changes go through dispatch.
          </ErpMutedText>
        </ErpListCard>
      )}

      <ErpListCard className="mx-4 mt-4 gap-3">
        <ErpSectionTitle>Status history</ErpSectionTitle>
        {events.length === 0 ? (
          <ErpMutedText>No history yet.</ErpMutedText>
        ) : (
          events.map((ev) => (
            <View
              key={ev.id}
              className="gap-1.5 border-b border-border py-2.5 last:border-b-0"
            >
              <View className="flex-row flex-wrap items-center gap-2">
                <StatusBadge kind="bundle" value={ev.fromStatus ?? "available"} size="sm" />
                <Text className="text-base text-muted">→</Text>
                <StatusBadge kind="bundle" value={ev.toStatus} size="sm" />
              </View>
              <ErpMutedText className="text-xs">
                {format(new Date(ev.at), "PP p")}
              </ErpMutedText>
              {ev.reason ? <ErpMutedText>{ev.reason}</ErpMutedText> : null}
            </View>
          ))
        )}
      </ErpListCard>

      <View className="h-8" />
    </ScrollView>
  );
}
