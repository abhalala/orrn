import { useQuery } from "@tanstack/react-query";
import { Stack, Link, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { format } from "date-fns";

import { trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

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

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getGroup.queryOptions({ id: id as string }),
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
        <Text>Receipt not found.</Text>
      </View>
    );
  }

  const { group, die, bundles } = data;
  const totalQuantity = bundles.reduce((s, b) => s + b.quantity, 0);
  const totalWeightG = bundles.reduce((s, b) => s + b.weightG, 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: group.code }} />

      <FlatList
        data={bundles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.card}>
            <Text style={styles.code}>{group.code}</Text>
            <Text style={styles.meta}>
              Die: {die ? `${die.series} / ${die.sectionCode}` : "—"}
            </Text>
            <Text style={styles.meta}>Unit: {group.unit}</Text>
            {group.purchaseOrderRef ? (
              <Text style={styles.meta}>PO: {group.purchaseOrderRef}</Text>
            ) : null}
            {group.notes ? <Text style={styles.meta}>Notes: {group.notes}</Text> : null}
            <Text style={styles.meta}>
              Created {format(new Date(group.createdAt), "PP p")}
            </Text>
            <Text style={styles.totals}>
              {bundles.length} bundles · {totalQuantity} qty · {totalWeightG} g
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = statusStyle(item.status);
          return (
            <Link href={`/bundles/${item.id}`} asChild>
              <TouchableOpacity style={styles.bundleCard}>
                <View style={styles.bundleHeader}>
                  <Text style={styles.serial}>{item.serial}</Text>
                  <Text style={[styles.pill, { backgroundColor: s.backgroundColor, color: s.color }]}>
                    {item.status}
                  </Text>
                </View>
                <Text style={styles.bundleMeta}>
                  Qty {item.quantity} · {item.weightG}g · {lu.formatLength(item.lengthMm)}
                </Text>
              </TouchableOpacity>
            </Link>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No bundles in this receipt.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingBottom: 24, gap: 8 },
  card: {
    backgroundColor: "white",
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    gap: 4,
  },
  code: { fontSize: 18, fontWeight: "700", fontFamily: "Menlo", marginBottom: 6 },
  meta: { fontSize: 13, color: "#444" },
  totals: { fontSize: 13, fontWeight: "600", color: "#111827", marginTop: 6 },
  bundleCard: {
    backgroundColor: "white",
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  bundleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  serial: { fontSize: 14, fontWeight: "600", fontFamily: "Menlo" },
  pill: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  bundleMeta: { fontSize: 12, color: "#666" },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
});
