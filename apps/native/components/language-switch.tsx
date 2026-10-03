import { LOCALE_NAMES, LOCALES, useT, type Locale } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { c2 } from "@orrn/ui/tokens";
import { Pressable, Text, View } from "react-native";

/**
 * English / हिंदी toggle (spec §2: on the login screen and in More). A radio
 * group: each option names itself in its own script and says it is selected.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, locale, setLocale } = useT();

  return (
    <View className={cn("gap-2", className)}>
      <Text nativeID="language-label" className="font-sans-medium text-sm text-ink">
        {t("common.language")}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabelledBy="language-label"
        accessibilityLabel={t("common.language")}
        className="flex-row gap-1 rounded-full bg-surface-sunken p-1"
      >
        {LOCALES.map((code: Locale) => {
          const selected = code === locale;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected }}
              accessibilityLanguage={code === "hi" ? "hi-IN" : "en-IN"}
              accessibilityLabel={LOCALE_NAMES[code]}
              onPress={() => setLocale(code)}
              className={cn(
                "min-h-11 flex-1 items-center justify-center rounded-full px-4",
                selected ? "bg-surface" : "active:opacity-70",
              )}
              style={selected ? { shadowColor: c2.light.ink, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : undefined}
            >
              <Text className={cn("text-[15px] text-ink", selected ? "font-sans-semibold" : "font-sans")}>
                {LOCALE_NAMES[code]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
