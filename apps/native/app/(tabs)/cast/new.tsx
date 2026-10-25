import { Stack } from "expo-router";
import { useT } from "@orrn/i18n";

import { NewCastView } from "@/features/foundry/new-cast-view";

export default function NewCastScreen() {
  const { t } = useT();
  return (
    <>
      <Stack.Screen options={{ title: t("foundry.newCast.title") }} />
      <NewCastView />
    </>
  );
}
