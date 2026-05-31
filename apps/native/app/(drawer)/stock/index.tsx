import { useQuery } from "@tanstack/react-query";
import { Link, Stack } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Stock" }} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {bundleStatuses.map((s) => {
          const active = s === status;
          return (
            <TouchableOpacity
              key={s}
              onPress={() => setStatus(s)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.summaryGrid}>
        <SummaryCard label="Bundles" value={Number(totals.bundleCount).toString()} />
        <SummaryCard label="Quantity" value={Number(totals.totalQuantity).toString()} />
        <SummaryCard label="Weight (g)" value={Number(totals.totalWeightG).toLocaleString()} />
        <SummaryCard label={`Length (${lu.label})`} value={lu.formatLength(Number(totals.totalLengthMm))} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.dieId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link
              href={{
                pathname: "/bundles",
                params: { dieId: item.dieId, status },
              }}
              asChild
            >
              <TouchableOpacity style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dieTitle}>
                    {item.dieSeries} / {item.dieSectionCode}
                  </Text>
                  {item.dieName ? (
                    <Text style={styles.dieSub}>{item.dieName}</Text>
                  ) : null}
                </View>
                <View style={styles.rowStats}>
                  <Text style={styles.statBig}>{Number(item.bundleCount)}</Text>
                  <Text style={styles.statSmall}>{Number(item.totalWeightG)} g</Text>
                </View>
              </TouchableOpacity>
            </Link>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No {status} stock.</Text>
          }
        />
      )}
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  filterChipActive: { backgroundColor: "#111827", borderColor: "#111827" },
  filterText: { color: "#374151", fontSize: 13, fontWeight: "500" },
  filterTextActive: { color: "white" },
  summaryGrid: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "white",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  summaryLabel: { fontSize: 10, color: "#6b7280" },
  summaryValue: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  dieTitle: { fontSize: 15, fontWeight: "600" },
  dieSub: { fontSize: 12, color: "#666", marginTop: 2 },
  rowStats: { alignItems: "flex-end" },
  statBig: { fontSize: 16, fontWeight: "700" },
  statSmall: { fontSize: 12, color: "#666" },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
});
