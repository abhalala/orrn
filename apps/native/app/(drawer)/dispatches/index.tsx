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
import { format } from "date-fns";

import { trpc } from "../../../utils/trpc";
import { Can } from "@/components/can";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];
type StatusFilter = DispatchStatus | "all";

const STATUS_FILTERS: StatusFilter[] = ["all", ...dispatchStatuses];

function statusStyle(status: DispatchStatus) {
  switch (status) {
    case "draft":
      return { backgroundColor: "#f3f4f6", color: "#4b5563" };
    case "reserved":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "completed":
      return { backgroundColor: "#dcfce7", color: "#166534" };
    case "cancelled":
      return { backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
}

export default function DispatchesScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({
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
          title: "Dispatches",
          headerRight: () => (
            <Can do="dispatch.create">
              <Link href="/dispatches/new" asChild>
                <TouchableOpacity style={styles.addButton} accessibilityLabel="New dispatch">
                  <Ionicons name="add" size={24} color="#007AFF" />
                </TouchableOpacity>
              </Link>
            </Can>
          ),
        }}
      />

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by code or notes..."
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
              <Link href={`/dispatches/${item.id}`} asChild>
                <TouchableOpacity style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.code}>{item.code}</Text>
                    <Text style={[styles.pill, { backgroundColor: s.backgroundColor, color: s.color }]}>
                      {item.status}
                    </Text>
                  </View>
                  <Text style={styles.meta}>{item.customerName}</Text>
                  <Text style={styles.meta}>
                    {Number(item.itemCount)} bundles · {Number(item.totalWeightG)} g
                  </Text>
                  {item.shipDate ? (
                    <Text style={styles.meta}>
                      Ship: {format(new Date(item.shipDate), "MMM d, yyyy")}
                    </Text>
                  ) : null}
                  <Text style={styles.date}>
                    Created {format(new Date(item.createdAt), "MMM d, yyyy")}
                  </Text>
                </TouchableOpacity>
              </Link>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {search ? "No dispatches match this search." : "No dispatches yet. Tap + to create one."}
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
  code: { fontSize: 16, fontWeight: "700", fontFamily: "Menlo" },
  pill: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  meta: { fontSize: 13, color: "#444", marginBottom: 2 },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
});
