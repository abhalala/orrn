import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { ActionBar } from "@/features/dispatch/action-bar";

import type { SaveProblem } from "./review-step";

export function PackReviewActionBar({ saving, problem, onSave, onBack }: { saving: boolean; problem: SaveProblem | null; onSave: () => void; onBack: () => void }) {
  const { t } = useT();
  return (
    <ActionBar>
      {problem ? (
        <View accessibilityLiveRegion="polite" testID="pack-review-problem" className="gap-1 rounded-card bg-tone-red-tint p-4">
          <Text className="font-sans-semibold text-base text-tone-red-ink">{problem.title}</Text>
          {problem.body ? <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{problem.body}</Text> : null}
        </View>
      ) : null}
      <Button size="lg" testID="pack-review-save" label={t("pack.new.saveOnly")} loading={saving} loadingLabel={t("common.saving")} onPress={onSave} />
      <Button variant="ghost" testID="pack-review-edit" label={t("native.pack.editBundles")} disabled={saving} onPress={onBack} />
    </ActionBar>
  );
}
