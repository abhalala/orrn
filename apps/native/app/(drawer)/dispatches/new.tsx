import { useMutation, useQuery } from "@tanstack/react-query";
import { Picker } from "@react-native-picker/picker";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { Button } from "@orrn/ui/components/button";
import { TextArea } from "@orrn/ui/components/input";

import {
  ErpField,
  ErpListCard,
  ErpMutedText,
  ErpScreen,
  ErpSectionTitle,
  ErpTextInput,
} from "@/components/erp";
import { Can } from "@/components/can";
import { queryClient, trpc } from "../../../utils/trpc";

export default function NewDispatchScreen() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
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
      invoiceNo: invoiceNo.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Can
      do="dispatch.create"
      fallback={
        <ErpScreen className="items-center justify-center">
          <Stack.Screen options={{ title: "New Dispatch" }} />
          <ErpMutedText className="px-6 text-center">
            You don't have permission to create dispatches.
          </ErpMutedText>
        </ErpScreen>
      }
    >
      <ScrollView
        className="flex-1 bg-background"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <Stack.Screen options={{ title: "New Dispatch" }} />

        <ErpListCard className="mx-4 mt-4 gap-4">
          <ErpSectionTitle>Dispatch details</ErpSectionTitle>

          <ErpField label="Customer *">
            <View className="overflow-hidden rounded-md border border-border">
              <Picker
                selectedValue={customerId}
                onValueChange={(val: string) => setCustomerId(val)}
                style={{ height: 50 }}
              >
                <Picker.Item label="Select a customer..." value="" />
                {(customersData?.items ?? []).map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </View>
          </ErpField>

          <ErpField label="Ship Date (YYYY-MM-DD)">
            <ErpTextInput
              value={shipDate}
              onChangeText={setShipDate}
              placeholder={Platform.OS === "ios" ? "2026-06-01" : "2026-06-01"}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ErpField>

          <ErpField label="Invoice no">
            <ErpTextInput
              value={invoiceNo}
              onChangeText={setInvoiceNo}
              maxLength={64}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </ErpField>

          <ErpField label="Notes">
            <TextArea value={notes} onChangeText={setNotes} rows={3} />
          </ErpField>
        </ErpListCard>

        <View className="mx-4 mt-4 min-h-12">
          <Button
            size="lg"
            disabled={createMutation.isPending}
            onPress={handleSubmit}
          >
            {createMutation.isPending ? "Creating..." : "Create draft"}
          </Button>
        </View>

        <View className="h-8" />
      </ScrollView>
    </Can>
  );
}
