import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput, useFieldControl } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { FormAlert } from "@/features/auth/form-alert";
import { composeRequestNotes } from "@/features/auth/request-notes";
import { trpc } from "@/shared/utils/trpc";

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Room left for the person's own words once lines and the slot are packed in (server cap 500). */
const NOTES_MAX = 400;

export const Route = createFileRoute("/_public/request-access")({
  // Marketing links still say which button was pressed (a demo or the
  // waitlist). Both land on this one form; the walkthrough slot is optional.
  validateSearch: (search: Record<string, unknown>): { mode?: "demo" | "waitlist" } =>
    search.mode === "demo" || search.mode === "waitlist" ? { mode: search.mode } : {},
  component: RequestAccessPage,
});

type Values = {
  companyName: string;
  requesterName: string;
  requesterEmail: string;
  lines: string;
  date: string;
  time: string;
  notes: string;
};

type Errors = Partial<Record<"companyName" | "requesterName" | "requesterEmail", MessageKey>>;

const EMPTY: Values = { companyName: "", requesterName: "", requesterEmail: "", lines: "", date: "", time: "", notes: "" };

function RequestAccessPage() {
  const { t } = useT();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const refs = {
    companyName: useRef<HTMLInputElement>(null),
    requesterName: useRef<HTMLInputElement>(null),
    requesterEmail: useRef<HTMLInputElement>(null),
  };
  const successHeading = useRef<HTMLHeadingElement>(null);

  const submit = useMutation({
    ...trpc.waitlist.submit.mutationOptions(),
    onSuccess: (_data, input) => setSentTo(input.requesterEmail),
  });

  useEffect(() => {
    if (sentTo) successHeading.current?.focus();
  }, [sentTo]);

  const set = (key: keyof Values) => (value: string) => setValues((v) => ({ ...v, [key]: value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!values.companyName.trim()) next.companyName = "auth.validation.company";
    if (!values.requesterName.trim()) next.requesterName = "auth.validation.name";
    const email = values.requesterEmail.trim();
    if (!email) next.requesterEmail = "auth.validation.email";
    else if (!EMAIL.test(email)) next.requesterEmail = "errors.invalidEmail";
    setErrors(next);
    const first = (["companyName", "requesterName", "requesterEmail"] as const).find((k) => next[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    submit.mutate({
      companyName: values.companyName.trim(),
      requesterName: values.requesterName.trim(),
      requesterEmail: email,
      notes: composeRequestNotes({ lines: values.lines, date: values.date, time: values.time, notes: values.notes }),
    });
  };

  if (sentTo) {
    // The success block is the one loud element here, so no brand panel.
    return (
      <AuthFrame>
        <div className="flex flex-col gap-6">
          <div
            role="status"
            className="orrn-block orrn-block-green orrn-block-sheen animate-pop flex min-h-[168px] flex-col justify-between gap-6 p-[18px]"
          >
            <span aria-hidden="true" className="relative flex size-11 items-center justify-center rounded-full bg-tone-green-on/20">
              <Check className="size-6" strokeWidth={2} />
            </span>
            <span className="relative flex flex-col gap-2">
              <h1 ref={successHeading} tabIndex={-1} className="m-0 font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.04em]">
                {t("auth.requestAccess.successTitle")}
              </h1>
              <span className="text-[15px] font-medium leading-6 break-words">
                {t("auth.requestAccess.successBody", { email: sentTo })}
              </span>
            </span>
          </div>
          <Button asChild size="lg" variant="secondary" className="w-full">
            <Link to="/">{t("auth.requestAccess.backHome")}</Link>
          </Button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame brand width="wide">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="orrn-auth-title">{t("auth.requestAccess.title")}</h1>
          <p className="m-0 max-w-[52ch] text-[15px] leading-6 text-muted-foreground">{t("auth.requestAccess.subtitle")}</p>
        </div>

        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={submit.isPending || undefined}>
          <Field label={t("auth.requestAccess.company")} error={errors.companyName && t(errors.companyName)}>
            <TextInput
              ref={refs.companyName}
              autoComplete="organization"
              maxLength={200}
              value={values.companyName}
              onChange={(e) => set("companyName")(e.currentTarget.value)}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("auth.requestAccess.name")} error={errors.requesterName && t(errors.requesterName)}>
              <TextInput
                ref={refs.requesterName}
                autoComplete="name"
                maxLength={200}
                value={values.requesterName}
                onChange={(e) => set("requesterName")(e.currentTarget.value)}
              />
            </Field>
            <Field label={t("auth.requestAccess.workEmail")} error={errors.requesterEmail && t(errors.requesterEmail)}>
              <TextInput
                ref={refs.requesterEmail}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={320}
                value={values.requesterEmail}
                onChange={(e) => set("requesterEmail")(e.currentTarget.value)}
              />
            </Field>
          </div>
          <Field label={t("auth.requestAccess.lines")} hint={t("common.optional")} className="sm:max-w-[calc(50%-10px)]">
            <NumberInput decimal={false} maxLength={3} value={values.lines} onValueChange={set("lines")} />
          </Field>

          {/* A rendered <legend> is not a flex item, so the gap would skip it: the margin keeps the form's rhythm. */}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-4 p-0">
              <span className="block text-[15px] font-semibold leading-6 text-foreground">{t("auth.requestAccess.slotTitle")}</span>
              <span className="block text-[13px] leading-5 text-muted-foreground">{t("auth.requestAccess.slotHint")}</span>
            </legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("auth.requestAccess.preferredDate")}>
                <TextInput type="date" value={values.date} onChange={(e) => set("date")(e.currentTarget.value)} />
              </Field>
              <Field label={t("auth.requestAccess.preferredTime")}>
                <TextInput type="time" value={values.time} onChange={(e) => set("time")(e.currentTarget.value)} />
              </Field>
            </div>
          </fieldset>

          <NotesField value={values.notes} onValueChange={set("notes")} />

          {submit.isError ? <FormAlert>{t("auth.requestAccess.failed")}</FormAlert> : null}

          <Button type="submit" size="lg" loading={submit.isPending} className="w-full">
            {submit.isPending ? t("auth.requestAccess.submitting") : t("auth.requestAccess.submit")}
          </Button>
        </form>
      </div>
    </AuthFrame>
  );
}

function NotesField({ value, onValueChange }: { value: string; onValueChange(v: string): void }) {
  const { t } = useT();
  return (
    <Field label={t("auth.requestAccess.notes")} hint={t("auth.requestAccess.notesHint", { max: NOTES_MAX })}>
      <NotesArea value={value} onValueChange={onValueChange} />
    </Field>
  );
}

/** TextArea wired to the surrounding Field (label, hint) like TextInput is. */
function NotesArea({ value, onValueChange }: { value: string; onValueChange(v: string): void }) {
  const a11y = useFieldControl();
  return (
    <TextArea rows={4} maxLength={NOTES_MAX} value={value} onChange={(e) => onValueChange(e.currentTarget.value)} {...a11y} />
  );
}
