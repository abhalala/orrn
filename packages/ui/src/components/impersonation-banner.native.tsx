// @ts-nocheck — Bun resolves `react-native` to a different install for packages/ui
// vs apps/native; cross-workspace type equality fails. Metro+Babel bundle this
// correctly, so disabling the inner typecheck is safe.
import { Pressable, Text, View } from "react-native";

export type ImpersonationBannerProps = {
  companyName?: string | null;
  onStop: () => void;
  stopLabel?: string;
};

export function ImpersonationBanner({
  companyName,
  onStop,
  stopLabel = "Stop",
}: ImpersonationBannerProps) {
  return (
    <View
      style={{
        width: "100%",
        backgroundColor: "#dc2626",
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text
          style={{
            color: "#ffffff",
            fontWeight: "700",
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Impersonating
        </Text>
        <Text style={{ color: "#ffffff", fontSize: 13 }}>
          {companyName ?? "tenant"} — every action is audited.
        </Text>
      </View>
      <Pressable
        onPress={onStop}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: "#ffffff",
          borderRadius: 6,
        }}
      >
        <Text style={{ color: "#b91c1c", fontWeight: "600", fontSize: 12 }}>{stopLabel}</Text>
      </Pressable>
    </View>
  );
}
