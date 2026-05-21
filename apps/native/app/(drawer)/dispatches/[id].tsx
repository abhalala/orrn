import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { format } from "date-fns";

import { queryClient, trpc } from "../../../utils/trpc";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];

function statusStyle(status: DispatchStatus | string) {
  switch (status) {
    case "draft":
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
    case "reserved":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "completed":
      return { backgroundColor: "#dcfce7", color: "#166534" };
    case "cancelled":
      return { backgroundColor: "#fee2e2", color: "#b91c1c" };
    default:
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
  }
}

export default function DispatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [serialInput, setSerialInput] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.getDispatch.queryOptions({ id: id as string }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id: id as string }) });
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
  };

  const addSerialsMutation = useMutation({
    ...trpc.dispatch.addBundlesBySerial.mutationOptions(),
    onSuccess: (res: any) => {
      Alert.alert("Added", `${res.added} bundle(s) added`);
      setSerialInput("");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to add"),
  });

  const removeMutation = useMutation({
    ...trpc.dispatch.removeBundle.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("Error", e.message || "Failed to remove"),
  });

  const reserveMutation = useMutation({
    ...trpc.dispatch.reserve.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Dispatch reserved");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to reserve"),
  });

  const unreserveMutation = useMutation({
    ...trpc.dispatch.unreserve.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("Error", e.message || "Failed to unreserve"),
  });

  const completeMutation = useMutation({
    ...trpc.dispatch.complete.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Completed", "Bundles marked dispatched");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to complete"),
  });

  const cancelMutation = useMutation({
    ...trpc.dispatch.cancel.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Cancelled", "Dispatch cancelled");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to cancel"),
  });

  const deleteMutation = useMutation({
    ...trpc.dispatch.softDelete.mutationOptions(),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to delete"),
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
        <Text>Dispatch not found.</Text>
      </View>
    );
  }

  const { dispatch: d, customer: c, items } = data;
  const canAddOrRemove = d.status === "draft" || d.status === "reserved";
  const canReserve = d.status === "draft" && items.length > 0;
  const canUnreserve = d.status === "reserved";
  const canComplete = d.status === "reserved" && items.length > 0;
  const canCancel = d.status === "draft" || d.status === "reserved";
  const canDelete = d.status === "draft" || d.status === "cancelled";
  const s = statusStyle(d.status);

  const handleAddSerials = () => {
    const serials = serialInput
      .split(/[\n,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (serials.length === 0) {
      Alert.alert("Validation", "Enter at least one serial");
      return;
    }
    addSerialsMutation.mutate({ id: id as string, serials });
  };

  const confirm = (title: string, body: string, onConfirm: () => void, destructive = false) => {
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      { text: title, style: destructive ? "destructive" : "default", onPress: onConfirm },
    ]);
  };

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(it) => it.itemId}
      contentContainerStyle={{ paddingBottom: 32 }}
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: d.code }} />

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.code}>{d.code}</Text>
              <Text style={[styles.pill, { backgroundColor: s.backgroundColor, color: s.color }]}>
                {d.status}
              </Text>
            </View>
            <Text style={styles.meta}>Customer: {c?.name ?? "(deleted)"}</Text>
            {d.shipDate ? (
              <Text style={styles.meta}>Ship: {format(new Date(d.shipDate), "PP")}</Text>
            ) : null}
            {d.notes ? <Text style={styles.meta}>Notes: {d.notes}</Text> : null}
            <Text style={styles.meta}>
              {items.length} bundles · {items.reduce((sum, x) => sum + x.weightG, 0)} g total
            </Text>
            {d.completedAt ? (
              <Text style={styles.meta}>
                Completed {format(new Date(d.completedAt), "PP p")}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <View style={styles.actionRow}>
              <ActionBtn
                label="Reserve"
                disabled={!canReserve || reserveMutation.isPending}
                onPress={() =>
                  confirm("Reserve", "Reserve all bundles for this dispatch?", () =>
                    reserveMutation.mutate({ id: id as string }),
                  )
                }
              />
              <ActionBtn
                label="Unreserve"
                variant="outline"
                disabled={!canUnreserve || unreserveMutation.isPending}
                onPress={() => unreserveMutation.mutate({ id: id as string })}
              />
              <ActionBtn
                label="Complete"
                disabled={!canComplete || completeMutation.isPending}
                onPress={() =>
                  confirm(
                    "Complete",
                    "Mark all bundles as dispatched? This cannot be undone.",
                    () => completeMutation.mutate({ id: id as string }),
                  )
                }
              />
              <ActionBtn
                label="Cancel"
                variant="danger"
                disabled={!canCancel || cancelMutation.isPending}
                onPress={() =>
                  confirm(
                    "Cancel",
                    "Cancel this dispatch?",
                    () => cancelMutation.mutate({ id: id as string, reason: null }),
                    true,
                  )
                }
              />
              {canDelete && (
                <ActionBtn
                  label="Delete"
                  variant="ghost"
                  disabled={deleteMutation.isPending}
                  onPress={() =>
                    confirm(
                      "Delete",
                      "Hide this dispatch from active views?",
                      () => deleteMutation.mutate({ id: id as string }),
                      true,
                    )
                  }
                />
              )}
            </View>
          </View>

          {canAddOrRemove && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Scan or paste serials</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={serialInput}
                onChangeText={setSerialInput}
                placeholder="BG-000123-B001"
                autoCapitalize="characters"
                autoCorrect={false}
                multiline
              />
              <TouchableOpacity
                style={[styles.primaryButton, addSerialsMutation.isPending && styles.disabled]}
                onPress={handleAddSerials}
                disabled={addSerialsMutation.isPending}
              >
                <Text style={styles.primaryButtonText}>
                  {addSerialsMutation.isPending ? "Adding..." : "Add to dispatch"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.itemsTitle}>Items ({items.length})</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.itemRow}>
          <Link href={`/bundles/${item.bundleId}`} asChild>
            <TouchableOpacity style={{ flex: 1 }}>
              <Text style={styles.itemSerial}>{item.serial}</Text>
              <Text style={styles.itemMeta}>
                {item.dieSeries} / {item.dieSectionCode} · {item.weightG}g · {item.lengthMm}mm
              </Text>
            </TouchableOpacity>
          </Link>
          {canAddOrRemove && (
            <TouchableOpacity
              style={styles.removeButton}
              disabled={removeMutation.isPending}
              onPress={() =>
                removeMutation.mutate({ id: id as string, bundleId: item.bundleId })
              }
            >
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>No bundles in this dispatch yet.</Text>
      }
    />
  );
}

function ActionBtn({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger" | "ghost";
}) {
  const bg =
    variant === "primary"
      ? "#111827"
      : variant === "danger"
        ? "#dc2626"
        : variant === "ghost"
          ? "transparent"
          : "white";
  const color = variant === "outline" || variant === "ghost" ? "#111827" : "white";
  const borderColor = variant === "outline" ? "#d4d4d8" : variant === "ghost" ? "transparent" : bg;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        { backgroundColor: bg, borderColor },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
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
  },
  code: { fontSize: 18, fontWeight: "700", fontFamily: "Menlo" },
  pill: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: "hidden",
  },
  meta: { fontSize: 13, color: "#444" },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Menlo",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  primaryButton: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  primaryButtonText: { color: "white", fontSize: 15, fontWeight: "600" },
  itemsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: "uppercase",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  itemSerial: { fontSize: 14, fontWeight: "600", fontFamily: "Menlo" },
  itemMeta: { fontSize: 12, color: "#666", marginTop: 2 },
  removeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#fee2e2",
  },
  removeText: { color: "#b91c1c", fontSize: 13, fontWeight: "600" },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
  disabled: { opacity: 0.5 },
});
