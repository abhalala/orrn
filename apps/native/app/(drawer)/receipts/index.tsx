import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";

import { trpc } from "../../../utils/trpc";

export default function ReceiptsScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listGroups.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Receipts",
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
          placeholder="Search by code or PO ref..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/receipts/${item.id}`} asChild>
              <TouchableOpacity style={styles.card}>
                <Text style={styles.code}>{item.code}</Text>
                <Text style={styles.detail}>
                  Die: {item.dieSeries} / {item.dieSectionCode} · {item.unit}
                </Text>
                {item.purchaseOrderRef ? (
                  <Text style={styles.detail}>PO: {item.purchaseOrderRef}</Text>
                ) : null}
                <Text style={styles.detail}>
                  {Number(item.bundleCount)} bundles · {Number(item.totalWeightG)} g total
                </Text>
                <Text style={styles.date}>
                  {format(new Date(item.createdAt), "MMM d, yyyy")}
                </Text>
              </TouchableOpacity>
            </Link>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {search
                ? "No receipts match this search."
                : "No receipts yet. Tap + to create one."}
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
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16 },
  addButton: { marginRight: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  code: { fontSize: 16, fontWeight: "700", fontFamily: "Menlo", marginBottom: 6 },
  detail: { fontSize: 13, color: "#444", marginBottom: 2 },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  empty: { textAlign: "center", color: "#666", marginTop: 20 },
});
