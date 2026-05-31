import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState, useEffect } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Button } from "@orrn/ui/components/button";
import { TextArea } from "@orrn/ui/components/input";

import {
  ErpField,
  ErpListCard,
  ErpLoading,
  ErpScreen,
  ErpTextInput,
} from "@/components/erp";
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
    },
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
    },
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
    },
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
          onPress: () => deleteMutation.mutate({ id: id as string }),
        },
      ],
    );
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (!isNew && isLoading) {
    return (
      <ErpScreen>
        <ErpLoading />
      </ErpScreen>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen
        options={{
          title: isNew ? "New Customer" : "Edit Customer",
          headerRight: () =>
            !isNew ? (
              <TouchableOpacity onPress={handleDelete} disabled={deleteMutation.isPending}>
                <Text className="mr-4 text-base font-medium text-danger">Delete</Text>
              </TouchableOpacity>
            ) : undefined,
        }}
      />

      <ErpListCard className="mx-4 mt-4 gap-4">
        <ErpField label="Name *">
          <ErpTextInput placeholder="Acme Corp" value={name} onChangeText={setName} />
        </ErpField>

        <ErpField label="Email">
          <ErpTextInput
            placeholder="contact@acme.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
        </ErpField>

        <ErpField label="Phone">
          <ErpTextInput
            placeholder="+1 (555) 000-0000"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        </ErpField>

        <ErpField label="Tax ID">
          <ErpTextInput value={taxId} onChangeText={setTaxId} />
        </ErpField>

        <ErpField label="Notes">
          <TextArea value={notes} onChangeText={setNotes} rows={4} />
        </ErpField>

        <View className="mt-2 min-h-12">
          <Button size="lg" disabled={isSubmitting} onPress={handleSave}>
            {isSubmitting ? "Saving..." : "Save Customer"}
          </Button>
        </View>
      </ErpListCard>

      <View className="h-8" />
    </ScrollView>
  );
}
