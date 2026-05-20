import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList, View, Text, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { trpc } from "../../../utils/trpc";
import { format } from "date-fns";

export default function DiesScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.die.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <View style={styles.container}>
      <Stack.Screen 
        options={{ 
          title: "Dies",
          headerRight: () => (
            <Link href="/dies/new" asChild>
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
          placeholder="Search by name, series, section..."
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
            <Link href={`/dies/${item.id}`} asChild>
              <TouchableOpacity style={styles.card}>
                <View style={styles.header}>
                  <Text style={styles.series}>{item.series}</Text>
                  <Text style={[styles.status, item.status === 'active' ? styles.active : styles.archived]}>
                    {item.status}
                  </Text>
                </View>
                <Text style={styles.sectionCode}>Section: {item.sectionCode}</Text>
                {item.name ? <Text style={styles.detail}>{item.name}</Text> : null}
                <Text style={styles.detail}>Weight: {item.weightMinG}g - {item.weightMaxG}g</Text>
                <Text style={styles.date}>Created {format(new Date(item.createdAt), "MMM d, yyyy")}</Text>
              </TouchableOpacity>
            </Link>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {search ? "No dies found matching search." : "No dies yet."}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  addButton: {
    marginRight: 16,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  series: {
    fontSize: 18,
    fontWeight: "bold",
  },
  status: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  active: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  archived: {
    backgroundColor: "#f3f4f6",
    color: "#4b5563",
  },
  sectionCode: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  detail: {
    fontSize: 14,
    color: "#666",
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: "#999",
    marginTop: 8,
  },
  empty: {
    textAlign: "center",
    color: "#666",
    marginTop: 20,
  }
});
