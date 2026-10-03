import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useMe } from "@/utils/me";

/** First letters of the first two words: "Ravi Patel" -> "RP". */
export function initials(name: string | undefined | null, email?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join("");
  return (email ?? "?").slice(0, 1).toUpperCase();
}

/**
 * The avatar in every tab header. Opens More (Dies, Customers, Guides,
 * Settings, language, sign out). 44pt target around a 34pt circle.
 */
export function AccountButton() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("nav.openAccount")}
      hitSlop={4}
      onPress={() => router.push("/more")}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
    >
      <View className="h-[34px] w-[34px] items-center justify-center rounded-full bg-primary">
        <Text className="font-sans-semibold text-[13px] text-primary-foreground" maxFontSizeMultiplier={1.2}>
          {initials(me?.user.name, me?.user.email)}
        </Text>
      </View>
    </Pressable>
  );
}
