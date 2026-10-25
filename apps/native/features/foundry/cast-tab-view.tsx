import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";

import { CastDetail } from "./cast-detail";
import { chooseCast } from "./foundry-model";

/**
 * The Cast tab: the newest open cast first, and a row of cast numbers to switch between the open ones.
 * The one primary action is a new melt on the cast shown (inside CastDetail), or Open cast when none is open.
 */
export function CastTab() {
  const { t } = useT();
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const list = useQuery({ ...trpc.foundry.casts.list.queryOptions({ limit: 20, offset: 0 }), refetchInterval: 30_000 });
  const items = list.data?.items ?? [];
  const live = items.filter((c) => c.status === "open" || c.status === "closing");
  const shown = live.length > 0 ? live : items;
  const id = chooseCast(shown, picked);
  const openNew = () => router.push("/cast/new" as never);

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      {list.isPending ? <LoadingBlock /> : null}
      {list.isError && !list.data ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} /> : null}

      {list.data && live.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t("foundry.casts.title")}>
          {live.map((c) => {
            const selected = c.id === id;
            return (
              <PressableScale
                key={c.id}
                accessibilityRole="radio"
                accessibilityLabel={`${c.number}, ${c.alloy}`}
                accessibilityState={{ checked: selected, selected }}
                onPress={() => setPicked(c.id)}
                className={cn("min-h-11 min-w-[72px] items-center justify-center rounded-full border px-4", selected ? "border-primary bg-primary" : "border-control bg-surface")}
              >
                <Text className={cn("font-mono-semibold text-base", selected ? "text-primary-foreground" : "text-ink")}>{c.number}</Text>
                <Text className={cn("font-sans text-xs", selected ? "text-primary-foreground" : "text-ink-muted")}>{c.alloy}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}

      {id ? <CastDetail id={id} /> : null}

      {list.data && !id ? (
        <Can do="cast.enter" fallback={<EmptyState title={t("foundry.casts.empty")} />}>
          <EmptyState title={t("foundry.casts.empty")} body={t("foundry.casts.emptyHint")} actionLabel={t("foundry.casts.open")} onAction={openNew} />
        </Can>
      ) : null}

      {id ? (
        <Can do="cast.enter">
          <View>
            <Button variant="ghost" label={t("foundry.casts.open")} onPress={openNew} />
          </View>
        </Can>
      ) : null}
    </Screen>
  );
}
