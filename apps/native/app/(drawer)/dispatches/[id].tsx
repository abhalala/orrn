import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { TextArea } from "@orrn/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";

import { queryClient, trpc } from "../../../utils/trpc";

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
    onSuccess: (res) => {
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
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: d.code }} />

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.code}>{d.code}</Text>
              <StatusBadge kind="dispatch" value={d.status} />
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
              <Text style={styles.meta}>Completed {format(new Date(d.completedAt), "PP p")}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <View style={styles.actionRow}>
              <View style={styles.actionBtnWrap}>
                <Button
                  size="lg"
                  disabled={!canReserve || reserveMutation.isPending}
                  onPress={() =>
                    confirm("Reserve", "Reserve all bundles for this dispatch?", () =>
                      reserveMutation.mutate({ id: id as string }),
                    )
                  }
                >
                  Reserve
                </Button>
              </View>
              <View style={styles.actionBtnWrap}>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={!canUnreserve || unreserveMutation.isPending}
                  onPress={() => unreserveMutation.mutate({ id: id as string })}
                >
                  Unreserve
                </Button>
              </View>
              <View style={styles.actionBtnWrap}>
                <Button
                  size="lg"
                  disabled={!canComplete || completeMutation.isPending}
                  onPress={() =>
                    confirm(
                      "Complete",
                      "Mark all bundles as dispatched? This cannot be undone.",
                      () => completeMutation.mutate({ id: id as string }),
                    )
                  }
                >
                  Complete
                </Button>
              </View>
              <View style={styles.actionBtnWrap}>
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={!canCancel || cancelMutation.isPending}
                  onPress={() =>
                    confirm(
                      "Cancel",
                      "Cancel this dispatch?",
                      () => cancelMutation.mutate({ id: id as string, reason: null }),
                      true,
                    )
                  }
                >
                  Cancel
                </Button>
              </View>
              {canDelete ? (
                <View style={styles.actionBtnWrap}>
                  <Button
                    size="lg"
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
                  >
                    Delete
                  </Button>
                </View>
              ) : null}
            </View>
          </View>

          {canAddOrRemove ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Scan or paste serials</Text>
              <TextArea
                value={serialInput}
                onChangeText={setSerialInput}
                placeholder="BG-000123-B001"
                autoCapitalize="characters"
                autoCorrect={false}
                rows={4}
              />
              <View style={styles.primaryBtnWrap}>
                <Button
                  size="lg"
                  disabled={addSerialsMutation.isPending}
                  onPress={handleAddSerials}
                >
                  {addSerialsMutation.isPending ? "Adding…" : "Add to dispatch"}
                </Button>
              </View>
            </View>
          ) : null}

          {d.status === "completed" ? <PackingListCard dispatchId={d.id} /> : null}

          <Text style={styles.itemsTitle}>Items ({items.length})</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.itemRow}>
          <Link href={`/bundles/${item.bundleId}`} asChild>
            <Pressable style={{ flex: 1, minHeight: 44 }}>
              <Text style={styles.itemSerial}>{item.serial}</Text>
              <Text style={styles.itemMeta}>
                {item.dieSeries} / {item.dieSectionCode} · {item.weightG}g · {item.lengthMm}mm
              </Text>
            </Pressable>
          </Link>
          {canAddOrRemove ? (
            <Pressable
              style={styles.removeButton}
              disabled={removeMutation.isPending}
              onPress={() => removeMutation.mutate({ id: id as string, bundleId: item.bundleId })}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No bundles in this dispatch yet.</Text>}
    />
  );
}

function PackingListCard({ dispatchId }: { dispatchId: string }) {
  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.byDispatch.queryOptions({ dispatchId }),
  });

  async function handleShare() {
    if (!pl) return;
    const snap = pl.snapshot as PLSnapshot;
    const cust = snap.dispatch?.customer?.name ?? "—";
    const totals = snap.totals ?? {};
    const lines: string[] = [
      `Packing List: ${pl.code}`,
      `Dispatch: ${snap.dispatch?.code ?? ""}`,
      `Customer: ${cust}`,
      `Bundles: ${totals.totalBundles ?? 0}`,
      `Total Qty: ${totals.totalQuantity ?? 0}`,
      `Total Weight: ${totals.totalWeightKg ?? 0} kg`,
      `Total Length: ${totals.totalLengthM ?? 0} m`,
      "",
      "Items:",
      ...(snap.items ?? []).map((item, i) =>
        `${i + 1}. ${item.bundleSerial} | ${item.die?.series}/${item.die?.sectionCode} | qty ${item.quantity} | ${(item.weightG / 1000).toFixed(3)} kg`,
      ),
    ];
    try {
      await Share.share({ message: lines.join("\n"), title: `${pl.code} Packing List` });
    } catch {
      Alert.alert("Error", "Failed to share packing list");
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Packing list</Text>
      {isLoading ? (
        <ActivityIndicator size="small" />
      ) : !pl ? (
        <Text style={styles.mutedText}>No packing list available.</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: "Menlo", fontSize: 14, fontWeight: "600" }}>{pl.code}</Text>
          <Text style={styles.mutedText}>
            Generated {format(new Date((pl.snapshot as PLSnapshot).generatedAt), "PP p")}
          </Text>
          <View style={styles.primaryBtnWrap}>
            <Button size="lg" variant="outline" onPress={handleShare}>
              Share / export
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}

type PLSnapshot = {
  generatedAt: string;
  dispatch?: { code?: string; customer?: { name?: string } };
  totals?: {
    totalBundles?: number;
    totalQuantity?: number;
    totalWeightKg?: number;
    totalLengthM?: number;
  };
  items?: Array<{
    bundleSerial: string;
    quantity: number;
    weightG: number;
    die?: { series?: string; sectionCode?: string };
  }>;
};

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
    gap: 12,
  },
  code: { fontSize: 18, fontWeight: "700", fontFamily: "Menlo", flex: 1 },
  meta: { fontSize: 14, color: "#475569", lineHeight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtnWrap: { minWidth: "47%", flexGrow: 1, minHeight: 48 },
  primaryBtnWrap: { minHeight: 48, marginTop: 4 },
  itemsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    minHeight: 56,
  },
  itemSerial: { fontSize: 15, fontWeight: "600", fontFamily: "Menlo" },
  itemMeta: { fontSize: 13, color: "#64748b", marginTop: 4 },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#fee2e2",
    minHeight: 44,
    justifyContent: "center",
  },
  removeText: { color: "#b91c1c", fontSize: 14, fontWeight: "600" },
  empty: { textAlign: "center", color: "#64748b", marginTop: 20, fontSize: 14 },
  mutedText: { fontSize: 13, color: "#64748b", lineHeight: 18 },
});
