import { useT, type MessageKey } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { moduleStates } from "./model";
import { Note, SwitchRow, TabState, usePlantSettings, type PlantSettings } from "./ui";

type SwitchKey = "dieBands" | "priceOnSalesOrder" | "dieRequiredOnSalesOrder" | "portalEnabled";
const SWITCHES: { key: SwitchKey; title: MessageKey; hint: MessageKey }[] = [
  { key: "dieBands", title: "settings.modules.dieBands", hint: "settings.modules.dieBandsHint" },
  { key: "priceOnSalesOrder", title: "settings.modules.priceOnSalesOrder", hint: "settings.modules.priceOnSalesOrderHint" },
  { key: "dieRequiredOnSalesOrder", title: "settings.modules.dieRequired", hint: "settings.modules.dieRequiredHint" },
  { key: "portalEnabled", title: "settings.modules.portalEnabled", hint: "settings.modules.portalEnabledHint" },
];

/**
 * Modules (FP-PF-07, FP-PF-06): which modules the plant bought (read only: orrn staff turn them on
 * and off) and the commercial switches the plant owns. A switch is saved the moment it is
 * pressed (`company.updateSettings`, `settings.update`); the server applies it from the next
 * request. Roles without `settings.update` read the same values with no switch to press.
 */
export function ModulesTab() {
  const settings = usePlantSettings();
  return <TabState query={settings}>{settings.data ? <ModulesPanel settings={settings.data} /> : null}</TabState>;
}

function ModulesPanel({ settings }: { settings: PlantSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const states = moduleStates(settings.modules);
  const everyOn = states.every((s) => s.on);

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.modules.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: () => toast.error(t("settings.modules.saveFailed")),
    }),
  );

  const castValue = settings.requireCastOnBundle === null ? "auto" : settings.requireCastOnBundle ? "on" : "off";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-modules">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.modules.bought")}</CardTitle>
          <CardDescription>{t("settings.modules.boughtHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="bought-modules">
            {states.map((m) => (
              <li key={m.id} data-module={m.id} data-on={m.on}>
                <Chip tone={m.on ? "green" : "neutral"}>
                  {m.on ? t(`plantSettings.modules.names.${m.id}`) : t("settings.modules.moduleOff", { name: t(`plantSettings.modules.names.${m.id}`) })}
                </Chip>
              </li>
            ))}
          </ul>
          {everyOn ? <Note>{t("settings.modules.allOn")}</Note> : null}
        </CardContent>
      </Card>

      <section aria-labelledby="switches-heading" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="switches-heading" className="m-0 text-[17px] font-semibold">
            {t("settings.modules.switches")}
          </h2>
          <Note>{t("settings.modules.switchesHint")}</Note>
        </div>
        <Can
          do="settings.update"
          fallback={
            <div className="flex min-w-0 flex-col gap-3" data-testid="modules-read-only-list">
              <Note testId="modules-read-only">{t("settings.modules.readOnly")}</Note>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {SWITCHES.map((s) => (
                  <li key={s.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-3">
                    <span className="min-w-0 text-[15px] font-semibold break-words">{t(s.title)}</span>
                    <Chip tone={settings[s.key] ? "green" : "neutral"}>{settings[s.key] ? t("settings.modules.on") : t("settings.modules.off")}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          }
        >
          {SWITCHES.map((s) => (
            <SwitchRow
              key={s.key}
              testId={`switch-${s.key}`}
              label={t(s.title)}
              hint={t(s.hint)}
              on={settings[s.key]}
              pending={save.isPending}
              onToggle={() => save.mutate({ [s.key]: !settings[s.key] })}
            />
          ))}
        </Can>
        <Can do="settings.update">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
            <div className="min-w-0 flex-1 basis-56">
              <p className="m-0 text-[15px] leading-6 font-semibold">{t("settings.modules.requireCast")}</p>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("settings.modules.requireCastHint")}</p>
            </div>
            <SegmentedControl<"auto" | "on" | "off">
              label={t("settings.modules.requireCast")}
              value={castValue}
              options={[
                { value: "auto", label: t("settings.modules.castAuto") },
                { value: "on", label: t("settings.modules.on") },
                { value: "off", label: t("settings.modules.off") },
              ]}
              onChange={(next) => save.mutate({ requireCastOnBundle: next === "auto" ? null : next === "on" })}
            />
          </div>
        </Can>
      </section>
    </div>
  );
}
