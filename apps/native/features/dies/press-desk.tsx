import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useRefresh } from "@/features/stock/use-refresh";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { ChoiceRow } from "./choice-row";
import { milliKgText, issueLine, type PressLine, type QueuedRun } from "./copy-model";
import { dieErrorText } from "./errors";
import { useRefreshDieRoom } from "./use-die-write";

/**
 * The die room's Press tab: which queued press runs are waiting for a die, which copies are on a
 * press now, and the issue itself. The run sets the press line; "Use first" marks the copy the die
 * room would hand out (lightest in band, then best tier), and the person picks any rack copy.
 */
export function PressDesk() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const waiting = useQuery(trpc.dieInstance.issues.queuedRuns.queryOptions({}));
  const issued = useQuery(trpc.dieInstance.issues.list.queryOptions({ status: "issued", limit: 50 }));
  const { refreshing, onRefresh } = useRefresh([waiting.refetch, issued.refetch]);
  const [target, setTarget] = useState<QueuedRun | null>(null);
  const canIssue = can(me, "die.issue");

  const failed = (waiting.isError && waiting.data === undefined) || (issued.isError && issued.data === undefined);
  const loading = (waiting.isPending || issued.isPending) && !failed;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      {loading ? (
        <LoadingBlock />
      ) : failed ? (
        <ErrorBlock
          error={waiting.error ?? issued.error}
          onRetry={() => {
            void waiting.refetch();
            void issued.refetch();
          }}
        />
      ) : (
        <>
          <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
            {t("native.dies.waitingTitle")}
          </Text>
          {(waiting.data ?? []).length === 0 ? (
            <EmptyState title={t("native.dies.waitingEmpty")} body={t("native.dies.waitingEmptyBody")} />
          ) : (
            <View className="gap-2">
              {(waiting.data ?? []).map((run) => (
                <ListRow
                  key={run.id}
                  title={run.number}
                  subtitle={[`${run.sectionSeries} ${run.sectionCode}`, run.pressLineCode].filter(Boolean).join(", ")}
                  trailing={canIssue ? <Chip tone="amber" label={t("native.dies.needsDie")} /> : undefined}
                  onPress={canIssue ? () => setTarget(run) : undefined}
                  accessibilityHint={canIssue ? t("dieRoom.issue.issue") : undefined}
                />
              ))}
            </View>
          )}

          <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
            {t("dieRoom.issues.open")}
          </Text>
          {(issued.data?.items ?? []).length === 0 ? (
            <EmptyState title={t("dieRoom.issues.noneOpen")} body={t("dieRoom.issues.noneOpenBody")} />
          ) : (
            <View className="gap-2">
              {(issued.data?.items ?? []).map((row) => (
                <ListRow
                  key={row.id}
                  title={row.code}
                  subtitle={[row.pressLineCode, row.pressRunNumber].filter(Boolean).join(", ")}
                  onPress={() => router.push({ pathname: "/dies/[id]", params: { id: row.dieInstanceId } })}
                />
              ))}
            </View>
          )}
        </>
      )}

      <IssueToRunSheet run={target} onClose={() => setTarget(null)} />
    </Screen>
  );
}

function IssueToRunSheet({ run, onClose }: { run: QueuedRun | null; onClose: () => void }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const [picked, setPicked] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sectionId = run?.sectionId ?? "";
  const copies = useQuery({ ...trpc.dieInstance.list.queryOptions({ sectionId, status: "available", limit: 100 }), enabled: !!run });
  const suggestion = useQuery({ ...trpc.dieInstance.suggestFirst.queryOptions({ sectionId }), enabled: !!run });
  const lines = useQuery({ ...trpc.dieInstance.issues.pressLines.queryOptions(), enabled: !!run });
  const issue = useMutation(trpc.dieInstance.issues.issue.mutationOptions());

  const first = suggestion.data?.dieInstanceId ?? null;
  const choice = picked ?? first;
  const line = run ? (lineId ?? issueLine(run, (lines.data ?? []) as PressLine[])) : null;

  function close() {
    setPicked(null);
    setLineId(null);
    setError(null);
    onClose();
  }

  async function submit() {
    if (!run || !choice || !line) return;
    setError(null);
    try {
      const done = await issue.mutateAsync({ dieInstanceId: choice, pressLineId: line, pressRunId: run.id });
      feedback.success();
      announce(done.warnings.some((w) => w.code === "life_reached") ? t("dieRoom.issues.lifeReached") : t("dieRoom.issues.issuedToast"));
      close();
      refresh();
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  return (
    <Sheet visible={run !== null} onClose={close} title={run ? t("native.dies.issueToRun", { run: run.number }) : t("dieRoom.issue.issue")}>
      {copies.data === undefined ? (
        copies.isError ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.issues.loadFailed")}</Text>
        ) : (
          <LoadingBlock />
        )
      ) : copies.data.items.length === 0 ? (
        <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("dieRoom.issues.noneOnRackBody")}</Text>
      ) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("dieRoom.issues.pickCopy")} className="gap-2">
          <Text className="font-sans-medium text-sm text-ink">{t("dieRoom.issues.pickCopy")}</Text>
          {copies.data.items.map((c) => (
            <ChoiceRow
              key={c.id}
              label={c.code}
              detail={[c.id === first ? t("dieRoom.copies.suggestFirst") : null, c.latestMilli != null ? `${milliKgText(c.latestMilli)} ${t("units.kgPer12ft")}` : t("dieRoom.drift.none")]
                .filter(Boolean)
                .join(", ")}
              selected={choice === c.id}
              onPress={() => setPicked(c.id)}
            />
          ))}
        </View>
      )}
      {run && !run.pressLineId && (lines.data?.length ?? 0) > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("dieRoom.issues.pickLine")} className="gap-2">
          <Text className="font-sans-medium text-sm text-ink">{t("dieRoom.issues.pickLine")}</Text>
          {(lines.data ?? []).map((l) => (
            <ChoiceRow key={l.id} label={l.code} selected={line === l.id} onPress={() => setLineId(l.id)} />
          ))}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
          {error}
        </Text>
      ) : null}
      <Button size="lg" label={t("dieRoom.issue.issue")} loading={issue.isPending} loadingLabel={t("common.saving")} disabled={!choice || !line} onPress={() => void submit()} />
    </Sheet>
  );
}
