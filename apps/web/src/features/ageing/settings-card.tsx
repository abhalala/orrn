import { useT } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { Note, SwitchRow, type PlantSettings } from "../settings/ui";

type Key = "requireAgeing" | "requireForPack" | "manualLoad" | "split";

/**
 * Settings → Standards, ageing (FP-AG, Q-AG defaults): dispatch aged metal only (with the day it
 * starts from: bundles packed before it still go), pack names a trolley, typed trolley lines,
 * splitting lengths. `settings.update` holders change them; everyone else reads. Turning
 * "aged metal only" on starts today (the server stamps the day).
 */
export function AgeingSettingsCard({ settings }: { settings: PlantSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const ageing = settings.ageing;
  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.ageing.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.audit.list.queryKey() });
      },
      onError: () => toast.error(t("settings.ageing.saveFailed")),
    }),
  );
  const toggle = (key: Key) => save.mutate({ ageing: { [key]: !ageing[key] } });
  const rows: { key: Key; label: string; hint: string }[] = [
    { key: "requireAgeing", label: t("ageing.settings.requireAgeing"), hint: t("ageing.settings.requireAgeingHint") },
    { key: "requireForPack", label: t("ageing.settings.requireForPack"), hint: t("settings.ageing.requireForPackHint") },
    { key: "manualLoad", label: t("ageing.settings.manualLoad"), hint: t("settings.ageing.manualLoadHint") },
    { key: "split", label: t("ageing.settings.split"), hint: t("settings.ageing.splitHint") },
  ];
  return (
    <Card data-testid="settings-ageing">
      <CardHeader>
        <CardTitle>{t("settings.ageing.title")}</CardTitle>
        <CardDescription>{t("settings.ageing.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {rows.map((r) => (
          <div key={r.key} className="flex min-w-0 flex-col gap-1.5">
            <Can
              do="settings.update"
              fallback={
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-3">
                  <span className="min-w-0 text-[15px] font-semibold break-words">{r.label}</span>
                  <span className="text-[14px] text-muted-foreground">{ageing[r.key] ? t("settings.modules.on") : t("settings.modules.off")}</span>
                </div>
              }
            >
              <SwitchRow testId={`ageing-switch-${r.key}`} label={r.label} hint={r.hint} on={ageing[r.key]} pending={save.isPending} onToggle={() => toggle(r.key)} />
            </Can>
            {r.key === "requireAgeing" ? (
              <Note testId="require-ageing-since">
                {ageing.requireAgeing && ageing.requireAgeingSince ? t("settings.ageing.since", { day: ageing.requireAgeingSince }) : t("settings.ageing.fromToday")}
              </Note>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
