import { useT, type MessageKey } from "@orrn/i18n";
import { getGuide, isGuideSlug } from "@orrn/i18n/guides";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";

/**
 * One guide in the current language: when to use it, the numbered steps, and
 * what to do if something goes wrong. The How to button on every screen opens
 * this with the guide for that job.
 */
export default function GuideScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  if (!slug || !isGuideSlug(slug)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("nav.guides") }} />
        <EmptyState
          title={t("native.more.guideMissing")}
          actionLabel={t("native.more.guideBack")}
          onAction={() => (router.canGoBack() ? router.back() : router.replace("/more/guides"))}
        />
      </Screen>
    );
  }

  const guide = getGuide(slug, locale);
  const roles = guide.roles.map((r) => t(`roles.${r}` as MessageKey)).join(", ");

  return (
    <Screen>
      <Stack.Screen options={{ title: t("nav.guides") }} />
      <PageHeader title={guide.title} subtitle={t("guides.forRoles", { roles })} />

      <View className="gap-1 rounded-card border border-hairline bg-surface p-5">
        <Text className="font-sans-semibold text-[13px] text-ink-muted">{t("guides.when")}</Text>
        <Text className="font-sans text-base leading-6 text-ink">{guide.when}</Text>
      </View>

      <Text accessibilityRole="header" className="mt-2 font-display-bold text-xl text-ink">
        {t("guides.steps")}
      </Text>
      <View className="gap-3">
        {guide.steps.map((step, i) => (
          <View
            key={step.title}
            accessible
            accessibilityLabel={`${t("guides.step", { n: i + 1 })}. ${step.title}. ${step.body}`}
            className="flex-row gap-3 rounded-card border border-hairline bg-surface p-4"
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary" importantForAccessibility="no-hide-descendants">
              <Text className="font-display-bold text-base text-primary-foreground">
                {i + 1}
              </Text>
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-sans-semibold text-base text-ink">{step.title}</Text>
              <Text className="font-sans text-[15px] leading-6 text-ink">{step.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {guide.problems.length > 0 ? (
        <>
          <Text accessibilityRole="header" className="mt-2 font-display-bold text-xl text-ink">
            {t("guides.problems")}
          </Text>
          <View className="gap-3">
            {guide.problems.map((p) => (
              <View key={p.title} accessible accessibilityLabel={`${p.title}. ${p.fix}`} className="gap-1 rounded-card border border-hairline bg-surface-sunken p-4">
                <Text className="font-sans-semibold text-base text-ink">{p.title}</Text>
                <Text className="font-sans text-[15px] leading-6 text-ink">{p.fix}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
