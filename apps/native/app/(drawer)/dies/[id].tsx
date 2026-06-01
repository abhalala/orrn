import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState, useEffect } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
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

  const [widthMm, setWidthMm] = useState("");
  const [legMm, setLegMm] = useState("");
  const [thicknessMm, setThicknessMm] = useState("");
  const [obliqueMm, setObliqueMm] = useState("");

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
      setWidthMm(die.widthMm != null ? lu.formatLengthValue(die.widthMm) : dims.widthMm != null ? lu.formatLengthValue(dims.widthMm) : "");
      setLegMm(die.legMm != null ? lu.formatLengthValue(die.legMm) : "");
      setThicknessMm(die.thicknessMm != null ? lu.formatLengthValue(die.thicknessMm) : dims.thicknessMm != null ? lu.formatLengthValue(dims.thicknessMm) : "");
      setObliqueMm(die.obliqueMm != null ? lu.formatLengthValue(die.obliqueMm) : "");
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
    },
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
    },
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
    },
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
      obliqueMm: obliqueMm ? lu.parseLengthDecimal(obliqueMm) : null,
      legMm: legMm ? lu.parseLengthDecimal(legMm) : null,
      widthMm: widthMm ? lu.parseLengthDecimal(widthMm) : null,
      thicknessMm: thicknessMm ? lu.parseLengthDecimal(thicknessMm) : null,
      dimensions: {
        widthMm: widthMm ? lu.parseLengthDecimal(widthMm) : undefined,
        thicknessMm: thicknessMm ? lu.parseLengthDecimal(thicknessMm) : undefined,
      },
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
          title: isNew ? "New Die" : "Edit Die",
          headerRight: () =>
            !isNew ? (
              <TouchableOpacity onPress={handleDelete} disabled={deleteMutation.isPending}>
                <Text className="mr-4 text-base font-medium text-danger">Delete</Text>
              </TouchableOpacity>
            ) : undefined,
        }}
      />

      <ErpListCard className="mx-4 mt-4 gap-4">
        <View className="flex-row gap-3">
          <View className="flex-1">
            <ErpField label="Series *">
              <ErpTextInput value={series} onChangeText={setSeries} />
            </ErpField>
          </View>
          <View className="flex-1">
            <ErpField label="Section Code *">
              <ErpTextInput value={sectionCode} onChangeText={setSectionCode} />
            </ErpField>
          </View>
        </View>

        <ErpField label="Name">
          <ErpTextInput value={name} onChangeText={setName} />
        </ErpField>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <ErpField label="Min Weight (g) *">
              <ErpTextInput
                keyboardType="numeric"
                value={weightMinG}
                onChangeText={setWeightMinG}
              />
            </ErpField>
          </View>
          <View className="flex-1">
            <ErpField label="Max Weight (g) *">
              <ErpTextInput
                keyboardType="numeric"
                value={weightMaxG}
                onChangeText={setWeightMaxG}
              />
            </ErpField>
          </View>
        </View>

        <View className="gap-2 rounded-lg border border-border p-3">
          <Text className="text-sm font-semibold text-foreground">
            Nexus die geometry ({lu.label})
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <ErpField label="Width">
                <ErpTextInput keyboardType="numeric" value={widthMm} onChangeText={setWidthMm} />
              </ErpField>
            </View>
            <View className="flex-1">
              <ErpField label="Thickness">
                <ErpTextInput keyboardType="numeric" value={thicknessMm} onChangeText={setThicknessMm} />
              </ErpField>
            </View>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <ErpField label="Leg">
                <ErpTextInput keyboardType="numeric" value={legMm} onChangeText={setLegMm} />
              </ErpField>
            </View>
            <View className="flex-1">
              <ErpField label="Oblique">
                <ErpTextInput keyboardType="numeric" value={obliqueMm} onChangeText={setObliqueMm} />
              </ErpField>
            </View>
          </View>
        </View>

        <ErpField label="Status">
          <View className="overflow-hidden rounded-md border border-border">
            <Picker
              selectedValue={status}
              onValueChange={(itemValue: string) => setStatus(itemValue as any)}
              style={{ height: 50 }}
            >
              <Picker.Item label="Active" value="active" />
              <Picker.Item label="Archived" value="archived" />
            </Picker>
          </View>
        </ErpField>

        <ErpField label="Notes">
          <TextArea value={notes} onChangeText={setNotes} rows={4} />
        </ErpField>

        <View className="mt-2 min-h-12">
          <Button size="lg" disabled={isSubmitting} onPress={handleSave}>
            {isSubmitting ? "Saving..." : "Save Die"}
          </Button>
        </View>
      </ErpListCard>

      <View className="h-8" />
    </ScrollView>
  );
}
