import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { useThemeColor } from "@/lib/theme";
import { can, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import { foundryError } from "./errors";
import { ErrorLine, Note } from "./ui";

/**
 * Open a cast: pick the alloy (a retired one is not listed), the number comes from the plant's series. The
 * furnace is chosen on each melt; a plant with none is told so here, because no melt can start without one.
 * A resent open (a reply lost on plant Wi-Fi) carries the same `clientRequestId`, so it never opens two.
 */
export function NewCastView() {
  const { t } = useT();
  const router = useRouter();
  const ink = useThemeColor("foreground");
  const { data: me } = useMe();
  const alloys = useQuery(trpc.foundry.alloys.list.queryOptions());
  const furnaces = useQuery(trpc.foundry.furnaces.list.queryOptions());
  const open = useMutation(trpc.foundry.casts.open.mutationOptions());
  const [alloyId, setAlloyId] = useState<string | null>(null);
  const [legacyCode, setLegacyCode] = useState("");
  const [problem, setProblem] = useState<unknown>(null);
  const attempt = useRef<ReplayAttempt>(null);

  const list = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const picked = alloyId ?? (list.length === 1 ? list[0]!.id : null);
  const furnaceList = (furnaces.data?.items ?? []).filter((f) => f.status === "active");

  if (!can(me, "cast.enter")) {
    return (
      <Screen>
        <Note tone="amber">{t("foundry.common.notAllowed")}</Note>
      </Screen>
    );
  }

  const submit = async () => {
    if (!picked) return;
    setProblem(null);
    try {
      const body = { alloyId: picked, ...(legacyCode.trim() ? { legacyCode: legacyCode.trim() } : {}) };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      const res = await sendOnce((clientRequestId) => open.mutateAsync({ ...body, clientRequestId }), next.id);
      attempt.current = null;
      feedback.success();
      announce(t("foundry.newCast.opened", { number: res.number }));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
      router.replace({ pathname: "/cast/[id]", params: { id: res.id } } as never);
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      // An unsure answer may have opened it: the list is re-read before anyone taps again.
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
    }
  };

  return (
    <Screen>
      <PageHeader title={t("foundry.newCast.title")} subtitle={t("foundry.newCast.subtitle")} />
      {alloys.isPending ? <LoadingBlock /> : null}
      {alloys.isError && !alloys.data ? <ErrorBlock error={alloys.error} onRetry={() => void alloys.refetch()} retrying={alloys.isRefetching} /> : null}
      {alloys.data && list.length === 0 ? <Note tone="amber">{t("foundry.newCast.noAlloy")}</Note> : null}

      {list.length > 0 ? (
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
            {t("foundry.newCast.alloy")}
          </Text>
          <Text className="font-sans text-sm text-ink-muted">{t("foundry.newCast.alloyHint")}</Text>
          <View accessibilityRole="radiogroup" className="gap-2">
            {list.map((a) => {
              const selected = a.id === picked;
              return (
                <ListRow
                  key={a.id}
                  title={a.code}
                  subtitle={a.name && a.name !== a.code ? a.name : undefined}
                  className={cn(selected && "border-primary")}
                  radioChecked={selected}
                  trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
                  onPress={() => setAlloyId(a.id)}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {furnaces.data && furnaceList.length === 0 ? (
        <Note tone="amber">
          {t("foundry.newCast.noFurnace")} {t("foundry.newCast.noFurnaceAsk")}
        </Note>
      ) : null}

      {list.length > 0 ? (
        <Field
          label={t("foundry.newCast.legacy")}
          hint={t("foundry.newCast.legacyHint")}
          placeholder={t("foundry.newCast.legacyPlaceholder")}
          value={legacyCode}
          onChangeText={setLegacyCode}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          mono
        />
      ) : null}

      <ErrorLine error={problem} />
      <Button size="lg" label={t("foundry.casts.open")} loading={open.isPending} disabled={!picked} onPress={() => void submit()} />
    </Screen>
  );
}
