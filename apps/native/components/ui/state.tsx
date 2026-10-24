import { useT } from "@orrn/i18n";
import { ActivityIndicator, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { offlineKind } from "@/lib/gate";
import { useThemeColor } from "@/lib/theme";

/** A screen's first load: a spinner that is announced as loading. */
export function LoadingBlock() {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} className="items-center py-10">
      <ActivityIndicator color={ink} />
    </View>
  );
}

/** A read that failed: network or server wording, and Try again. */
export function ErrorBlock({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const { t } = useT();
  const server = offlineKind(error) === "server";
  return (
    <View accessibilityLiveRegion="polite" className="items-center gap-3 rounded-card border border-hairline bg-surface p-6">
      <Text className="text-center font-sans text-[15px] leading-6 text-ink">{server ? t("native.serverBody") : t("errors.network")}</Text>
      <Button variant="secondary" label={t("common.retry")} loading={retrying} onPress={onRetry} className="self-stretch" />
    </View>
  );
}
