import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { WEB_BUILD } from "@/shared/lib/build-info";
import { trpc } from "@/shared/utils/trpc";

import { supportContactOf, supportDraft, supportPatch, type SupportDraft } from "./model";
import { releaseNoteRows } from "./release-notes";

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"}>{value}</dd>
    </div>
  );
}

/**
 * About: the web app's version and build day, who is signed in to which plant, and the plant's
 * support contact (`settings.support`, read as stored). With no contact set it points to Help.
 * People with `settings.update` edit the contact here (name, phone, hours; FP-PF-14). Below it, the
 * last eight app builds and what each changed (`release.notes`, FP-PF-14).
 */
export function AboutTab() {
  const { t } = useT();
  const { data: me } = useMe();
  const company = me?.company;
  const contact = supportContactOf(company?.settings);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-about">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about.app")}</CardTitle>
          <CardDescription>in.orrn.app</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label={t("settings.about.version")} value={`${WEB_BUILD.version} (${WEB_BUILD.date})`} mono />
            <Fact label={t("settings.about.plant")} value={company?.name ?? "-"} />
            <Fact label={t("settings.about.signedIn")} value={me?.user.email ?? "-"} />
            <Fact label={t("settings.about.role")} value={company ? t(`roles.${company.role}`) : "-"} />
          </dl>
        </CardContent>
      </Card>

      <Can do="settings.update">
        <SupportEditor settings={company?.settings} />
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about.support")}</CardTitle>
        </CardHeader>
        <CardContent>
          {contact ? (
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="support-contact">
              {contact.name ? <Fact label={t("settings.about.support")} value={contact.name} /> : null}
              {contact.phone ? <Fact label={t("plantSettings.letterhead.phone")} value={contact.phone} mono /> : null}
              {contact.email ? <Fact label={t("settings.team.email")} value={contact.email} /> : null}
              {contact.hours ? <Fact label={t("settings.about.hoursLabel")} value={contact.hours} /> : null}
            </dl>
          ) : (
            <p className="m-0 text-[15px] leading-6 text-muted-foreground" data-testid="support-contact-none">
              {t("settings.about.supportNone")}
            </p>
          )}
          <div className="flex flex-wrap gap-4 pt-1">
            <Link to="/settings" search={{ tab: "support" }} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t("settings.about.help")}
            </Link>
            <Link to="/guides" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t("settings.about.guides")}
            </Link>
          </div>
        </CardContent>
      </Card>

      <ReleaseNotesCard />
    </div>
  );
}

/** FP-PF-14: what changed in the last app builds (the update gate's own notes), newest first. */
function ReleaseNotesCard() {
  const { t, locale } = useT();
  const notes = useQuery(trpc.release.notes.queryOptions());
  const rows = releaseNoteRows(notes.data?.items, { locale });
  return (
    <Card data-testid="release-notes">
      <CardHeader>
        <CardTitle>{t("settings.about.releaseNotes")}</CardTitle>
        <CardDescription>{t("settings.about.releaseNotesHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {notes.isPending ? null : rows.length === 0 ? (
          <p className="m-0 text-[15px] leading-6 text-muted-foreground" data-testid="release-notes-none">
            {t("settings.about.releaseNotesNone")}
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0" data-testid="release-note">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">
                    {t("settings.about.releaseBuild", {
                      platform: t(`settings.about.platformName.${r.platform}`),
                      version: r.version,
                      build: r.build,
                    })}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{r.day}</span>
                  {r.mandatory ? (
                    <span className="rounded-full bg-tone-amber-tint px-2 py-0.5 text-[12px] font-semibold text-tone-amber-ink">
                      {t("settings.about.releaseMandatory")}
                    </span>
                  ) : null}
                </div>
                <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-line">{r.notes}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function SupportEditor({ settings }: { settings: Record<string, unknown> | undefined }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const saved = supportDraft(settings);
  const [draft, setDraft] = useState<SupportDraft>(saved);
  const patch = supportPatch(draft, saved);

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.about.supportSaved"));
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: () => toast.error(t("settings.about.supportSaveFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (patch) save.mutate({ support: patch });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.about.supportEditTitle")}</CardTitle>
        <CardDescription>{t("settings.about.supportEditHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4" data-testid="support-editor">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={t("settings.about.supportName")}>
              <TextInput value={draft.name} maxLength={100} autoComplete="off" data-testid="support-name" onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
            </Field>
            <Field label={t("settings.about.supportPhone")}>
              <TextInput value={draft.phone} maxLength={40} inputMode="tel" autoComplete="off" data-testid="support-phone" onChange={(e) => setDraft({ ...draft, phone: e.currentTarget.value })} />
            </Field>
            <Field label={t("settings.about.supportHours")}>
              <TextInput value={draft.hours} maxLength={100} autoComplete="off" data-testid="support-hours" onChange={(e) => setDraft({ ...draft, hours: e.currentTarget.value })} />
            </Field>
          </div>
          <FormActions sticky={false}>
            <Button type="submit" disabled={!patch} loading={save.isPending} data-testid="support-save">
              {t("settings.about.supportSave")}
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
