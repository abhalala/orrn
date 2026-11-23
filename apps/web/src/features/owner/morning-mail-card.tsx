import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { SwitchRow } from "../settings/ui";
import { useModuleOn } from "@/shared/lib/modules";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * The morning summary mail setting (#82): on or off, and the plant hour it goes out. `settings.update`
 * holders change and save it; everyone else reads it. Saved with `company.updateSettings({ morningSummary })`.
 */
function MorningMailCardInner() {
  const settings = useQuery({ ...trpc.company.getSettings.queryOptions(), meta: INLINE_ERROR_META });
  const saved = settings.data?.morningSummary;
  if (!saved) return null;
  return <MorningMailForm key={`${saved.enabled}-${saved.hour}`} saved={saved} />;
}

function MorningMailForm({ saved }: { saved: { enabled: boolean; hour: number } }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [hour, setHour] = useState(saved.hour);
  const dirty = enabled !== saved.enabled || hour !== saved.hour;
  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("reg.owner.mailSaved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
      },
      onError: () => toast.error(t("reg.owner.mailFailed")),
    }),
  );
  return (
    <Card data-testid="morning-mail-card">
      <CardHeader>
        <CardTitle>{t("reg.owner.mailTitle")}</CardTitle>
        <CardDescription>{t("reg.owner.mailHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <Can
          do="settings.update"
          fallback={
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("reg.owner.mailOn")}: {saved.enabled ? t("settings.modules.on") : t("settings.modules.off")}
              {saved.enabled ? ` · ${t("reg.owner.mailHourValue", { hour: saved.hour })}` : ""}
            </p>
          }
        >
          <SwitchRow testId="morning-mail-switch" label={t("reg.owner.mailOn")} hint={t("reg.owner.mailHint")} on={enabled} pending={save.isPending} onToggle={() => setEnabled((v) => !v)} />
          <label className="flex min-w-0 flex-wrap items-center gap-3 text-[14px] font-semibold">
            {t("reg.owner.mailHour")}
            <NativeSelect value={hour} onChange={(e) => setHour(Number(e.currentTarget.value))} data-testid="morning-mail-hour" className="w-32">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {t("reg.owner.mailHourValue", { hour: h })}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ morningSummary: { enabled, hour } })} data-testid="morning-mail-save">
              {t("reg.owner.mailSave")}
            </Button>
          </div>
        </Can>
      </CardContent>
    </Card>
  );
}

/** PROD-GATE: renders (and asks the server) only with the opt-in `mis` module on. */
export function MorningMailCard() {
  return useModuleOn("mis") ? <MorningMailCardInner /> : null;
}
