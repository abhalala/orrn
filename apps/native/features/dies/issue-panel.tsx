import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { trpc } from "@/utils/trpc";

import { ChoiceRow } from "./choice-row";
import { issueActions, issueTarget, runsForSection } from "./copy-model";
import { dieErrorText } from "./errors";
import { useRefreshDieRoom } from "./use-die-write";

/**
 * Issue a rack copy to a queued press run, take an issued copy back, or cancel the issue before die
 * in. The run decides the press line (D13: a queued run is required). The rules for return and
 * cancel are the domain's, the same ones the server applies, so a button that would only be refused
 * is not shown; the server still has the last word.
 */
export function IssuePanel({
  copyId,
  code,
  sectionId,
  status,
  canIssue,
  allowed,
}: {
  copyId: string;
  code: string;
  sectionId: string;
  status: string;
  /** Holds die.issue and the copy is in the rack. */
  canIssue: boolean;
  /** Holds die.issue (return / cancel). */
  allowed: boolean;
}) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const [sheet, setSheet] = useState<"issue" | "cancel" | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useQuery({ ...trpc.dieInstance.issues.list.queryOptions({ dieInstanceId: copyId, status: "issued", limit: 1 }), enabled: status === "in_use" });
  const queued = useQuery({ ...trpc.dieInstance.issues.queuedRuns.queryOptions({ sectionId }), enabled: sheet === "issue" });
  const lines = useQuery({ ...trpc.dieInstance.issues.pressLines.queryOptions(), enabled: sheet === "issue" });
  const issue = useMutation(trpc.dieInstance.issues.issue.mutationOptions());
  const giveBack = useMutation(trpc.dieInstance.issues.return.mutationOptions());
  const cancel = useMutation(trpc.dieInstance.issues.cancel.mutationOptions());

  const current = open.data?.items[0] ?? null;
  const runs = runsForSection(queued.data ?? [], sectionId);
  // BACKLOG 36: the die room names the run; nothing is picked for them (no silent "oldest").
  const { run: chosen, lineId: resolvedLine } = issueTarget(runs, runId, lineId, lines.data ?? []);
  const actions = current
    ? issueActions({
        status: current.pressRunStatus ?? "die_issued",
        dieInAt: current.pressRunDieInAt ? new Date(current.pressRunDieInAt).getTime() : null,
        dieOutAt: current.pressRunDieOutAt ? new Date(current.pressRunDieOutAt).getTime() : null,
      })
    : null;

  function close() {
    setSheet(null);
    setError(null);
    setRunId(null);
    setLineId(null);
  }

  /** `work` answers with the sentence to announce once it has gone through. */
  async function run(work: () => Promise<string>) {
    setError(null);
    try {
      const said = await work();
      feedback.success();
      announce(said);
      close();
      refresh();
      void open.refetch();
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  const errorBox = error ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
      {error}
    </Text>
  ) : null;

  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("dieRoom.issue.title")}
      </Text>

      {status === "in_use" ? (
        current ? (
          <View className="gap-3">
            <Text className="font-sans-semibold text-base text-ink">
              {t("dieRoom.issue.issued", { line: current.pressLineCode })}
              {current.pressRunNumber ? `, ${current.pressRunNumber}` : ""}
            </Text>
            {actions?.dieOnPress ? <Text className="font-sans text-sm text-ink-muted">{t("dieRoom.issue.dieOnPress")}</Text> : null}
            {allowed && actions?.return ? (
              <Button
                variant="secondary"
                label={t("dieRoom.issue.return")}
                loading={giveBack.isPending}
                onPress={() =>
                  void run(async () => {
                    await giveBack.mutateAsync({ id: current.id });
                    return t("dieRoom.issue.returned");
                  })
                }
              />
            ) : null}
            {allowed && actions?.cancel ? <Button variant="ghost" label={t("dieRoom.issue.cancel")} onPress={() => setSheet("cancel")} /> : null}
            {errorBox && sheet === null ? errorBox : null}
          </View>
        ) : open.isPending ? (
          <LoadingBlock />
        ) : (
          <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.card.onPress")}</Text>
        )
      ) : canIssue ? (
        <Button variant="secondary" label={t("dieRoom.issue.issue")} onPress={() => setSheet("issue")} />
      ) : (
        <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.issue.notAvailable")}</Text>
      )}

      <Sheet visible={sheet === "issue"} onClose={close} title={t("native.dies.issueTitle", { code })}>
        {queued.data === undefined ? (
          <LoadingBlock />
        ) : runs.length === 0 ? (
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("dieRoom.issues.noRun")}</Text>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel={t("dieRoom.issues.pickRun")} className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("dieRoom.issues.pickRun")}</Text>
            {runs.map((r) => (
              <ChoiceRow key={r.id} label={r.number} detail={r.pressLineCode ?? undefined} selected={chosen?.id === r.id} onPress={() => setRunId(r.id)} />
            ))}
          </View>
        )}
        {chosen && !chosen.pressLineId && (lines.data?.length ?? 0) > 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel={t("dieRoom.issues.pickLine")} className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("dieRoom.issues.pickLine")}</Text>
            {(lines.data ?? []).map((l) => (
              <ChoiceRow key={l.id} label={l.code} selected={resolvedLine === l.id} onPress={() => setLineId(l.id)} />
            ))}
          </View>
        ) : null}
        {errorBox}
        <Button
          size="lg"
          label={t("dieRoom.issue.issue")}
          loading={issue.isPending}
          loadingLabel={t("common.saving")}
          disabled={!chosen || !resolvedLine}
          onPress={() =>
            chosen && resolvedLine
              ? void run(async () => {
                  const done = await issue.mutateAsync({ dieInstanceId: copyId, pressLineId: resolvedLine, pressRunId: chosen.id });
                  return done.warnings.some((w) => w.code === "life_reached") ? t("dieRoom.issues.lifeReached") : t("dieRoom.issues.issuedToast");
                })
              : undefined
          }
        />
      </Sheet>

      <Sheet visible={sheet === "cancel"} onClose={close} title={t("dieRoom.issues.cancelTitle", { code })}>
        <Text className="font-sans text-[15px] leading-6 text-ink">{t("dieRoom.issues.cancelBody", { code })}</Text>
        {errorBox}
        <Button
          size="lg"
          variant="danger"
          label={t("dieRoom.issue.cancel")}
          loading={cancel.isPending}
          onPress={() =>
            current
              ? void run(async () => {
                  await cancel.mutateAsync({ id: current.id });
                  return t("dieRoom.issues.cancelledToast");
                })
              : undefined
          }
        />
        <Button variant="secondary" label={t("dieRoom.issues.keepIssued")} onPress={close} />
      </Sheet>
    </View>
  );
}
