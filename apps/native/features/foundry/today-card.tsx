import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { showsFoundryToday } from "./foundry-model";

/**
 * The Foundry tile on Today for people who open casts: open casts and drafts not locked yet, from the
 * server's own counts (`casts.list` status open). Tapping it opens the Cast tab.
 */
export function FoundryToday() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const on = showsFoundryToday(me);
  const open = useQuery({ ...trpc.foundry.casts.list.queryOptions({ status: "open", limit: 50, offset: 0 }), enabled: on });
  if (!on) return null;
  const drafts = (open.data?.items ?? []).reduce((s, c) => s + c.draftMelts, 0);
  const total = open.data?.total ?? 0;
  const label = `${t("foundry.today.title")}, ${t("foundry.today.openCasts")} ${total}, ${t("foundry.today.melts")} ${drafts}`;
  return (
    <Can do="cast.enter">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => router.push("/cast" as never)}
        className="min-h-[88px] justify-between gap-3 rounded-block bg-tone-blue p-4"
      >
        <Text className="font-display-bold text-lg text-tone-blue-on">{t("foundry.today.title")}</Text>
        <View className="flex-row gap-6">
          <View>
            <Text className="font-display-extrabold text-3xl text-tone-blue-on">{total}</Text>
            <Text className="font-sans-medium text-[13px] text-tone-blue-on">{t("foundry.today.openCasts")}</Text>
          </View>
          <View>
            <Text className="font-display-extrabold text-3xl text-tone-blue-on">{drafts}</Text>
            <Text className="font-sans-medium text-[13px] text-tone-blue-on">{t("foundry.today.melts")}</Text>
          </View>
        </View>
      </PressableScale>
    </Can>
  );
}
