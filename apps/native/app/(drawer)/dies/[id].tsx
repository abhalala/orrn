import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Picker } from "@react-native-picker/picker";

import { trpc, queryClient } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";

const dieStatuses = ["active", "archived"] as const;

export default function DieFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";
  const lu = useLengthUnit();

  const [series, setSeries] = useState("");
  const [sectionCode, setSectionCode] = useState("");
  const [name, setName] = useState("");
  const [weightMinG, setWeightMinG] = useState("0");
  const [weightMaxG, setWeightMaxG] = useState("0");
  const [status, setStatus] = useState<(typeof dieStatuses)[number]>("active");
  const [notes, setNotes] = useState("");
  
  // Dimensions
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [thicknessMm, setThicknessMm] = useState("");

  const { data: die, isLoading } = useQuery({
    ...trpc.die.get.queryOptions({ id: id as string }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (die && !isNew) {
      setSeries(die.series);
      setSectionCode(die.sectionCode);
      setName(die.name || "");
      setWeightMinG(die.weightMinG.toString());
      setWeightMaxG(die.weightMaxG.toString());
      setStatus(die.status);
      setNotes(die.notes || "");
      
      const dims: any = die.dimensions || {};
      setWidthMm(dims.widthMm != null ? lu.formatLengthValue(dims.widthMm) : "");
      setHeightMm(dims.heightMm != null ? lu.formatLengthValue(dims.heightMm) : "");
      setThicknessMm(dims.thicknessMm != null ? lu.formatLengthValue(dims.thicknessMm) : "");
    }
  }, [die, isNew, lu]);

  const createMutation = useMutation({
    ...trpc.die.create.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Die created");
      queryClient.invalidateQueries({ queryKey: trpc.die.list.queryKey() });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create die");
    }
  });

  const updateMutation = useMutation({
    ...trpc.die.update.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Die updated");
      queryClient.invalidateQueries({ queryKey: trpc.die.list.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.die.get.queryKey({ id: id as string }) });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to update die");
    }
  });

  const deleteMutation = useMutation({
    ...trpc.die.delete.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Die deleted");
      queryClient.invalidateQueries({ queryKey: trpc.die.list.queryKey() });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to delete die");
    }
  });

  const handleSave = () => {
    if (!series || !sectionCode) {
      Alert.alert("Validation Error", "Series and Section Code are required");
      return;
    }

    const wMin = Number(weightMinG);
    const wMax = Number(weightMaxG);

    if (isNaN(wMin) || isNaN(wMax) || wMin < 0 || wMax < 0) {
      Alert.alert("Validation Error", "Weights must be valid positive numbers");
      return;
    }

    if (wMin > wMax) {
      Alert.alert("Validation Error", "Min weight cannot be greater than max weight");
      return;
    }

    const payload = {
      series,
      sectionCode,
      name,
      weightMinG: wMin,
      weightMaxG: wMax,
      status,
      notes,
      dimensions: {
        widthMm: widthMm ? lu.parseLengthDecimal(widthMm) : undefined,
        heightMm: heightMm ? lu.parseLengthDecimal(heightMm) : undefined,
        thicknessMm: thicknessMm ? lu.parseLengthDecimal(thicknessMm) : undefined,
      }
    };

    if (isNew) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: id as string, ...payload });
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Die",
      "Are you sure you want to delete this die?",
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
          title: isNew ? "New Die" : "Edit Die",
          headerRight: () => !isNew ? (
            <TouchableOpacity onPress={handleDelete} disabled={deleteMutation.isPending}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          ) : undefined,
        }} 
      />

      <View style={styles.card}>
        <View style={styles.form}>
          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Series *</Text>
              <TextInput
                style={styles.input}
                value={series}
                onChangeText={setSeries}
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Section Code *</Text>
              <TextInput
                style={styles.input}
                value={sectionCode}
                onChangeText={setSectionCode}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Min Weight (g) *</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={weightMinG}
                onChangeText={setWeightMinG}
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Max Weight (g) *</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={weightMaxG}
                onChangeText={setWeightMaxG}
              />
            </View>
          </View>

          <View style={styles.fieldset}>
            <Text style={styles.legend}>Dimensions ({lu.label})</Text>
            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Width</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={widthMm}
                  onChangeText={setWidthMm}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Height</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={heightMm}
                  onChangeText={setHeightMm}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.subLabel}>Thickness</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={thicknessMm}
                  onChangeText={setThicknessMm}
                />
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={status}
                onValueChange={(itemValue: string) => setStatus(itemValue as any)}
                style={styles.picker}
              >
                <Picker.Item label="Active" value="active" />
                <Picker.Item label="Archived" value="archived" />
              </Picker>
            </View>
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
              {isSubmitting ? "Saving..." : "Save Die"}
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
  row: {
    flexDirection: "row",
    gap: 12,
  },
  inputGroup: {
    gap: 6,
  },
  fieldset: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  legend: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  subLabel: {
    fontSize: 12,
    color: "#666",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    overflow: "hidden",
  },
  picker: {
    height: 50,
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
