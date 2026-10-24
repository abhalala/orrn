import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { formatDay } from "./format";
import { apkAllowed, EMPTY_RELEASE_FORM, MAX_RELEASE_NOTES, parseReleaseForm, releaseErrorKey, type ReleaseField, type ReleaseForm } from "./releases";
import { LoadError, Panel } from "./ui";
import type { MessageKey } from "@orrn/i18n";

type Release = inferRouterOutputs<AppRouter>["platform"]["release"]["list"][number];

/**
 * Godseye > App builds (`/admin/releases`, FP-PF-11): the published builds, and the form that
 * publishes one (`platform.release.publish`: super admin and admin; support reads). One app id,
 * two channels: `production` (store builds) and `floor` (the signed APK for the plant tablets).
 */
export function ReleasesPage() {
  const { t, locale } = useT();
  const list = useQuery({ ...trpc.platform.release.list.queryOptions(), meta: { inlineError: true } });

  const columns: ResponsiveListColumn<Release>[] = [
    { key: "version", header: t("admin.releases.columns.version"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.version}</span> },
    {
      key: "platform",
      header: t("admin.releases.columns.platform"),
      cell: (r) => (
        <span>
          {t(`admin.releases.platforms.${r.platform}`)}
          {" · "}
          {t(`admin.releases.channels.${r.channel}`)}
        </span>
      ),
    },
    { key: "build", header: t("admin.releases.columns.build"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.buildNumber ?? "-"}</span> },
    { key: "min", header: t("admin.releases.columns.minimum"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.minBuild ?? "-"}</span> },
    { key: "published", header: t("admin.releases.columns.published"), hideOnPhone: true, cell: (r) => <span className="whitespace-nowrap">{formatDay(r.publishedAt, { locale })}</span> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="admin-releases">
      <PageHeader title={t("admin.releases.title")} subtitle={t("admin.releases.subtitle")} />
      <Can do="platform.release.publish">
        <PublishForm />
      </Can>
      <section aria-labelledby="published-builds" className="flex min-w-0 flex-col gap-3">
        <h2 id="published-builds" className="m-0 text-[17px] font-semibold">
          {t("admin.releases.listTitle")}
        </h2>
        {list.isError && list.data === undefined ? (
          <LoadError message={t("admin.releases.loadError")} onRetry={() => void list.refetch()} />
        ) : (
          <ResponsiveList
            rows={list.data ?? []}
            loading={list.isPending}
            label={t("admin.releases.listTitle")}
            rowKey={(r) => r.id}
            columns={columns}
            empty={<EmptyState title={t("admin.releases.empty")} />}
          />
        )}
      </section>
    </div>
  );
}

function PublishForm() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ReleaseForm>(EMPTY_RELEASE_FORM);
  const [errors, setErrors] = useState<Partial<Record<ReleaseField, MessageKey>>>({});
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const mandatoryId = useId();
  const set = (patch: Partial<ReleaseForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setRefused(null);
  };

  const publish = useMutation(
    trpc.platform.release.publish.mutationOptions({
      onSuccess: () => {
        toast.success(t("admin.releases.published"));
        setForm({ ...EMPTY_RELEASE_FORM, platform: form.platform, channel: form.channel });
        setErrors({});
        setRefused(null);
        void queryClient.invalidateQueries({ queryKey: trpc.platform.release.list.queryKey() });
      },
      onError: (error) => setRefused(releaseErrorKey(error)),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseReleaseForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    publish.mutate(parsed.input);
  };
  const err = (field: ReleaseField) => (errors[field] ? t(errors[field]!) : undefined);

  return (
    <Panel className="p-4 sm:p-5">
      <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4" data-testid="publish-form">
        <h2 className="m-0 text-[17px] font-semibold">{t("admin.releases.publishTitle")}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[14px] font-semibold">{t("admin.releases.platform")}</span>
            <SegmentedControl
              label={t("admin.releases.platform")}
              value={form.platform}
              onChange={(platform) => set({ platform, ...(platform === "ios" ? { channel: "production" as const } : {}) })}
              options={[
                { value: "android", label: t("admin.releases.platforms.android") },
                { value: "ios", label: t("admin.releases.platforms.ios") },
              ]}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[14px] font-semibold">{t("admin.releases.channel")}</span>
            <SegmentedControl
              label={t("admin.releases.channel")}
              value={form.channel}
              onChange={(channel) => set({ channel })}
              options={[
                { value: "floor", label: t("admin.releases.channels.floor") },
                { value: "production", label: t("admin.releases.channels.production") },
              ]}
            />
          </div>
          <Field label={t("admin.releases.version")} hint={t("admin.releases.versionHint")} error={err("version")}>
            <TextInput value={form.version} maxLength={32} autoComplete="off" data-testid="release-version" onChange={(e) => set({ version: e.currentTarget.value })} />
          </Field>
          <Field label={t("admin.releases.build")} hint={t("admin.releases.buildHint")} error={err("build")}>
            <TextInput value={form.build} inputMode="numeric" autoComplete="off" data-testid="release-build" onChange={(e) => set({ build: e.currentTarget.value })} />
          </Field>
          <Field label={t("admin.releases.minBuild")} hint={t("admin.releases.minBuildHint")} error={err("minBuild")}>
            <TextInput value={form.minBuild} inputMode="numeric" autoComplete="off" data-testid="release-min-build" onChange={(e) => set({ minBuild: e.currentTarget.value })} />
          </Field>
          {apkAllowed(form) ? (
            <Field label={t("admin.releases.apkUrl")} hint={t("admin.releases.apkHint")} error={err("apkUrl")}>
              <TextInput value={form.apkUrl} inputMode="url" autoCapitalize="none" spellCheck={false} autoComplete="off" data-testid="release-apk" onChange={(e) => set({ apkUrl: e.currentTarget.value })} />
            </Field>
          ) : null}
        </div>
        <Field label={t("admin.releases.notes")} hint={t("admin.releases.notesHint", { max: MAX_RELEASE_NOTES })} error={err("notes")}>
          <FieldTextArea value={form.notes} maxLength={MAX_RELEASE_NOTES} rows={3} data-testid="release-notes" onChangeText={(notes) => set({ notes })} />
        </Field>
        <div className="flex min-w-0 items-center gap-3">
          <Checkbox id={mandatoryId} checked={form.mandatory} onCheckedChange={(v) => set({ mandatory: v === true })} />
          <label htmlFor={mandatoryId} className="min-w-0 text-[15px] leading-6 break-words">
            {t("admin.releases.mandatory")}
          </label>
        </div>
        {refused ? (
          <p role="alert" data-testid="release-refused" className="m-0 text-[15px] leading-6 font-medium text-destructive">
            {t(refused)}
          </p>
        ) : null}
        <FormActions sticky={false}>
          <Button type="submit" loading={publish.isPending} data-testid="release-publish">
            {t("admin.releases.publish")}
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
