import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from "react-native";

import { trpc, queryClient } from "../../../utils/trpc";

export default function CustomerFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");

  const { data: customer, isLoading } = useQuery({
    ...trpc.customer.get.queryOptions({ id: id as string }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (customer && !isNew) {
      setName(customer.name);
      setEmail(customer.email || "");
      setPhone(customer.phone || "");
      setTaxId(customer.taxId || "");
      setNotes(customer.notes || "");
    }
  }, [customer, isNew]);

  const createMutation = useMutation({
    ...trpc.customer.create.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Customer created");
      queryClient.invalidateQueries({ queryKey: trpc.customer.list.queryKey() });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create customer");
    }
  });

  const updateMutation = useMutation({
    ...trpc.customer.update.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Customer updated");
      queryClient.invalidateQueries({ queryKey: trpc.customer.list.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.customer.get.queryKey({ id: id as string }) });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to update customer");
    }
  });

  const deleteMutation = useMutation({
    ...trpc.customer.delete.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Customer deleted");
      queryClient.invalidateQueries({ queryKey: trpc.customer.list.queryKey() });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to delete customer");
    }
  });

  const handleSave = () => {
    if (!name) {
      Alert.alert("Validation Error", "Name is required");
      return;
    }

    const payload = {
      name,
      email,
      phone,
      taxId,
      notes,
    };

    if (isNew) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: id as string, ...payload });
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Customer",
      "Are you sure you want to delete this customer?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: () => deleteMutation.mutate({ id: id as string }) 
        },
      ]
    );
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (!isNew && isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen 
        options={{ 
          title: isNew ? "New Customer" : "Edit Customer",
          headerRight: () => !isNew ? (
            <TouchableOpacity onPress={handleDelete} disabled={deleteMutation.isPending}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          ) : undefined,
        }} 
      />

      <View style={styles.card}>
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Acme Corp"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="contact@acme.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="+1 (555) 000-0000"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Tax ID</Text>
            <TextInput
              style={styles.input}
              value={taxId}
              onChangeText={setTaxId}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              numberOfLines={4}
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          <TouchableOpacity 
            style={[styles.button, isSubmitting && styles.buttonDisabled]} 
            onPress={handleSave}
            disabled={isSubmitting}
          >
            <Text style={styles.buttonText}>
              {isSubmitting ? "Saving..." : "Save Customer"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
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
  card: {
    backgroundColor: "white",
    margin: 16,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  button: {
    backgroundColor: "#000",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  deleteText: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "500",
    marginRight: 16,
  },
});
