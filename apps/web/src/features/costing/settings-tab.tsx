import { COST_STAGES, type CostStage } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import type { CostSettingsView } from "./hooks";
import { useCostSettings } from "./hooks";
import { emptyRateForm, isConflict, rateVersion, settingsForm, settingsUpdate, versionRows, type RateForm, type SettingsForm } from "./model";
import { Loaded, Note, Panel, useCostSay } from "./ui";

/** Settings: margin and press time, die fallbacks, and the dated stage rates. Editing needs `cost.manage`. */
export function SettingsTab() {
  const settings = useCostSettings();
  return <Loaded query={settings}>{(s) => <SettingsBody s={s} />}</Loaded>;
}

function SettingsBody({ s }: { s: CostSettingsView }) {
  const say = useCostSay();
  const { t } = say;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(() => settingsForm(s));
  const [bad, setBad] = useState<string[]>([]);
  const [rates, setRates] = useState<RateForm>(() => emptyRateForm(s.today));
  const [rateError, setRateError] = useState<string | null>(null);
  // Sync the form only when the saved general settings change (a general save, or someone else's),
  // never because a rate version was added or removed: unsaved edits stay.
  const baseline = useMemo(() => JSON.stringify(settingsForm(s)), [s]);
  useEffect(() => setForm(JSON.parse(baseline) as SettingsForm), [baseline]);

  const update = useMutation(
    trpc.costing.settings.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("cost.settings.saved"));
        await queryClient.invalidateQueries(trpc.costing.pathFilter());
      },
      onError: async (e) => {
        if (isConflict(e)) {
          // Someone saved first: say so and load theirs. Unsaved general edits stay unless they changed the same settings.
          toast.error(t("cost.settings.conflict"));
          await queryClient.invalidateQueries(trpc.costing.settings.get.pathFilter());
          return;
        }
        toast.error(t("cost.settings.saveFailed"));
      },
    }),
  );
  const set = (patch: Partial<SettingsForm>) => setForm({ ...form, ...patch });
  const num = (key: keyof SettingsForm, label: string, value: string, on: (v: string) => void, percent = false) => (
    <Field key={key} label={label} error={bad.includes(key) ? t(percent ? "cost.settings.badPercent" : "cost.settings.badNumber") : undefined}>
      <TextInput value={value} inputMode="decimal" autoComplete="off" onChangeText={on} />
    </Field>
  );
  const save = () => {
    const r = settingsUpdate(form);
    if (!r.ok) return setBad(r.bad);
    setBad([]);
    update.mutate({ ...r.input, rev: s.rev });
  };
  const saveRates = () => {
    const r = rateVersion(rates);
    if (!r.ok) {
      setRateError(r.error === "date" ? t("cost.settings.badDate") : r.error === "amount" ? t("cost.settings.badAmount") : t("cost.settings.needThroughput", { stage: t(`cost.stage.${r.stage!}`) }));
      return;
    }
    setRateError(null);
    update.mutate({ rateVersion: r.input, rev: s.rev }, { onSuccess: () => setRates(emptyRateForm(s.today)) });
  };
  const setStage = (st: CostStage, patch: Partial<RateForm["stages"][CostStage]>) =>
    setRates({ ...rates, stages: { ...rates.stages, [st]: { ...rates.stages[st], ...patch } } });

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-tab">
      <Panel title={t("cost.settings.ratesTitle")}>
        <Note>{t("cost.settings.ratesHint")}</Note>
        {s.rates.length === 0 ? (
          <Note>{t("cost.settings.noVersions")}</Note>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="rate-versions">
            {[...s.rates].reverse().map((v) => (
              <li key={v.from} className="rounded-card border border-border px-3 py-2 text-[14px]">
                <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                  {say.day(v.from)}
                  {s.ratesToday?.from === v.from ? <span className="text-muted-foreground">{t("cost.settings.inUse")}</span> : null}
                  <Can do="cost.manage">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(t("cost.settings.removeConfirm", { date: say.day(v.from) }))) update.mutate({ removeRateFrom: v.from, rev: s.rev });
                      }}
                    >
                      {t("cost.settings.remove")}
                    </Button>
                  </Can>
                </p>
                <ul className="m-0 list-none p-0 text-muted-foreground">
                  {versionRows(v, t, say.money).map((r) => (
                    <li key={r.stage}>{t("cost.stage." + r.stage as "cost.stage.metal")}: {r.text}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <Can do="cost.manage">
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <Field label={t("cost.settings.from")} className="max-w-xs">
              <TextInput type="date" value={rates.from} onChangeText={(v) => setRates({ ...rates, from: v })} />
            </Field>
            {COST_STAGES.map((st) => {
              const r = rates.stages[st];
              return (
                <div key={st} className="grid min-w-0 gap-3 sm:grid-cols-3" data-testid={`rate-${st}`}>
                  <Field label={`${t(`cost.stage.${st}`)}: ${t("cost.settings.amount")}`}>
                    <TextInput value={r.amount} inputMode="decimal" autoComplete="off" placeholder={t("cost.settings.notSet")} onChangeText={(v) => setStage(st, { amount: v })} />
                  </Field>
                  <Field label={t("cost.settings.basis")}>
                    <NativeSelect value={r.basis} onChange={(e) => setStage(st, { basis: e.currentTarget.value === "hour" ? "hour" : "kg" })}>
                      <option value="kg">{t("cost.settings.basisKg")}</option>
                      <option value="hour">{t("cost.settings.basisHour")}</option>
                    </NativeSelect>
                  </Field>
                  {r.basis === "hour" && st !== "extrusion" ? (
                    <Field label={t("cost.settings.kgPerHour")}>
                      <TextInput value={r.kgPerHour} inputMode="numeric" autoComplete="off" onChangeText={(v) => setStage(st, { kgPerHour: v })} />
                    </Field>
                  ) : null}
                </div>
              );
            })}
            {rateError ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{rateError}</p> : null}
            <div>
              <Button onClick={saveRates} loading={update.isPending}>{t("cost.settings.addVersion")}</Button>
            </div>
          </div>
        </Can>
      </Panel>

      <Can do="cost.manage" fallback={<Note>{t("cost.settings.readOnly")}</Note>}>
        <Panel title={t("cost.settings.general")}>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {num("lowMargin", t("cost.settings.lowMargin"), form.lowMargin, (v) => set({ lowMargin: v }), true)}
            {num("workDays", t("cost.settings.workDays"), form.workDays, (v) => set({ workDays: v }))}
            {num("hoursPerDay", t("cost.settings.hoursPerDay"), form.hoursPerDay, (v) => set({ hoursPerDay: v }))}
            {num("downtimePlant", t("cost.settings.downtimePlant"), form.downtimePlant, (v) => set({ downtimePlant: v }))}
            {s.pressLines.map((l) => (
              <Field key={l.id} label={t("cost.settings.downtimeLine", { line: `${l.code} ${l.name}` })} error={bad.includes("downtimeLine") ? t("cost.settings.badNumber") : undefined}>
                <TextInput value={form.downtimeLine[l.id] ?? ""} inputMode="numeric" autoComplete="off" onChangeText={(v) => set({ downtimeLine: { ...form.downtimeLine, [l.id]: v } })} />
              </Field>
            ))}
            {num("defaultSpeed", t("cost.settings.defaultSpeed"), form.defaultSpeed, (v) => set({ defaultSpeed: v }))}
            {num("leadDays", t("cost.settings.leadDays"), form.leadDays, (v) => set({ leadDays: v }))}
          </div>
          <h3 className="m-0 text-[15px] font-semibold">{t("cost.settings.dieTitle")}</h3>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {num("nitrideEvery", t("cost.settings.nitrideEvery"), form.nitrideEvery, (v) => set({ nitrideEvery: v }))}
            {num("correctEvery", t("cost.settings.correctEvery"), form.correctEvery, (v) => set({ correctEvery: v }))}
            {num("soonPct", t("cost.settings.soonPct"), form.soonPct, (v) => set({ soonPct: v }), true)}
            {num("soonDays", t("cost.settings.soonDays"), form.soonDays, (v) => set({ soonDays: v }))}
          </div>
          <div>
            <Button onClick={save} loading={update.isPending}>{t("cost.settings.save")}</Button>
          </div>
        </Panel>
      </Can>
    </div>
  );
}
