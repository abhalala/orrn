import { useT, type MessageKey } from "@orrn/i18n";
import Constants from "expo-constants";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { initials } from "@/components/account-button";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/sign-out";
import { useMe } from "@/utils/me";

/**
 * More: who is signed in and where, language, sign out. Task 29 adds the
 * Dies, Customers, Guides and Settings rows above the language switch.
 */
export default function MoreScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const version = Constants.expoConfig?.version;

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
