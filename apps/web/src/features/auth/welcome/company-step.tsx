import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type FormEvent, type Ref } from "react";

import type { Me } from "@/shared/lib/me";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { FormAlert } from "../form-alert";
import { DEFAULT_TIMEZONE, deviceTimezone, timezoneOptions } from "../timezones";
import { StepHeading } from "./step-heading";

type Errors = Partial<Record<"location" | "contact" | "presses" | "terms", string>>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Company details for an owner or admin whose onboarding is open: terms,
 * location, contact phone, time zone, presses (`auth.completeOnboarding`).
 * Prefilled from the company's saved settings, so an admin joining a company
 * the owner already set up only reviews and confirms.
 */
export function CompanyStep({
  me,
  onDone,
  headingRef,
}: {
  me: Me;
  onDone(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  const settings = (me.company?.settings ?? {}) as Record<string, unknown>;
  const device = useMemo(deviceTimezone, []);
  const savedZone = text(settings.timezone);
  const zones = useMemo(() => timezoneOptions({ device, saved: savedZone || undefined }), [device, savedZone]);

  const [location, setLocation] = useState(text(settings.facilityLocation));
  const [contact, setContact] = useState(text(settings.primaryContact));
  const [timezone, setTimezone] = useState(savedZone || DEFAULT_TIMEZONE);
  const [presses, setPresses] = useState(
    typeof settings.pressCount === "number" && settings.pressCount > 0 ? String(settings.pressCount) : "",
  );
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const refs = {
    location: useRef<HTMLInputElement>(null),
    contact: useRef<HTMLInputElement>(null),
    presses: useRef<HTMLInputElement>(null),
    terms: useRef<HTMLInputElement>(null),
  };
  const timezoneId = useId();
  const termsErrorId = useId();

  const save = useMutation(trpc.auth.completeOnboarding.mutationOptions());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    const next: Errors = {};
    if (!location.trim()) next.location = t("errors.required");
    if (!contact.trim()) next.contact = t("errors.required");
    const pressCount = Number(presses.replace(/,/g, ""));
    if (!presses.trim()) next.presses = t("errors.required");
    else if (!Number.isInteger(pressCount) || pressCount < 0) next.presses = t("errors.wholeNumber");
    if (!agreed) next.terms = t("welcome.company.termsRequired");
    setErrors(next);
    const first = (["location", "contact", "presses", "terms"] as const).find((k) => next[k]);
    if (first) return refs[first].current?.focus();

    try {
      await save.mutateAsync({
        facilityLocation: location.trim(),
        primaryContact: contact.trim(),
        timezone,
        pressCount,
      });
    } catch {
      return;
    }
    await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
    onDone();
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeading headingRef={headingRef} title={t("welcome.company.title")} body={t("welcome.company.body")} />
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-busy={save.isPending || undefined}>
        <Field label={t("welcome.company.location")} hint={t("welcome.company.locationHint")} error={errors.location}>
          <TextInput
            ref={refs.location}
            autoComplete="address-level2"
            maxLength={200}
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("welcome.company.contact")} error={errors.contact}>
            <TextInput
              ref={refs.contact}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={64}
              value={contact}
              onChange={(e) => setContact(e.currentTarget.value)}
              className="font-mono tabular-nums"
            />
          </Field>
          <Field label={t("welcome.company.presses")} error={errors.presses}>
            <NumberInput ref={refs.presses} decimal={false} maxLength={3} value={presses} onValueChange={setPresses} />
          </Field>
        </div>
        <Field label={t("welcome.company.timezone")} id={timezoneId}>
          <NativeSelect id={timezoneId} value={timezone} onChange={(e) => setTimezone(e.currentTarget.value)}>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.device ? t("welcome.company.thisDevice", { zone: z.label }) : z.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <section aria-labelledby={`${termsErrorId}-title`} className="flex flex-col gap-3 rounded-card bg-surface-sunken p-4">
          <h2 id={`${termsErrorId}-title`} className="m-0 text-[15px] font-semibold leading-6 text-foreground">
            {t("welcome.company.termsTitle")}
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-5 text-foreground marker:text-muted-foreground">
            <li>{t("welcome.company.termsUse")}</li>
            <li>{t("welcome.company.termsPasswords")}</li>
            <li>{t("welcome.company.termsData")}</li>
          </ul>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-medium leading-5 text-foreground">
            <input
              ref={refs.terms}
              type="checkbox"
              checked={agreed}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? termsErrorId : undefined}
              onChange={(e) => setAgreed(e.currentTarget.checked)}
              className="size-5 shrink-0 cursor-pointer accent-[var(--ink)]"
            />
            {t("welcome.company.terms")}
          </label>
          {errors.terms ? (
            <p id={termsErrorId} className="m-0 text-[13px] font-medium leading-5 text-destructive">
              {errors.terms}
            </p>
          ) : null}
        </section>

        {save.isError ? <FormAlert>{t("errors.generic")}</FormAlert> : null}
        <Button type="submit" size="lg" loading={save.isPending} className="w-full">
          {save.isPending ? t("welcome.company.submitting") : t("welcome.company.submit")}
        </Button>
      </form>
    </div>
  );
}
