import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import type { GuideSlug } from "@orrn/i18n/guides";
import { useRouter } from "expo-router";
import { Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

export type HowToButtonProps = {
  slug: GuideSlug;
  /** Spoken name, e.g. "How to reprint"; defaults to the plain "How to". */
  label?: string;
};

/** A small link to the guide for the job on this screen (opens More, Guides). */
export function HowToButton({ slug, label }: HowToButtonProps) {
  const { t } = useT();
  const router = useRouter();
  const ink = useThemeColor("foreground");
  const name = label ?? t("common.howTo");
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={name}
      onPress={() => router.push({ pathname: "/more/guides/[slug]", params: { slug } })}
      hitSlop={6}
      className="min-h-11 flex-row items-center gap-1.5 self-start rounded-full px-3"
    >
      <Feather name="help-circle" size={18} color={ink} />
      <Text className="font-sans-medium text-sm text-ink">{t("common.howTo")}</Text>
    </PressableScale>
  );
}
