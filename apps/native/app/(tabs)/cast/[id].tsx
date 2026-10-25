import { useT } from "@orrn/i18n";
import { Stack, useLocalSearchParams } from "expo-router";

import { Screen } from "@/components/ui/screen";
import { CastDetail } from "@/features/foundry/cast-detail";

/** One cast by id (from a Stock card or a link). */
export default function CastByIdScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Stack.Screen options={{ title: t("foundry.casts.title") }} />
      {id ? <CastDetail id={id} /> : null}
    </Screen>
  );
}
