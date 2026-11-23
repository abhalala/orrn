import { METAL_SOURCES, type MetalSource } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CustomerField, DieField, type Picked } from "@/features/orders/components/pickers";
import { MasterSheet } from "@/features/masters/masters-ui";
import { serverRefusal } from "@/features/shared/server-refusal";
import { useFmt } from "@/shared/lib/fmt";
import { rateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import {
  buildPropose,
  lmePreview,
  type FormErrorField,
  type MasterKind,
  type RateForm,
} from "./rate-model";
import { FieldSelect } from "./ui";

export type RateSheetState = {
  form: RateForm;
  /** The row's own name when "Change rate" opened it: the key is then fixed and its boxes are not shown. */
  lockedName: string | null;
  dieLabel: string;
  customerLabel: string;
};

/**
 * Add a rate or change one (`pricing.rates.propose`, price.manage). Always says a change waits for a manager.
 * The London metal form shows the rate per kg as the three numbers are typed, with the server's formula.
 */
export function RateSheet({ open, onOpenChange, state }: { open: boolean; onOpenChange(open: boolean): void; state: RateSheetState | null }) {
  const { t } = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const formId = `rate-form-${useId().replace(/:/g, "")}`;
  const [form, setForm] = useState<RateForm | null>(state?.form ?? null);
  const [die, setDie] = useState<Picked | null>(null);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [tried, setTried] = useState(false);

  const propose = useMutation(
    trpc.pricing.rates.propose.mutationOptions({
      onSuccess: async () => {
        toast.success(t("price.form.sent"));
        await queryClient.invalidateQueries(trpc.pricing.pathFilter());
        await queryClient.invalidateQueries(trpc.approval.pathFilter());
        onOpenChange(false);
      },
    }),
  );

  useEffect(() => {
    if (!open || !state) return;
    setForm(state.form);
    setDie(state.form.sectionId ? { id: state.form.sectionId, label: state.dieLabel } : null);
    setCustomer(state.form.customerId ? { id: state.form.customerId, label: state.customerLabel } : null);
    setTried(false);
    propose.reset();
    // Only when the sheet opens on a row; the mutation object is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  if (!form || !state) return null;
  const patch = (next: Partial<RateForm>) => setForm((f) => (f ? { ...f, ...next } : f));
  const built = buildPropose(form);
  const err = (field: FormErrorField): string | undefined => (tried && !built.ok && built.errors[field] ? t(`price.form.errors.${field}`) : undefined);
  const kind: MasterKind = form.kind;
  const locked = state.lockedName !== null;
  const what = state.lockedName ?? t(`price.master.kinds.${kind}.title`);
  const preview = kind === "metal" && form.metalSource === "lme" ? lmePreview(form.lme) : null;

  const rateLabel =
    kind === "component"
      ? t("price.form.rateAddon")
      : kind === "customer" && form.mode === "discount"
        ? t("price.form.rateDiscount")
        : kind === "customer" && form.mode === "fixed"
          ? t("price.form.rateFixed")
          : t("price.form.rate");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (propose.isPending) return;
    setTried(true);
    if (!built.ok) return;
    propose.mutate(built.input);
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(locked ? "price.form.changeTitle" : "price.form.addTitle", { what })}
      description={t("price.form.intro")}
      formId={formId}
      onSubmit={submit}
      busy={propose.isPending}
      error={undefined}
      saveLabel={t("price.form.submit")}
      editors="price.manage"
    >
      {kind === "metal" && !locked ? (
        <Field label={t("price.form.source")}>
          <FieldSelect value={form.metalSource} onChange={(e) => patch({ metalSource: e.currentTarget.value as MetalSource })}>
            {METAL_SOURCES.map((m) => (
              <option key={m} value={m}>
                {t(`price.master.settings.metalOptions.${m}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : null}

      {kind === "metal" && form.metalSource === "lme" ? (
        <>
          <Field label={t("price.form.lmeUsd")} error={err("lme")}>
            <TextInput value={form.lme.usd} inputMode="decimal" autoComplete="off" onChangeText={(v) => patch({ lme: { ...form.lme, usd: v } })} />
          </Field>
          <Field label={t("price.form.lmeInr")}>
            <TextInput value={form.lme.inr} inputMode="decimal" autoComplete="off" onChangeText={(v) => patch({ lme: { ...form.lme, inr: v } })} />
          </Field>
          <Field label={t("price.form.lmePremium")} hint={t("price.form.lmePremiumHint")}>
            <TextInput value={form.lme.premium} inputMode="decimal" autoComplete="off" onChangeText={(v) => patch({ lme: { ...form.lme, premium: v } })} />
          </Field>
          <p role="status" data-testid="lme-preview" className="m-0 rounded-input bg-surface-sunken px-3 py-2 text-[15px] font-semibold tabular-nums">
            {preview ? t("price.form.lmePreview", { rate: rateText(fmt, preview.paisePerKg) }) : t("price.form.lmeWaiting")}
          </p>
        </>
      ) : null}

      {kind === "conversion" && !locked ? (
        <>
          <Field label={t("price.form.scope")}>
            <FieldSelect value={form.scope} onChange={(e) => patch({ scope: e.currentTarget.value as RateForm["scope"] })}>
              {(["default", "series", "die"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`price.form.scopes.${s}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          {form.scope === "series" ? (
            <Field label={t("price.form.series")} error={err("series")}>
              <TextInput value={form.series} maxLength={60} autoComplete="off" onChangeText={(v) => patch({ series: v })} />
            </Field>
          ) : null}
          {form.scope === "die" ? (
            <DieField
              value={die}
              error={err("die")}
              onChange={(next) => {
                setDie(next);
                patch({ sectionId: next.id });
              }}
            />
          ) : null}
        </>
      ) : null}

      {kind === "alloy" && !locked ? (
        <Field label={t("price.form.alloy")} error={err("alloy")}>
          <TextInput value={form.alloy} maxLength={16} autoComplete="off" onChangeText={(v) => patch({ alloy: v })} />
        </Field>
      ) : null}

      {kind === "finish" && !locked ? (
        <Field label={t("price.form.finish")} error={err("finish")}>
          <TextInput value={form.finish} maxLength={40} autoComplete="off" onChangeText={(v) => patch({ finish: v })} />
        </Field>
      ) : null}

      {kind === "component" && !locked ? (
        <>
          <Field label={t("price.form.label")} error={err("label")}>
            <TextInput value={form.label} maxLength={60} autoComplete="off" onChangeText={(v) => patch({ label: v })} />
          </Field>
          <Field label={t("price.form.basis")}>
            <FieldSelect value={form.basis} onChange={(e) => patch({ basis: e.currentTarget.value as RateForm["basis"] })}>
              {(["piece", "order"] as const).map((b) => (
                <option key={b} value={b}>
                  {t(`price.form.bases.${b}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
        </>
      ) : null}
      {kind === "component" ? (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" checked={form.always} onChange={(e) => patch({ always: e.currentTarget.checked })} className="size-5 accent-[var(--color-foreground)]" />
          <span>{t("price.form.always")}</span>
        </label>
      ) : null}

      {kind === "customer" && !locked ? (
        <>
          <CustomerField
            value={customer}
            error={err("customer")}
            onChange={(next) => {
              setCustomer(next);
              patch({ customerId: next.id });
            }}
          />
          <Field label={t("price.form.mode")}>
            <FieldSelect value={form.mode} onChange={(e) => patch({ mode: e.currentTarget.value as RateForm["mode"] })}>
              {(["conversion", "discount", "fixed"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`price.form.modes.${m}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
        </>
      ) : null}

      {!(kind === "metal" && form.metalSource === "lme") ? (
        <Field label={rateLabel} error={err("rate")}>
          <TextInput value={form.rate} inputMode="decimal" autoComplete="off" aria-required="true" onChangeText={(v) => patch({ rate: v })} />
        </Field>
      ) : null}

      <Field label={t("price.form.effective")} hint={t("price.form.effectiveHint")} error={err("date")}>
        <TextInput type="date" value={form.effectiveFrom} onChange={(e) => patch({ effectiveFrom: e.currentTarget.value })} className="max-w-[14rem]" />
      </Field>
      <Field label={t("price.form.reason")} hint={t("price.form.reasonHint")} error={err("reason")} required>
        <TextInput value={form.reason} maxLength={300} autoComplete="off" onChangeText={(v) => patch({ reason: v })} />
      </Field>

      {propose.error ? (
        <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
          {serverRefusal(t, propose.error)}
        </p>
      ) : null}
    </MasterSheet>
  );
}
