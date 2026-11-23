import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useOnceMutation } from "@/shared/lib/once-mutation";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { FieldSelect, FieldTextArea } from "./field-controls";
import { assetFormValid, assetPayload, emptyAssetForm, formFromAsset, linkFitsKind, linkKindFor, linkValue, type AssetFormState } from "./asset-model";
import { ASSET_KINDS, ASSET_STATUSES, CRITICALITIES, LINK_KINDS, maintErrorKey, type LinkKind } from "./model";

export type LinkOption = {
  kind: LinkKind;
  id: string;
  code: string;
  name: string | null;
  retired: boolean;
  asset: { id: string; code: string } | null;
};

/** The fields of the asset form (no data hooks: the sheet below feeds it). */
export function AssetFields({
  form,
  onChange,
  options,
  ownLink,
  optionsLoading = false,
  optionsError = false,
  onRetryOptions,
}: {
  form: AssetFormState;
  onChange(patch: Partial<AssetFormState>): void;
  options: readonly LinkOption[] | undefined;
  /** The `kind:id` this asset already points at, so its own master is not shown as taken. */
  ownLink: string;
  /** The link list is still loading. */
  optionsLoading?: boolean;
  /** The link list failed to load. */
  optionsError?: boolean;
  onRetryOptions?(): void;
}) {
  const { t } = useT();
  const text = (key: keyof AssetFormState) => ({
    value: form[key] as string,
    onChange: (e: { currentTarget: { value: string } }) => onChange({ [key]: e.currentTarget.value } as Partial<AssetFormState>),
  });
  return (
    <div className="flex flex-col gap-4" data-testid="asset-fields">
      <Field label={t("maint.assets.form.code")} required>
        <TextInput {...text("code")} maxLength={40} autoComplete="off" />
      </Field>
      <Field label={t("maint.assets.form.name")} required>
        <TextInput {...text("name")} maxLength={120} autoComplete="off" />
      </Field>
      <Field label={t("maint.assets.form.kind")}>
        <FieldSelect value={form.kind} onChange={(e) => onChange({ kind: e.currentTarget.value as AssetFormState["kind"] })}>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`maint.kind.${k}`)}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t("maint.assets.form.link")} hint={t("maint.assets.form.linkHint")} error={!linkFitsKind(form.kind, form.link) ? t("maint.assets.form.linkWrongKind") : undefined}>
        <FieldSelect value={form.link} onChange={(e) => onChange({ link: e.currentTarget.value })}>
          <option value="">{t("maint.assets.form.linkNone")}</option>
          {LINK_KINDS.map((kind) => {
            const group = (options ?? []).filter((o) => (o.kind === linkKindFor(form.kind) && o.kind === kind) || (o.kind === kind && linkValue(o.kind, o.id) === form.link));
            if (group.length === 0) return null;
            return (
              <optgroup key={kind} label={t(`maint.link.${kind}`)}>
                {group.map((o) => {
                  const key = linkValue(o.kind, o.id);
                  const taken = o.asset !== null && key !== ownLink;
                  const label = [o.code, o.name, o.retired ? t("maint.assets.form.linkRetired") : null].filter(Boolean).join(" ");
                  return (
                    <option key={key} value={key} disabled={taken}>
                      {taken ? `${label} (${t("maint.assets.form.linkTaken", { code: o.asset!.code })})` : label}
                    </option>
                  );
                })}
              </optgroup>
            );
          })}
        </FieldSelect>
        {optionsLoading ? (
          <p className="m-0 mt-1 text-[13px] text-muted-foreground" role="status" data-testid="link-options-loading">
            {t("maint.assets.form.linkLoading")}
          </p>
        ) : null}
        {optionsError ? (
          <div className="mt-1 flex flex-wrap items-center gap-2" role="alert" data-testid="link-options-error">
            <span className="text-[13px] font-medium text-destructive">{t("maint.assets.form.linkFailed")}</span>
            <Button variant="secondary" onClick={() => onRetryOptions?.()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
      </Field>
      <Field label={t("maint.assets.form.make")}>
        <TextInput {...text("make")} maxLength={120} />
      </Field>
      <Field label={t("maint.assets.form.serialNo")}>
        <TextInput {...text("serialNo")} maxLength={120} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("maint.assets.form.purchasedOn")}>
          <TextInput type="date" {...text("purchasedOn")} />
        </Field>
        <Field label={t("maint.assets.form.warrantyUntil")}>
          <TextInput type="date" {...text("warrantyUntil")} />
        </Field>
      </div>
      <Field label={t("maint.assets.form.location")}>
        <TextInput {...text("location")} maxLength={120} />
      </Field>
      <Field label={t("maint.assets.form.criticality")}>
        <FieldSelect
          value={form.criticality}
          onChange={(e) =>
            onChange({
              criticality: e.currentTarget.value as AssetFormState["criticality"],
            })
          }
        >
          {CRITICALITIES.map((c) => (
            <option key={c} value={c}>
              {`${t(`maint.criticality.${c}`)}: ${t(`maint.criticalityHint.${c}`)}`}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t("maint.assets.form.status")}>
        <FieldSelect
          value={form.status}
          onChange={(e) =>
            onChange({
              status: e.currentTarget.value as AssetFormState["status"],
            })
          }
        >
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`maint.assetStatus.${s}`)}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t("maint.assets.form.note")}>
        <FieldTextArea {...text("note")} rows={3} maxLength={1000} />
      </Field>
    </div>
  );
}

