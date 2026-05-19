import { trpc } from "../../utils/trpc";
import { FlatList, View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { format } from "date-fns";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

export default function MembersScreen() {
  const { data: members, isLoading } = useQuery(trpc.company.membersList.queryOptions());

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Team Members" }} />
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.name}>{item.user.name}</Text>
              <Text style={styles.role}>{item.role}</Text>
            </View>
            <Text style={styles.email}>{item.user.email}</Text>
            <Text style={styles.joined}>Joined {format(new Date(item.createdAt), "MMM d, yyyy")}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No members found.</Text>}
      />
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
  list: {
    padding: 16,
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
  name: {
    fontSize: 16,
    fontWeight: "600",
  },
  role: {
    fontSize: 12,
    fontWeight: "500",
    textTransform: "capitalize",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  email: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  joined: {
    fontSize: 12,
    color: "#999",
  },
  empty: {
    textAlign: "center",
    color: "#666",
    marginTop: 20,
  }
});
