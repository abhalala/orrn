import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { LanguageToggle } from "@/shell/language-toggle";
import { trpc } from "@/shared/utils/trpc";

import { lengthUnitOf, timezoneOf, timezoneOptions, type LengthUnitSetting } from "./model";

/**
 * Company: the name (read-only, orrn support changes it), the units and time
 * zone (`company.updateSettings`, `settings.update`) and the language of this
 * device. People without `settings.update` see the same values as text.
 */
export function CompanyTab() {
  const { t } = useT();
  const { data: me } = useMe();
  const company = me?.company;
  if (!company) return null;
  const unit = lengthUnitOf(company.settings);
  const timezone = timezoneOf(company.settings);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-company">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.profile")}</CardTitle>
          <CardDescription>{t("settings.company.nameHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label={t("settings.company.name")} value={company.name} />
            <Fact label={t("settings.company.slug")} value={company.slug} mono />
          </dl>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("settings.company.notStored")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.units")}</CardTitle>
          <CardDescription>{t("settings.company.unitsHint")}</CardDescription>
        </CardHeader>
        <Can
          do="settings.update"
          fallback={
            <CardContent>
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact
                  label={t("settings.company.lengthUnit")}
                  value={unit === "inch" ? t("settings.company.unitInch") : t("settings.company.unitMm")}
                />
                <Fact label={t("settings.company.timezone")} value={timezone} mono />
              </dl>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="settings-read-only">
                {t("settings.company.readOnly")}
              </p>
            </CardContent>
          }
        >
          <UnitsForm unit={unit} timezone={timezone} />
        </Can>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.language")}</CardTitle>
          <CardDescription>{t("settings.company.languageHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageToggle className="self-start" />
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"}>{value}</dd>
    </div>
  );
}

function UnitsForm({ unit, timezone }: { unit: LengthUnitSetting; timezone: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [nextUnit, setNextUnit] = useState<LengthUnitSetting>(unit);
  const [nextZone, setNextZone] = useState(timezone);
  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);
  const dirty = nextUnit !== unit || nextZone !== timezone;

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.company.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: () => toast.error(t("settings.company.saveFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    save.mutate({
      ...(nextUnit !== unit ? { lengthUnit: nextUnit } : {}),
      ...(nextZone !== timezone ? { timezone: nextZone } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
      <CardContent>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[14px] leading-5 font-semibold">{t("settings.company.lengthUnit")}</span>
          <SegmentedControl<LengthUnitSetting>
            label={t("settings.company.lengthUnit")}
            value={nextUnit}
            options={[
              { value: "mm", label: t("settings.company.unitMm") },
              { value: "inch", label: t("settings.company.unitInch") },
            ]}
            onChange={setNextUnit}
          />
        </div>
        <Field id="settings-timezone" label={t("settings.company.timezone")} hint={t("settings.company.timezoneHint")} className="md:max-w-sm">
          <NativeSelect id="settings-timezone" value={nextZone} onChange={(e) => setNextZone(e.target.value)} data-testid="settings-timezone">
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </CardContent>
      <FormActions sticky={false}>
        <Button type="submit" disabled={!dirty} loading={save.isPending}>
          {t("settings.company.submit")}
        </Button>
      </FormActions>
    </form>
  );
}