type EditableAsset = Parameters<typeof formFromAsset>[0] & {
  id: string;
  serverSeq: number;
};

/** Add (no `asset`) or change (`asset`) sheet. Adds go to `maint.assets.create`, changes to `maint.assets.update` with `serverSeq`. */
export function AssetSheet({ open, onOpenChange, asset, onSaved }: { open: boolean; onOpenChange(open: boolean): void; asset?: EditableAsset; onSaved?(id: string): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AssetFormState>(() => (asset ? formFromAsset(asset) : emptyAssetForm()));
  const [tried, setTried] = useState(false);
  /** The asset id and revision the draft was taken from; a later refetch must not change what is submitted. */
  const [base, setBase] = useState<{ id: string; serverSeq: number } | null>(() => (asset ? { id: asset.id, serverSeq: asset.serverSeq } : null));
  useEffect(() => {
    if (open) {
      setBase(asset ? { id: asset.id, serverSeq: asset.serverSeq } : null);
      setForm(asset ? formFromAsset(asset) : emptyAssetForm());
      setTried(false);
    }
    // Reset only when the sheet opens, not on every refetch of the asset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const options = useQuery({
    ...trpc.maint.assets.linkOptions.queryOptions(),
    enabled: open,
    retry: false,
    meta: INLINE_ERROR_META,
  });
  const done = (id: string) => {
    void queryClient.invalidateQueries(trpc.maint.pathFilter());
    toast.success(t("maint.saved"));
    onOpenChange(false);
    onSaved?.(id);
  };
  const onError = (e: unknown) => toast.error(t(maintErrorKey(e)));
  const create = useOnceMutation(
    trpc.maint.assets.create.mutationOptions({
      onSuccess: (r) => done(r.id),
      onError,
    }),
  );
  const update = useOnceMutation(
    trpc.maint.assets.update.mutationOptions({
      onSuccess: (r) => done(r.id),
      onError,
    }),
  );
  const busy = create.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (!assetFormValid(form) || !linkFitsKind(form.kind, form.link)) return;
    if (base)
      update.mutate({
        id: base.id,
        serverSeq: base.serverSeq,
        ...assetPayload(form),
      });
    else create.mutate(assetPayload(form));
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      dismissible={!busy}
      title={asset ? t("maint.assets.form.editTitle") : t("maint.assets.form.addTitle")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={submit}>
            {t("maint.assets.form.save")}
          </Button>
        </>
      }
    >
      {tried && !assetFormValid(form) ? (
        <p role="alert" className="m-0 mb-3 text-[14px] font-medium text-destructive">
          {t("maint.assets.form.needsCodeName")}
        </p>
      ) : null}
      <AssetFields
        form={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        options={options.data}
        optionsLoading={options.isPending && options.fetchStatus !== "idle"}
        optionsError={options.isError && !options.data}
        onRetryOptions={() => void options.refetch()}
        ownLink={asset ? linkValue(asset.linkKind, asset.linkId) : ""}
      />
    </Sheet>
  );
}
