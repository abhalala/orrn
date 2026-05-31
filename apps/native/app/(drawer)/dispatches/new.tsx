import { useMutation, useQuery } from "@tanstack/react-query";
import { Picker } from "@react-native-picker/picker";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { queryClient, trpc } from "../../../utils/trpc";
import { Can } from "@/components/can";

export default function NewDispatchScreen() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: customersData } = useQuery({
    ...trpc.customer.list.queryOptions({ limit: 100, offset: 0 }),
  });

  const createMutation = useMutation({
    ...trpc.dispatch.create.mutationOptions(),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.queryKey() });
      router.replace(`/dispatches/${res.id}`);
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create dispatch");
    },
  });

  const handleSubmit = () => {
    if (!customerId) {
      Alert.alert("Validation", "Select a customer");
      return;
    }
    let shipMs: number | null = null;
    if (shipDate) {
      const parsed = new Date(shipDate);
      if (Number.isNaN(parsed.getTime())) {
        Alert.alert("Validation", "Ship date must be YYYY-MM-DD");
        return;
      }
      shipMs = parsed.getTime();
    }
    createMutation.mutate({
      customerId,
      shipDate: shipMs,
      notes: notes.trim() || null,
    });
  };

  return (
    <Can
      do="dispatch.create"
      fallback={
        <View style={[styles.container, styles.center]}>
          <Stack.Screen options={{ title: "New Dispatch" }} />
          <Text style={styles.deniedText}>You don't have permission to create dispatches.</Text>
        </View>
      }
    >
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        <Stack.Screen options={{ title: "New Dispatch" }} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Dispatch details</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Customer *</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={customerId}
              onValueChange={(val: string) => setCustomerId(val)}
              style={styles.picker}
            >
              <Picker.Item label="Select a customer..." value="" />
              {(customersData?.items ?? []).map((c) => (
                <Picker.Item key={c.id} label={c.name} value={c.id} />
              ))}
            </Picker>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Ship Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={shipDate}
            onChangeText={setShipDate}
            placeholder={Platform.OS === "ios" ? "2026-06-01" : "2026-06-01"}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, createMutation.isPending && styles.disabled]}
        onPress={handleSubmit}
        disabled={createMutation.isPending}
      >
        <Text style={styles.submitButtonText}>
          {createMutation.isPending ? "Creating..." : "Create draft"}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
      </ScrollView>
    </Can>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    gap: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "500", color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    overflow: "hidden",
  },
  picker: { height: 50 },
  submitButton: {
    backgroundColor: "#111827",
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitButtonText: { color: "white", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  deniedText: { fontSize: 15, color: "#64748b", textAlign: "center", paddingHorizontal: 24 },
});
