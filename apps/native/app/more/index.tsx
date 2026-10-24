import Feather from "@expo/vector-icons/Feather";
import { useT, type MessageKey } from "@orrn/i18n";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { initials } from "@/components/account-button";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { moreRows } from "@/features/more/more-rows";
import { signOut } from "@/lib/sign-out";
import { useThemeColor } from "@/lib/theme";
import { useMe } from "@/utils/me";

/**
 * More: who is signed in and where, Dies, Customers, Guides and Settings,
 * language, sign out.
 */
export default function MoreScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const version = Constants.expoConfig?.version;
  const router = useRouter();
  const ink = useThemeColor("foreground");
  const muted = useThemeColor("muted-foreground");
  const rows = moreRows(me);

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-4 pb-10 pt-2"
    >
      <View className="w-full max-w-[640px] gap-8 self-center">
        <View className="flex-row items-center gap-4 rounded-card border border-hairline bg-surface p-4">
          <View
            className="h-12 w-12 items-center justify-center rounded-full bg-primary"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <Text className="font-sans-semibold text-base text-primary-foreground" maxFontSizeMultiplier={1.2}>
              {initials(me?.user.name, me?.user.email)}
            </Text>
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="font-sans-semibold text-base text-ink" numberOfLines={2}>
              {me?.user.name}
            </Text>
            <Text className="font-sans text-sm text-ink-muted" numberOfLines={2}>
              {t("nav.signedInAs", { email: me?.user.email ?? "" })}
            </Text>
            {me?.company ? (
              <Text className="font-sans text-sm text-ink-muted" numberOfLines={2}>
                {me.company.name} · {t(`roles.${me.company.role}` as MessageKey)}
              </Text>
            ) : null}
          </View>
        </View>

        {rows.length > 0 ? (
          <View className="gap-2">
            {rows.map((row) => (
              <PressableScale
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={t(row.labelKey)}
                onPress={() => router.push(row.href)}
                className="min-h-14 flex-row items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
              >
                <View
                  className="h-10 w-10 items-center justify-center rounded-full bg-surface-sunken"
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  <Feather name={row.icon} size={20} color={ink} />
                </View>
                <Text className="min-w-0 flex-1 font-sans-semibold text-base text-ink">{t(row.labelKey)}</Text>
                <Feather name="chevron-right" size={20} color={muted} importantForAccessibility="no" />
              </PressableScale>
            ))}
          </View>
        ) : null}

        <LanguageSwitch />

        <View className="gap-3">
          <Button
            variant="secondary"
            size="lg"
            label={t("nav.signOut")}
            loading={signingOut}
            loadingLabel={t("native.signingOut")}
            onPress={async () => {
              setSigningOut(true);
              await signOut();
            }}
          />
          {version ? (
            <Text className="text-center font-sans text-xs text-ink-muted">{t("native.version", { version })}</Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
