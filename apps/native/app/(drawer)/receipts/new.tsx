import { useMutation, useQuery } from "@tanstack/react-query";
import { Picker } from "@react-native-picker/picker";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Button } from "@orrn/ui/components/button";

import {
  ErpField,
  ErpListCard,
  ErpSectionTitle,
  ErpTextInput,
} from "@/components/erp";
import { queryClient, trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

type Row = { quantity: string; weightG: string; lengthMm: string; poNumber: string };

const emptyRow = (): Row => ({ quantity: "", weightG: "", lengthMm: "", poNumber: "" });

export default function NewReceiptScreen() {
  const router = useRouter();
  const lu = useLengthUnit();
  const [dieId, setDieId] = useState("");
  const [unit, setUnit] = useState(lu.unit);
  const [purchaseOrderRef, setPurchaseOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const { data: diesData } = useQuery({
    ...trpc.die.list.queryOptions({ limit: 100, offset: 0 }),
  });

  const createMutation = useMutation({
    ...trpc.bundle.createReceipt.mutationOptions(),
    onSuccess: (res: any) => {
      Alert.alert("Receipt created", `${res.code} · ${res.bundleCount} bundles`);
      queryClient.invalidateQueries({ queryKey: trpc.bundle.listGroups.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
      router.replace(`/receipts/${res.groupId}`);
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create receipt");
    },
  });

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const handleSubmit = () => {
    if (!dieId) {
      Alert.alert("Validation", "Select a die");
      return;
    }
    if (!unit.trim()) {
      Alert.alert("Validation", "Unit is required");
      return;
    }
    try {
      const parsedRows = rows.map((r, i) => {
        const q = Number(r.quantity);
        const w = parseInt(r.weightG, 10);
        const l = lu.parseLength(r.lengthMm);
        if (!Number.isInteger(q) || q < 1)
          throw new Error(`Row ${i + 1}: quantity must be a positive integer`);
        if (!Number.isInteger(w) || w < 0 || isNaN(w))
          throw new Error(`Row ${i + 1}: weight must be a non-negative integer`);
        if (l < 0)
          throw new Error(`Row ${i + 1}: length must be a non-negative integer`);
        return { quantity: q, weightG: w, lengthMm: l, poNumber: r.poNumber.trim() || null };
      });
      createMutation.mutate({
        dieId,
        unit: unit.trim(),
        purchaseOrderRef: purchaseOrderRef.trim() || null,
        notes: notes.trim() || null,
        rows: parsedRows,
      });
    } catch (err: any) {
      Alert.alert("Validation", err.message);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: "New Bundling Session" }} />

      <ErpListCard className="mx-4 mt-4 gap-4">
        <ErpSectionTitle>Bundling session details</ErpSectionTitle>

        <ErpField label="Die *">
          <View className="overflow-hidden rounded-md border border-border">
            <Picker
              selectedValue={dieId}
              onValueChange={(val: string) => setDieId(val)}
              style={{ height: 50 }}
            >
              <Picker.Item label="Select a die..." value="" />
              {(diesData?.items ?? []).map((d) => (
                <Picker.Item
                  key={d.id}
                  label={`${d.series} / ${d.sectionCode}${d.name ? ` — ${d.name}` : ""}`}
                  value={d.id}
                />
              ))}
            </Picker>
          </View>
        </ErpField>

        <ErpField label="Length unit *">
          <ErpTextInput
            value={unit}
            onChangeText={setUnit}
            placeholder="inch, mm..."
          />
        </ErpField>

        <ErpField label="PO Reference">
          <ErpTextInput value={purchaseOrderRef} onChangeText={setPurchaseOrderRef} />
        </ErpField>

        <ErpField label="Notes">
          <ErpTextInput value={notes} onChangeText={setNotes} />
        </ErpField>
      </ErpListCard>

      <ErpListCard className="mx-4 mt-4 gap-3">
        <View className="flex-row items-center justify-between">
          <ErpSectionTitle>Batch bundles ({rows.length})</ErpSectionTitle>
          <Pressable
            onPress={addRow}
            className="rounded-md border border-border px-3 py-1.5"
          >
            <Text className="text-sm font-medium text-foreground">+ Add row</Text>
          </Pressable>
        </View>

        {rows.map((row, idx) => (
          <View
            key={idx}
            className="flex-row items-end gap-2 border-t border-border py-2"
          >
            <Text className="w-6 pb-3 text-xs text-muted">#{idx + 1}</Text>
            <View className="flex-1 flex-row gap-1.5">
              <View className="flex-1">
                <ErpField label="Qty">
                  <ErpTextInput
                    keyboardType="number-pad"
                    value={row.quantity}
                    onChangeText={(v) => updateRow(idx, { quantity: v })}
                  />
                </ErpField>
              </View>
              <View className="flex-1">
                <ErpField label="Weight (g)">
                  <ErpTextInput
                    keyboardType="number-pad"
                    value={row.weightG}
                    onChangeText={(v) => updateRow(idx, { weightG: v })}
                  />
                </ErpField>
              </View>
              <View className="flex-1">
                <ErpField label={`Length (${lu.label})`}>
                  <ErpTextInput
                    keyboardType="number-pad"
                    value={row.lengthMm}
                    onChangeText={(v) => updateRow(idx, { lengthMm: v })}
                  />
                </ErpField>
              </View>
            </View>
            <View className="mt-2">
              <ErpField label="PO override">
                <ErpTextInput
                  value={row.poNumber}
                  onChangeText={(v) => updateRow(idx, { poNumber: v })}
                  placeholder={purchaseOrderRef || "Optional"}
                />
              </ErpField>
            </View>
            <Pressable
              onPress={() => removeRow(idx)}
              disabled={rows.length === 1}
              className={`h-10 w-8 items-center justify-center rounded-md bg-danger/10 ${rows.length === 1 ? "opacity-40" : ""}`}
            >
              <Text className="text-xl font-semibold text-danger">×</Text>
            </Pressable>
          </View>
        ))}
      </ErpListCard>

      <View className="mx-4 mt-4 min-h-12">
        <Button size="lg" disabled={createMutation.isPending} onPress={handleSubmit}>
          {createMutation.isPending ? "Saving..." : "Create session"}
        </Button>
      </View>

      <View className="h-8" />
    </ScrollView>
  );
}
