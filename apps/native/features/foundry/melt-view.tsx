import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { MeltEditor } from "./melt-editor";
import { MeltSheetView } from "./melt-sheet-view";
import { Note } from "./ui";

/**
 * `/cast/melt/<id>?castId=…`: a saved draft (the editor), a locked melt (the read-only sheet with the
 * correction request) or `new` (the first save makes the draft). Nothing is posted until Lock.
 */
export function MeltScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const params = useLocalSearchParams<{ meltId?: string; castId?: string }>();
  const meltId = params.meltId ?? "new";
  const castId = params.castId ?? "";
  const castQuery = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id: castId }), enabled: castId !== "" });
  const data = castQuery.data;
  const title = <Stack.Screen options={{ title: meltId === "new" ? t("foundry.melt.new") : t("foundry.melt.title") }} />;

  if (castId === "") {
    return (
      <Screen>
        {title}
        <EmptyState title={t("foundry.cast.notFound")} />
      </Screen>
    );
  }
  if (castQuery.isPending) {
    return (
      <Screen>
        {title}
        <LoadingBlock />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        {title}
        <ErrorBlock error={castQuery.error} onRetry={() => void castQuery.refetch()} retrying={castQuery.isRefetching} />
      </Screen>
    );
  }

  const melt = meltId === "new" ? null : (data.melts.find((m) => m.id === meltId) ?? undefined);
  if (melt === undefined) {
    return (
      <Screen>
        {title}
        <EmptyState title={t("foundry.melt.notFound")} />
      </Screen>
    );
  }
  const editable = (melt === null || melt.status === "draft") && data.cast.status === "open" && can(me, "melt.enter");
  if (!editable && melt === null) {
    return (
      <Screen>
        {title}
        <Note tone="amber">{data.cast.status === "open" ? t("foundry.common.notAllowed") : t("foundry.melt.castNotOpen", { number: data.cast.number })}</Note>
      </Screen>
    );
  }
  return (
    <>
      {title}
      {!editable && melt ? <MeltSheetView data={data} melt={melt} /> : <MeltEditor key={melt?.id ?? "new"} data={data} melt={melt ?? null} />}
    </>
  );
}
