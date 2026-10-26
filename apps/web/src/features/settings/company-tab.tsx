import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { LanguageToggle } from "@/shell/language-toggle";
import { trpc } from "@/shared/utils/trpc";

import {
  gstinValid,
  lengthUnitOf,
  letterheadDirty,
  letterheadDraft,
  timezoneOf,
  timezoneOptions,
  type LengthUnitSetting,
  type LetterheadDraft,
} from "./model";
import { usePlantSettings } from "./ui";

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

      <LetterheadCard />

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

/**
 * Letterhead (PL v2 header): legal name, GSTIN, address and phone, printed at the top of packing
 * lists and test certificates. Stored in the company settings; owners and admins edit.
 */
function LetterheadCard() {
  const { t } = useT();
  const settings = usePlantSettings();
  const saved = letterheadDraft(settings.data?.letterhead);
  const signature = JSON.stringify(saved);
  return (
    <Card data-testid="settings-letterhead">
      <CardHeader>
        <CardTitle>{t("plantSettings.letterhead.title")}</CardTitle>
        <CardDescription>{t("settings.company.letterheadHint")}</CardDescription>
      </CardHeader>
      <Can
        do="settings.update"
        fallback={
          <CardContent>
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label={t("plantSettings.letterhead.legalName")} value={saved.legalName || "-"} />
              <Fact label={t("plantSettings.letterhead.gstin")} value={saved.gstin || "-"} mono />
              <Fact label={t("plantSettings.letterhead.address")} value={saved.address || "-"} />
              <Fact label={t("plantSettings.letterhead.phone")} value={saved.phone || "-"} mono />
            </dl>
          </CardContent>
        }
      >
        <LetterheadForm key={signature} saved={saved} />
      </Can>
    </Card>
  );
}

function LetterheadForm({ saved }: { saved: LetterheadDraft }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LetterheadDraft>(saved);
  const [touched, setTouched] = useState(false);
  const dirty = letterheadDirty(draft, saved);
  const gstinBad = touched && !gstinValid(draft.gstin);

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.company.letterheadSaved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
      },
      onError: () => toast.error(t("settings.company.saveFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!dirty || !gstinValid(draft.gstin) || save.isPending) return;
    save.mutate({
      letterhead: {
        legalName: draft.legalName.trim() || null,
        gstin: draft.gstin.trim().toUpperCase() || null,
        address: draft.address.trim() || null,
        phone: draft.phone.trim() || null,
      },
    });
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("plantSettings.letterhead.legalName")}>
            <TextInput value={draft.legalName} maxLength={200} autoComplete="organization" data-testid="letterhead-legal-name" onChange={(e) => setDraft({ ...draft, legalName: e.currentTarget.value })} />
          </Field>
          <Field label={t("plantSettings.letterhead.gstin")} error={gstinBad ? t("settings.company.gstinInvalid") : undefined}>
            <TextInput
              value={draft.gstin}
              maxLength={15}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono"
              data-testid="letterhead-gstin"
              onChange={(e) => setDraft({ ...draft, gstin: e.currentTarget.value.toUpperCase() })}
              onBlur={() => setTouched(true)}
            />
          </Field>
          <Field label={t("plantSettings.letterhead.phone")}>
            <TextInput value={draft.phone} maxLength={40} inputMode="tel" autoComplete="tel" data-testid="letterhead-phone" onChange={(e) => setDraft({ ...draft, phone: e.currentTarget.value })} />
          </Field>
        </div>
        <Field label={t("plantSettings.letterhead.address")}>
          <FieldTextArea value={draft.address} maxLength={500} rows={3} data-testid="letterhead-address" onChangeText={(address) => setDraft({ ...draft, address })} />
        </Field>
      </CardContent>
      <FormActions sticky={false}>
        <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="letterhead-save">
          {t("settings.company.letterheadSubmit")}
        </Button>
      </FormActions>
    </form>
  );
}
