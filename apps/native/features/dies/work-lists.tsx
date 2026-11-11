import { useT, type MessageKey } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { PagedList } from "@/features/more/paged-list";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { milliKgText } from "./copy-model";

const PAGE = 50;
type MakerJob = inferRouterOutputs<AppRouter>["dieInstance"]["maker"]["jobs"]["list"]["items"][number];
const PURPOSE_KEY = { trial: "dieRoom.maker.trial", correction: "dieRoom.maker.correction", repair: "dieRoom.maker.repair" } as const satisfies Record<MakerJob["purpose"], MessageKey>;

/** Copies at nitriding, with the same copy, section, tier, latest reading, supplier and status fields as the web list. */
export function NitridingView() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Screen>
      <PagedList
        pageSize={PAGE}
        usePage={(offset) => useQuery(trpc.dieInstance.list.queryOptions({ status: "at_nitriding", limit: PAGE, offset }))}
        empty={<EmptyState title={t("dieRoom.nitriding.empty")} />}
        renderRow={(copy) => {
          const latest = copy.latestKgPer12ftMilli ? `${milliKgText(copy.latestKgPer12ftMilli)} ${t("units.kgPer12ft")}` : t("masters.dieCopies.noReading");
          return (
            <ListRow
              key={copy.id}
              title={copy.code}
              subtitle={[
                `${t("masters.dieCopies.columns.section")}: ${copy.sectionCode}${copy.sectionSeries ? ` (${copy.sectionSeries})` : ""}`,
                `${t("masters.dieCopies.columns.tier")}: ${copy.tierRank ? t("masters.dieCopies.tier", { rank: copy.tierRank }) : t("masters.dieCopies.notRanked")}`,
                `${t("masters.dieCopies.columns.supplier")}: ${copy.supplier ?? "-"}`,
              ].join("\n")}
              trailing={
                <View className="items-end gap-1">
                  <Text className="font-mono text-sm text-ink">{latest}</Text>
                  <Chip tone="amber" label={t("dieRoom.status.at_nitriding")} />
                </View>
              }
              onPress={() => router.push({ pathname: "/dies/[id]", params: { id: copy.id } })}
            />
          );
        }}
      />
    </Screen>
  );
}

/** Open maker jobs, newest first. Each cursor page is fetched only when the person asks for it. */
export function MakerJobsView() {
  const { t } = useT();
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  return (
    <Screen>
      <Text className="font-sans text-sm text-ink-muted">{t("dieRoom.makers.subtitle")}</Text>
      {cursors.map((cursor, index) => (
        <MakerJobsPage
          key={cursor ?? "first"}
          cursor={cursor}
          first={index === 0}
          last={index === cursors.length - 1}
          onMore={(next) => setCursors((pages) => [...pages, next])}
        />
      ))}
    </Screen>
  );
}

function MakerJobsPage({ cursor, first, last, onMore }: { cursor: string | undefined; first: boolean; last: boolean; onMore: (cursor: string) => void }) {
  const { t } = useT();
  const query = useQuery(trpc.dieInstance.maker.jobs.list.queryOptions({ status: "sent", limit: PAGE, ...(cursor ? { cursor } : {}) }));
  if (query.data === undefined) {
    if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
    return <LoadingBlock />;
  }
  if (first && query.data.items.length === 0) return <EmptyState title={t("dieRoom.makers.noJobs")} body={t("dieRoom.makers.noJobsBody")} />;
  return (
    <View className="gap-2">
      {query.data.items.map((job) => <MakerJobRow key={job.id} job={job} />)}
      {last && query.data.nextCursor ? <Button variant="secondary" label={t("common.showMore")} onPress={() => onMore(query.data.nextCursor!)} /> : null}
    </View>
  );
}

function MakerJobRow({ job }: { job: MakerJob }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  return (
    <ListRow
      title={`${job.number} · ${job.code}`}
      subtitle={`${job.makerName} · ${t(PURPOSE_KEY[job.purpose])} · ${format.day(job.sentAt) ?? "-"}`}
      onPress={() => router.push({ pathname: "/dies/[id]", params: { id: job.dieInstanceId } })}
    />
  );
}
