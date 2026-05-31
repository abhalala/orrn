import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from "react-native";

export function ErpScreen({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={`flex-1 bg-background ${className ?? ""}`}>{children}</View>;
}

export function ErpSearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  const muted = useThemeColor("muted");
  return (
    <View className="mx-4 mb-2 flex-row items-center rounded-lg border border-border bg-card px-3">
      <Ionicons name="search" size={20} color={muted} style={{ marginRight: 8 }} />
      <TextInput
        className="flex-1 py-3 text-base text-foreground"
        placeholder={placeholder}
        placeholderTextColor={muted}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
      />
    </View>
  );
}

export function ErpFilterRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-2 px-4 pb-2">{children}</View>
    </ScrollView>
  );
}

export function ErpFilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-1.5 ${active ? "border-foreground bg-foreground" : "border-border bg-card"}`}
    >
      <Text className={`text-sm font-medium ${active ? "text-background" : "text-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ErpListCard({
  children,
  className,
  ...props
}: ViewProps & { children: ReactNode; className?: string }) {
  return (
    <View
      className={`rounded-lg border border-border bg-card p-4 ${className ?? ""}`}
      {...props}
    >
      {children}
    </View>
  );
}

export function ErpCardPressable({
  children,
  onPress,
  className,
}: {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-lg border border-border bg-card p-4 active:opacity-80 ${className ?? ""}`}
    >
      {children}
    </Pressable>
  );
}

export function ErpRowBetween({ children }: { children: ReactNode }) {
  return <View className="flex-row items-center justify-between gap-3">{children}</View>;
}

export function ErpMutedText({ children, className }: { children: ReactNode; className?: string }) {
  return <Text className={`text-sm text-muted ${className ?? ""}`}>{children}</Text>;
}

export function ErpTitleText({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <Text className={`text-base font-semibold text-foreground ${mono ? "font-mono" : ""}`}>
      {children}
    </Text>
  );
}

export function ErpSectionTitle({ children }: { children: ReactNode }) {
  return <Text className="text-lg font-semibold text-foreground">{children}</Text>;
}

export function ErpEmpty({ children }: { children: ReactNode }) {
  return <Text className="mt-5 text-center text-sm text-muted">{children}</Text>;
}

export function ErpLoading() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" />
    </View>
  );
}

export function ErpField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {children}
    </View>
  );
}

export function ErpTextInput(props: TextInputProps) {
  const muted = useThemeColor("muted");
  return (
    <TextInput
      className="rounded-md border border-border bg-card px-3 py-2.5 text-base text-foreground"
      placeholderTextColor={muted}
      {...props}
    />
  );
}

export function ErpKvRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View className="min-h-7 flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted">{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text className="text-base font-medium text-foreground">{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function ErpSummaryGrid({ children }: { children: ReactNode }) {
  return <View className="mb-3 flex-row gap-2 px-4">{children}</View>;
}

export function ErpSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-lg border border-border bg-card p-2.5">
      <Text className="text-[10px] text-muted">{label}</Text>
      <Text className="mt-0.5 text-base font-bold text-foreground">{value}</Text>
    </View>
  );
}
