import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { can as roleHolds, type Me } from "@orrn/server/lib/permissions";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useThemeColor } from "@/lib/theme";
import { queryClient, trpc } from "@/utils/trpc";

import { handoverChanges, handoverChoices, pressError, type Person } from "./press-model";

const asRole = (role: string) => ({ company: { role }, isPlatformAdmin: false, platformRole: null }) as unknown as Me;
const canRun = (role: string) => roleHolds(asRole(role), "press.run");
const canLog = (role: string) => roleHolds(asRole(role), "press.close");

type Pick = { operatorId: string | null; reliefOperatorId: string | null; supervisorId: string | null };

function PersonPicker({ label, value, onChange, people, nobody }: { label: string; value: string | null; onChange: (id: string | null) => void; people: Person[]; nobody: string }) {
  const ink = useThemeColor("foreground");
  const rows: { id: string | null; name: string }[] = [{ id: null, name: nobody }, ...people];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-2">
      <Text className="font-sans-semibold text-sm text-ink-muted">{label}</Text>
      {rows.map((p) => {
        const selected = p.id === value;
        return (
          <ListRow
            key={p.id ?? "none"}
            title={p.name}
            className={cn(selected && "border-primary")}
            radioChecked={selected}
            trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
            accessibilityLabel={`${label}, ${p.name}`}
            onPress={() => onChange(p.id)}
          />
        );
      })}
    </View>
  );
}

/**
 * Who is on the press (FP-PR-13): operator, relief and supervisor of one run. The people come from the
 * plant's team; the server checks the roles again and says no in plain words if a pick does not fit.
 */
export function HandoverSheet({ runId, visible, onClose }: { runId: string; visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const run = useQuery({ ...trpc.press.runs.get.queryOptions({ id: runId }), enabled: visible });
  const members = useQuery({ ...trpc.company.membersList.queryOptions(), enabled: visible, staleTime: 60_000 });
  const handover = useMutation(trpc.press.runs.handover.mutationOptions());
  const [pick, setPick] = useState<Pick | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const before: Pick | null = run.data
    ? { operatorId: run.data.run.operatorId, reliefOperatorId: run.data.run.reliefOperatorId, supervisorId: run.data.run.supervisorId }
    : null;
  useEffect(() => {
    if (visible && before && !pick) setPick(before);
    if (!visible) {
      setPick(null);
      setProblem(null);
    }
    // `before` is derived from run.data; resetting on its identity would clear the person's picks on a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, run.data?.run.serverSeq]);

  const choices = handoverChoices(members.data ?? [], canRun, canLog);
  const changes = before && pick ? handoverChanges(before, pick) : {};
  const nothing = Object.keys(changes).length === 0;

  const save = async () => {
    if (!pick || nothing) return;
    setProblem(null);
    try {
      await handover.mutateAsync({ id: runId, ...changes });
      feedback.success();
      announce(t("native.press.handoverSaved"));
      void queryClient.invalidateQueries(trpc.press.pathFilter());
      onClose();
    } catch (error) {
      const e = pressError(t, error);
      feedback.error();
      announce(e.text, { shownInLiveRegion: true });
      setProblem(e.text);
      if (e.unsure) void run.refetch();
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("native.press.handoverTitle")}>
      {run.isPending || members.isPending || !pick ? (
        <LoadingBlock />
      ) : (
        <>
          <PersonPicker label={t("press.console.operator")} value={pick.operatorId} onChange={(operatorId) => setPick({ ...pick, operatorId })} people={choices.crew} nobody={t("native.press.nobody")} />
          <PersonPicker label={t("press.console.relief")} value={pick.reliefOperatorId} onChange={(reliefOperatorId) => setPick({ ...pick, reliefOperatorId })} people={choices.crew} nobody={t("native.press.nobody")} />
          <PersonPicker label={t("press.console.supervisor")} value={pick.supervisorId} onChange={(supervisorId) => setPick({ ...pick, supervisorId })} people={choices.bosses} nobody={t("native.press.nobody")} />
          {problem ? (
            <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] text-destructive">
              {problem}
            </Text>
          ) : null}
          <Button size="lg" label={t("native.press.handoverSave")} disabled={nothing} loading={handover.isPending} onPress={() => void save()} />
        </>
      )}
    </Sheet>
  );
}
