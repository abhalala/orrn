import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList, View, Text, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { trpc } from "../../../utils/trpc";

export default function CustomersScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.customer.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Customers" }} />

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers..."
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
            <Link href={`/customers/${item.id}`} asChild>
              <TouchableOpacity style={styles.card}>
                <Text style={styles.name}>{item.name}</Text>
                {item.email ? <Text style={styles.detail}>{item.email}</Text> : null}
                {item.phone ? <Text style={styles.detail}>{item.phone}</Text> : null}
              </TouchableOpacity>
            </Link>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {search ? "No customers found matching search." : "No customers yet."}
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
  name: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  detail: {
    fontSize: 14,
    color: "#666",
  },
  empty: {
    textAlign: "center",
    color: "#666",
    marginTop: 20,
  }
});
