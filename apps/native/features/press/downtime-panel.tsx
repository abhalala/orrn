import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useThemeColor } from "@/lib/theme";
import { useFormat } from "@/lib/use-format";
import { queryClient, trpc } from "@/utils/trpc";

import { reasonLabel } from "./reason-label";
import { downtimeNoteMissing, minutesBetween, pressError, type DowntimeReason } from "./press-model";

/**
 * Downtime on one press line (press.run holders): "Press stopped" asks why and starts it, "Press running
 * again" stops it. Server time is the record. A save that gets no answer is re-read, never repeated blind.
 */
export function DowntimePanel({ pressLineId }: { pressLineId: string }) {
  const { t } = useT();
  const format = useFormat();
  const ink = useThemeColor("foreground");
  const open = useQuery({ ...trpc.press.downtime.list.queryOptions({ pressLineId, openOnly: true, limit: 5 }), refetchInterval: 15_000 });
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "downtime" }), staleTime: 5 * 60_000 });
  const start = useMutation(trpc.press.downtime.start.mutationOptions());
  const stop = useMutation(trpc.press.downtime.stop.mutationOptions());
  const [asking, setAsking] = useState(false);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const current = open.data?.[0] ?? null;
  const list = (reasons.data ?? []) as DowntimeReason[];
  const picked = list.find((r) => r.id === reasonId);
  const noteMissing = downtimeNoteMissing(picked, note);

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.press.pathFilter());
  };

  const fail = (error: unknown) => {
    const e = pressError(t, error);
    feedback.error();
    announce(e.text, { shownInLiveRegion: true });
    setProblem(e.text);
    // An unsure answer may have saved: look again before anyone taps twice.
    if (e.unsure) void open.refetch();
  };

  const begin = async () => {
    setTried(true);
    if (!picked || noteMissing) return;
    setProblem(null);
    try {
      await start.mutateAsync({ pressLineId, reasonCodeId: picked.id, ...(note.trim() ? { note: note.trim() } : {}) });
      feedback.success();
      announce(t("native.press.downtimeStarted"));
      setAsking(false);
      setReasonId(null);
      setNote("");
      setTried(false);
      refresh();
    } catch (error) {
      fail(error);
    }
  };

  const finish = async () => {
    if (!current) return;
    setProblem(null);
    try {
      const res = await stop.mutateAsync({ id: current.id });
      feedback.success();
      announce(t("native.press.downtimeStopped", { minutes: res.minutes }));
      refresh();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <Can do="press.run">
      <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {t("press.console.downtime")}
        </Text>
        {open.isPending ? <LoadingBlock /> : null}
        {current ? (
          <>
            <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-tone-red-tint p-3">
              <Text className="font-sans-semibold text-base text-tone-red-ink">{reasonLabel(t, "downtime", current.reasonCode, current.reasonLabel)}</Text>
              <Text className="font-sans text-sm text-tone-red-ink">
                {t("native.press.downtimeSince", { time: format.time(current.startedAt) ?? "", minutes: minutesBetween(current.startedAt, Date.now()) })}
              </Text>
              {current.note ? <Text className="font-sans text-sm text-tone-red-ink">{current.note}</Text> : null}
            </View>
            <Button size="lg" label={t("press.console.downtimeStop")} loading={stop.isPending} onPress={() => void finish()} />
          </>
        ) : open.data ? (
          <Button size="lg" variant="secondary" label={t("press.console.downtimeStart")} onPress={() => setAsking(true)} />
        ) : null}
        {problem && !asking ? (
          <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] text-destructive">
            {problem}
          </Text>
        ) : null}
      </View>

      <Sheet visible={asking} onClose={() => setAsking(false)} title={t("native.press.downtimeWhy")}>
        {reasons.isPending ? <LoadingBlock /> : null}
        <View accessibilityRole="radiogroup" className="gap-2">
          {list.map((r) => {
            const selected = r.id === reasonId;
            return (
              <ListRow
                key={r.id}
                title={reasonLabel(t, "downtime", r.code, r.label)}
                className={cn(selected && "border-primary")}
                trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
                onPress={() => setReasonId(r.id)}
              />
            );
          })}
        </View>
        {tried && !picked ? <Text className="font-sans text-sm text-destructive">{t("native.press.errors.pickReason")}</Text> : null}
        {picked && (picked.requiresNote || picked.code === "other") ? (
          <Field label={t("common.note")} value={note} onChangeText={setNote} multiline maxLength={500} error={tried && noteMissing ? t("native.press.errors.noteNeeded") : null} />
        ) : null}
        {problem ? (
          <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] text-destructive">
            {problem}
          </Text>
        ) : null}
        <Button size="lg" label={t("press.console.downtimeStart")} loading={start.isPending} onPress={() => void begin()} />
      </Sheet>
    </Can>
  );
}
