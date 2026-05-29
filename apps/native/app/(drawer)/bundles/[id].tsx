import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";

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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <Text>Bundle not found.</Text>
      </View>
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
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: bundle.serial }} />

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.serialBig}>{bundle.serial}</Text>
          <StatusBadge kind="bundle" value={bundle.status} />
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Die</Text>
          <Text style={styles.kvValue}>
            {die ? `${die.series} / ${die.sectionCode}` : "—"}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Receipt</Text>
          <Text style={styles.kvValueMono}>{group?.code ?? "—"}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Quantity</Text>
          <Text style={styles.kvValue}>{bundle.quantity}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Weight</Text>
          <Text style={styles.kvValue}>{bundle.weightG} g</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Length</Text>
          <Text style={styles.kvValue}>{lu.formatLength(bundle.lengthMm)}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Created</Text>
          <Text style={styles.kvValue}>{format(new Date(bundle.createdAt), "PP p")}</Text>
        </View>
      </View>

      {canTransition && targetStatus ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            {isAvailable ? "Void this bundle" : "Restore this bundle"}
          </Text>
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChangeText={setReason}
            height={48}
          />
          <View style={styles.buttonWrap}>
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
        </View>
      ) : (
        <View style={[styles.card, styles.muted]}>
          <Text style={styles.mutedText}>
            This bundle is currently {bundle.status}. Status changes go through dispatch.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Status history</Text>
        {events.length === 0 ? (
          <Text style={styles.mutedText}>No history yet.</Text>
        ) : (
          events.map((ev) => (
            <View key={ev.id} style={styles.eventRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <StatusBadge kind="bundle" value={ev.fromStatus ?? "available"} size="sm" />
                <Text style={styles.arrow}>→</Text>
                <StatusBadge kind="bundle" value={ev.toStatus} size="sm" />
              </View>
              <Text style={styles.eventDate}>{format(new Date(ev.at), "PP p")}</Text>
              {ev.reason ? <Text style={styles.eventReason}>{ev.reason}</Text> : null}
            </View>
          ))
        )}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    gap: 12,
  },
  serialBig: { fontSize: 20, fontWeight: "700", fontFamily: "Menlo", flex: 1 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", minHeight: 28 },
  kvLabel: { color: "#64748b", fontSize: 14 },
  kvValue: { color: "#0f172a", fontSize: 15, fontWeight: "500" },
  kvValueMono: { color: "#0f172a", fontSize: 14, fontWeight: "500", fontFamily: "Menlo" },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
  buttonWrap: { marginTop: 8, minHeight: 48 },
  muted: { backgroundColor: "#f1f5f9" },
  mutedText: { color: "#64748b", fontSize: 14, lineHeight: 20 },
  eventRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", gap: 6 },
  arrow: { color: "#94a3b8", fontSize: 16 },
  eventDate: { fontSize: 12, color: "#64748b" },
  eventReason: { fontSize: 14, color: "#334155" },
});
