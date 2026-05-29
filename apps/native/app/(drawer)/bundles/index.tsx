import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];
type StatusFilter = BundleStatus | "all";

const STATUS_FILTERS: StatusFilter[] = ["all", ...bundleStatuses];

function statusStyle(status: BundleStatus) {
  switch (status) {
    case "available":
      return { backgroundColor: "#dcfce7", color: "#166534" };
    case "reserved":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "dispatched":
      return { backgroundColor: "#dbeafe", color: "#1e40af" };
    case "void":
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
  }
}

export default function BundlesScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      search: search || undefined,
      status: status === "all" ? undefined : status,
      limit: 50,
      offset: 0,
    }),
  });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Bundles",
          headerRight: () => (
            <Link href="/receipts/new" asChild>
              <TouchableOpacity style={styles.addButton}>
                <Ionicons name="add" size={24} color="#007AFF" />
              </TouchableOpacity>
            </Link>
          ),
        }}
      />

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by serial..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map((f) => {
          const active = f === status;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setStatus(f)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const s = statusStyle(item.status);
            return (
              <Link href={`/bundles/${item.id}`} asChild>
                <TouchableOpacity style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.serial}>{item.serial}</Text>
                    <Text
                      style={[
                        styles.statusPill,
                        { backgroundColor: s.backgroundColor, color: s.color },
                      ]}
                    >
                      {item.status}
                    </Text>
                  </View>
                  <Text style={styles.meta}>
                    Die: {item.dieSeries} / {item.dieSectionCode}
                  </Text>
                  <Text style={styles.meta}>Receipt: {item.groupCode}</Text>
                  <Text style={styles.detail}>
                    Qty {item.quantity} · {item.weightG}g · {lu.formatLength(item.lengthMm)}
                  </Text>
                </TouchableOpacity>
              </Link>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {search ? "No bundles match this search." : "No bundles yet."}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
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
  addButton: { marginRight: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  serial: { fontSize: 15, fontWeight: "600", fontFamily: "Menlo" },
  statusPill: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  meta: { fontSize: 13, color: "#444", marginBottom: 2 },
  detail: { fontSize: 13, color: "#666", marginTop: 4 },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
});
