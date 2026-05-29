import { useMutation, useQuery } from "@tanstack/react-query";
import { Picker } from "@react-native-picker/picker";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { queryClient, trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

type Row = { quantity: string; weightG: string; lengthMm: string };

const emptyRow = (): Row => ({ quantity: "", weightG: "", lengthMm: "" });

export default function NewReceiptScreen() {
  const router = useRouter();
  const [dieId, setDieId] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [purchaseOrderRef, setPurchaseOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const lu = useLengthUnit();

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
        return { quantity: q, weightG: w, lengthMm: l };
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
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "New Receipt" }} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Receipt details</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Die *</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={dieId}
              onValueChange={(val: string) => setDieId(val)}
              style={styles.picker}
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
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Unit *</Text>
          <TextInput
            style={styles.input}
            value={unit}
            onChangeText={setUnit}
            placeholder="pcs, kg, m..."
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>PO Reference</Text>
          <TextInput
            style={styles.input}
            value={purchaseOrderRef}
            onChangeText={setPurchaseOrderRef}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Notes</Text>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.bundlesHeader}>
          <Text style={styles.sectionTitle}>Bundles ({rows.length})</Text>
          <TouchableOpacity onPress={addRow} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>+ Add row</Text>
          </TouchableOpacity>
        </View>

        {rows.map((row, idx) => (
          <View key={idx} style={styles.bundleRow}>
            <Text style={styles.rowNum}>#{idx + 1}</Text>
            <View style={styles.rowFields}>
              <View style={styles.rowField}>
                <Text style={styles.subLabel}>Qty</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={row.quantity}
                  onChangeText={(v) => updateRow(idx, { quantity: v })}
                />
              </View>
              <View style={styles.rowField}>
                <Text style={styles.subLabel}>Weight (g)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={row.weightG}
                  onChangeText={(v) => updateRow(idx, { weightG: v })}
                />
              </View>
              <View style={styles.rowField}>
                <Text style={styles.subLabel}>Length ({lu.label})</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={row.lengthMm}
                  onChangeText={(v) => updateRow(idx, { lengthMm: v })}
                />
              </View>
            </View>
            <TouchableOpacity
              onPress={() => removeRow(idx)}
              disabled={rows.length === 1}
              style={[styles.removeButton, rows.length === 1 && styles.disabled]}
            >
              <Text style={styles.removeButtonText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.submitButton, createMutation.isPending && styles.disabled]}
        onPress={handleSubmit}
        disabled={createMutation.isPending}
      >
        <Text style={styles.submitButtonText}>
          {createMutation.isPending ? "Saving..." : "Create receipt"}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
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
  subLabel: { fontSize: 12, color: "#666", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    overflow: "hidden",
  },
  picker: { height: 50 },
  bundlesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d4d4d8",
  },
  smallButtonText: { fontSize: 13, fontWeight: "500" },
  bundleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  rowNum: { fontSize: 12, color: "#6b7280", width: 24, paddingBottom: 12 },
  rowFields: { flex: 1, flexDirection: "row", gap: 6 },
  rowField: { flex: 1 },
  removeButton: {
    width: 32,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#fee2e2",
  },
  removeButtonText: { color: "#b91c1c", fontSize: 22, fontWeight: "600" },
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
});
