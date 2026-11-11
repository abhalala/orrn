import type { SpectroLimit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";

import { ELEMENT_LABEL } from "./foundry-model";
import { kgOf } from "./ui";

function MasterState({ pending, error, retry, retrying, children }: { pending: boolean; error: unknown; retry: () => void; retrying: boolean; children: ReactNode }) {
  if (pending) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={retry} retrying={retrying} />;
  return <>{children}</>;
}

/** The web's furnace columns, without its masters.publish edit actions. */
export function FurnacesView() {
  const { t } = useT();
  const query = useQuery(trpc.foundry.furnaces.list.queryOptions());
  const rows = query.data?.items ?? [];
  return (
    <Screen>
      <Text className="font-sans text-sm text-ink-muted">{t("foundry.masters.furnacesSubtitle")}</Text>
      <MasterState pending={query.isPending} error={query.error} retry={() => void query.refetch()} retrying={query.isRefetching}>
        {rows.length === 0 ? (
          <EmptyState title={t("foundry.masters.noFurnace")} body={t("foundry.masters.noFurnaceBody")} />
        ) : (
          <View className="gap-2">
            {rows.map((f) => (
              <ListRow
                key={f.id}
                title={f.code}
                subtitle={[f.name, `${t("foundry.masters.capacity")}: ${kgOf(f.capacityG)} ${t("units.kg")}`, `${t("foundry.masters.billetDia")}: ${f.billetDiaMm ? `${f.billetDiaMm} ${t("units.mm")}` : "-"}`].join("\n")}
                trailing={<Chip tone={f.status === "active" ? "green" : "neutral"} label={t(`foundry.masters.state.${f.status}`)} />}
              />
            ))}
          </View>
        )}
      </MasterState>
    </Screen>
  );
}

function limitText(limit: SpectroLimit, words: { max: string; min: string; to: string }): string {
  if (limit.minPpm == null && limit.maxPpm == null) return "";
  if (limit.minPpm != null && limit.maxPpm != null) return `${(limit.minPpm / 10_000).toFixed(2)} ${words.to} ${(limit.maxPpm / 10_000).toFixed(2)}`;
  return limit.maxPpm != null ? `${words.max} ${(limit.maxPpm / 10_000).toFixed(2)}` : `${words.min} ${(limit.minPpm! / 10_000).toFixed(2)}`;
}

/** The web's alloy, element-limit and status columns, read only on the phone. */
export function AlloysView() {
  const { t } = useT();
  const query = useQuery(trpc.foundry.alloys.list.queryOptions());
  const rows = query.data?.items ?? [];
  const words = { max: t("foundry.spectro.max"), min: t("foundry.spectro.min"), to: t("foundry.spectro.to") };
  return (
    <Screen>
      <Text className="font-sans text-sm text-ink-muted">{t("foundry.masters.alloysSubtitle")}</Text>
      <MasterState pending={query.isPending} error={query.error} retry={() => void query.refetch()} retrying={query.isRefetching}>
        {rows.length === 0 ? (
          <EmptyState title={t("foundry.masters.noAlloy")} body={t("foundry.masters.noAlloyBody")} />
        ) : (
          <View className="gap-2">
            {rows.map((a) => (
              <ListRow
                key={a.id}
                title={`${a.code} · ${a.name}`}
                subtitle={a.limits.length === 0 ? t("foundry.masters.noLimits") : a.limits.map((l) => `${ELEMENT_LABEL[l.element]} ${limitText(l as SpectroLimit, words)}`).join(" · ")}
                trailing={<Chip tone={a.status === "active" ? "green" : "neutral"} label={t(`foundry.masters.state.${a.status}`)} />}
              />
            ))}
          </View>
        )}
      </MasterState>
    </Screen>
  );
}
