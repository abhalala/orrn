import { PLANT_UNIT_CHOICES, type PlantUnitSettings, type UnitId } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { DATE_ORDERS, draftDirty, draftFromSettings, draftPayload, followUntouched, previewFor, rebaseDraft, type UnitsDraft } from "./units-model";
import { TabState, usePlantSettings } from "./ui";
import { Fact, PreviewList } from "./units-preview";

const DATE_KEY = { dmy: "settings.units.dateDmy", mdy: "settings.units.dateMdy", ymd: "settings.units.dateYmd" } as const satisfies Record<(typeof DATE_ORDERS)[number], MessageKey>;
const NAME_KEY = (id: UnitId) => `units.name.${id}` as MessageKey;

/**
 * Units and formats: weight, length and section weight, number grouping, date order and the clock for every
 * screen of this plant. People without `settings.update` read the same choices as text. What is stored never changes;
 * papers that leave the plant keep their own units for now (said on the page).
 */
export function UnitsTab() {
  const settings = usePlantSettings();
  return (
    <TabState query={settings}>{settings.data ? <UnitsPanel plant={settings.data.units} timezone={settings.data.timezone} /> : null}</TabState>
  );
}

export function UnitsPanel({ plant, timezone }: { plant: PlantUnitSettings; timezone: string }) {
  const { t, locale } = useT();
  const saved = useMemo(() => draftFromSettings(plant), [plant]);
  const [draft, setDraft] = useState<UnitsDraft>(saved);
  const [seen, setSeen] = useState<UnitsDraft>(saved);
  // The choices this person edited in this tab: only those are sent, so another admin's save is never sent back.
  const [touched, setTouched] = useState<ReadonlySet<keyof UnitsDraft>>(() => new Set());
  if (seen !== saved) {
    // The plant's saved set changed (a refetch after another admin's save, or this tab's own): see `rebaseDraft`.
    setSeen(saved);
    setDraft((d) => followUntouched(rebaseDraft(d, seen, saved), touched, saved));
  }
  const dirty = draftDirty(draft, saved);
  const preview = useMemo(() => previewFor(draft, plant, { locale, timeZone: timezone }), [draft, plant, locale, timezone]);
  const queryClient = useQueryClient();
  const headingId = useId();
  const set = <K extends keyof UnitsDraft>(key: K, value: UnitsDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((prev) => new Set(prev).add(key));
  };

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.units.saved"));
        setTouched(new Set());
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
      },
      onError: () => toast.error(t("settings.units.saveFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    save.mutate({ units: draftPayload(draft, plant, touched) });
  };

  const options = <K extends keyof typeof PLANT_UNIT_CHOICES>(kind: K) =>
    PLANT_UNIT_CHOICES[kind].map((id) => ({ value: id, label: t(NAME_KEY(id)) })) as { value: (typeof PLANT_UNIT_CHOICES)[K][number]; label: string }[];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-units">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.units.title")}</CardTitle>
          <CardDescription>{t("settings.units.intro")}</CardDescription>
        </CardHeader>
        <Can
          do="settings.update"
          fallback={
            <CardContent>
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label={t("settings.units.weight")} value={t(NAME_KEY(saved.mass))} />
                <Fact label={t("settings.units.length")} value={t(NAME_KEY(saved.length))} />
                <Fact label={t("settings.units.sectionWeight")} value={t(NAME_KEY(saved.linear_mass))} />
                <Fact label={t("settings.units.grouping")} value={t(saved.grouping === "indian" ? "settings.units.groupingIndian" : "settings.units.groupingInternational")} />
                <Fact label={t("settings.units.dateOrder")} value={t(DATE_KEY[saved.dateOrder])} />
                <Fact label={t("settings.units.clock")} value={t(saved.clock === "h23" ? "settings.units.clock24" : "settings.units.clock12")} />
              </dl>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="settings-read-only">
                {t("settings.units.readOnly")}
              </p>
            </CardContent>
          }
        >
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate aria-labelledby={headingId}>
            <span id={headingId} className="sr-only">
              {t("settings.units.title")}
            </span>
            <CardContent>
              <Choice label={t("settings.units.weight")}>
                <Pick label={t("settings.units.weight")} value={draft.mass} options={options("mass")} onChange={(v) => set("mass", v)} />
              </Choice>
              <Choice label={t("settings.units.length")}>
                <Pick label={t("settings.units.length")} value={draft.length} options={options("length")} onChange={(v) => set("length", v)} />
              </Choice>
              <Choice label={t("settings.units.sectionWeight")} hint={t("settings.units.sectionWeightHint")} hintId={`${headingId}-section-hint`}>
                <Pick
                  describedBy={`${headingId}-section-hint`}
                  label={t("settings.units.sectionWeight")}
                  value={draft.linear_mass}
                  options={options("linear_mass")}
                  onChange={(v) => set("linear_mass", v)}
                />
              </Choice>
              <Choice label={t("settings.units.grouping")}>
                <Pick
                  label={t("settings.units.grouping")}
                  value={draft.grouping}
                  options={[
                    { value: "indian", label: t("settings.units.groupingIndian") },
                    { value: "international", label: t("settings.units.groupingInternational") },
                  ]}
                  onChange={(v) => set("grouping", v)}
                />
              </Choice>
              <Field id="settings-date-order" label={t("settings.units.dateOrder")} className="md:max-w-sm">
                <NativeSelect id="settings-date-order" value={draft.dateOrder} onChange={(e) => set("dateOrder", e.target.value as UnitsDraft["dateOrder"])} data-testid="settings-date-order">
                  {DATE_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {t(DATE_KEY[order])}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Choice label={t("settings.units.clock")}>
                <SegmentedControl
                  label={t("settings.units.clock")}
                  value={draft.clock}
                  options={[
                    { value: "h23", label: t("settings.units.clock24") },
                    { value: "h12", label: t("settings.units.clock12") },
                  ]}
                  onChange={(v) => set("clock", v)}
                />
              </Choice>
            </CardContent>
            <FormActions sticky={false}>
              <Button type="submit" disabled={!dirty} loading={save.isPending}>
                {t("settings.units.save")}
              </Button>
            </FormActions>
          </form>
        </Can>
        <CardContent>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="settings-units-phone">
            {t("settings.units.phoneNote")}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="settings-units-preview">
        <CardHeader>
          <CardTitle>{t("settings.units.preview")}</CardTitle>
          <CardDescription>{t("settings.units.previewHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PreviewList lines={preview} />
          <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="settings-units-papers">
            {t("settings.units.papersNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One choice among a few. The labels are long ("International (1,234,567)", "Millimetres (mm)"), so below the sm breakpoint
 * (a 320 px screen, or 400 percent zoom) they are a select that shows the whole label; from sm up they are the segmented control.
 * Both are in the markup and the style hides one; a hidden one is out of the reading order.
 */
function Pick<T extends string>({ label, value, options, onChange, describedBy }: { label: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void; describedBy?: string }) {
  return (
    <>
      <NativeSelect aria-label={label} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value as T)} className="sm:hidden" data-testid="units-pick-select">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <div className="hidden sm:block">
        <SegmentedControl label={label} aria-describedby={describedBy} value={value} options={options} onChange={onChange} />
      </div>
    </>
  );
}

/**
 * A visible caption over one choice. The choice carries its own accessible name (a radio group or a select, named by `label`),
 * so this wrapper is not a second group of the same name; the hint it holds is tied to the choice by `describedBy`.
 */
function Choice({ label, hint, hintId, children }: { label: string; hint?: string; hintId?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[14px] leading-5 font-semibold" aria-hidden="true">
        {label}
      </span>
      {children}
      {hint ? (
        <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
