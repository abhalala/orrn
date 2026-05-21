import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { format } from "date-fns";

import { queryClient, trpc } from "../../../utils/trpc";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

function statusStyle(status: BundleStatus | string) {
  switch (status) {
    case "available":
      return { backgroundColor: "#dcfce7", color: "#166534" };
    case "reserved":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "dispatched":
      return { backgroundColor: "#dbeafe", color: "#1e40af" };
    case "void":
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
    default:
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
  }
}

export default function BundleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [reason, setReason] = useState("");

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
  const targetStatus: BundleStatus | null = isAvailable
    ? "void"
    : isVoid
      ? "available"
      : null;

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

  const s = statusStyle(bundle.status);

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: bundle.serial }} />

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.serialBig}>{bundle.serial}</Text>
          <Text style={[styles.statusPill, { backgroundColor: s.backgroundColor, color: s.color }]}>
            {bundle.status}
          </Text>
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
          <Text style={styles.kvValue}>{bundle.lengthMm} mm</Text>
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
          <TextInput
            style={styles.input}
            placeholder="Reason (optional)"
            value={reason}
            onChangeText={setReason}
          />
          <TouchableOpacity
            style={[
              styles.button,
              isAvailable ? styles.danger : styles.primary,
              transitionMutation.isPending && styles.buttonDisabled,
            ]}
            onPress={confirmTransition}
            disabled={transitionMutation.isPending}
          >
            <Text style={styles.buttonText}>
              {transitionMutation.isPending
                ? "Saving..."
                : isAvailable
                  ? "Void bundle"
                  : "Restore bundle"}
            </Text>
          </TouchableOpacity>
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
          events.map((ev) => {
            const fromS = statusStyle(ev.fromStatus ?? "");
            const toS = statusStyle(ev.toStatus);
            return (
              <View key={ev.id} style={styles.eventRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.pill, { backgroundColor: fromS.backgroundColor, color: fromS.color }]}>
                    {ev.fromStatus ?? "new"}
                  </Text>
                  <Text style={styles.arrow}>→</Text>
                  <Text style={[styles.pill, { backgroundColor: toS.backgroundColor, color: toS.color }]}>
                    {ev.toStatus}
                  </Text>
                </View>
                <Text style={styles.eventDate}>{format(new Date(ev.at), "PP p")}</Text>
                {ev.reason ? <Text style={styles.eventReason}>{ev.reason}</Text> : null}
              </View>
            );
          })
        )}
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  serialBig: { fontSize: 18, fontWeight: "700", fontFamily: "Menlo" },
  statusPill: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: "hidden",
  },
  kvRow: { flexDirection: "row", justifyContent: "space-between" },
  kvLabel: { color: "#6b7280", fontSize: 13 },
  kvValue: { color: "#111827", fontSize: 14, fontWeight: "500" },
  kvValueMono: { color: "#111827", fontSize: 14, fontWeight: "500", fontFamily: "Menlo" },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: { paddingVertical: 12, borderRadius: 6, alignItems: "center" },
  primary: { backgroundColor: "#111827" },
  danger: { backgroundColor: "#dc2626" },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  muted: { backgroundColor: "#f9fafb" },
  mutedText: { color: "#6b7280", fontSize: 13 },
  eventRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6", gap: 4 },
  pill: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  arrow: { color: "#9ca3af" },
  eventDate: { fontSize: 12, color: "#6b7280" },
  eventReason: { fontSize: 13, color: "#374151" },
});
