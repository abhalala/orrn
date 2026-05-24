import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Stack } from "expo-router";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

/**
 * Read-only waitlist review for platform admins. Approve/reject stays web-only.
 */
export default function PlatformWaitlistScreen() {
  const { data: requests, isLoading, error } = useQuery(trpc.platform.waitlistList.queryOptions());

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Unable to load waitlist.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Waitlist" }} />
      <Text style={styles.hint}>Read-only on mobile — approve or reject from the web console.</Text>
      <FlatList
        data={requests ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.company}>{item.companyName}</Text>
            <Text style={styles.meta}>
              {item.requesterName} · {item.requesterEmail}
            </Text>
            <Text style={styles.date}>{format(new Date(item.createdAt), "MMM d, yyyy")}</Text>
            {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No pending waitlist requests.</Text>}
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
  hint: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    fontSize: 13,
    color: "#666",
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
  company: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  meta: {
    fontSize: 14,
    color: "#444",
  },
  date: {
    marginTop: 6,
    fontSize: 12,
    color: "#888",
  },
  notes: {
    marginTop: 8,
    fontSize: 13,
    color: "#555",
  },
  empty: {
    textAlign: "center",
    color: "#888",
    marginTop: 24,
  },
  error: {
    color: "#b91c1c",
  },
});
