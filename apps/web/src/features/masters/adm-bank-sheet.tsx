import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { bankPayload, bankProblems, EMPTY_BANK, type BankForm, type BankProblems } from "./adm-model";
import { AdmSheet } from "./adm-ui";
import { useAdmInvalidate, type BankRow } from "./adm-use";

/**
 * Add or edit a bank account (masters.publish): the account the plant asks customers to pay into.
 * When editing: make it the default, retire it or bring it back. The first live account is the default.
 */
export function BankSheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(open: boolean): void; row?: BankRow }) {
  const { t } = useT();
  const invalidate = useAdmInvalidate();
  const formId = `bank-form-${useId().replace(/:/g, "")}`;
  const [form, setForm] = useState<BankForm>(EMPTY_BANK);
  const [problems, setProblems] = useState<BankProblems>({});

  const create = useMutation(trpc.masters.bank.create.mutationOptions());
  const update = useMutation(trpc.masters.bank.update.mutationOptions());
  const setDefault = useMutation(trpc.masters.bank.setDefault.mutationOptions());
  const setActive = useMutation(trpc.masters.bank.setActive.mutationOptions());
  const busy = create.isPending || update.isPending || setDefault.isPending || setActive.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(
      row
        ? { bankName: row.bankName, branch: row.branch ?? "", accountName: row.accountName, accountNo: row.accountNo, ifsc: row.ifsc, note: row.note ?? "", makeDefault: row.isDefault }
        : EMPTY_BANK,
    );
    setProblems({});
    create.reset();
    update.reset();
    setDefault.reset();
    setActive.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const set = (patch: Partial<BankForm>) => setForm((f) => ({ ...f, ...patch }));
  const close = () => onOpenChange(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = bankProblems(form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const payload = bankPayload(form);
    try {
      if (row) {
        await update.mutateAsync({ id: row.id, ...payload });
        toast.success(t("masters.saved", { name: payload.bankName }));
      } else {
        await create.mutateAsync({ ...payload, makeDefault: form.makeDefault });
        toast.success(t("masters.added", { name: payload.bankName }));
      }
      await invalidate.bank();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const makeDefault = async () => {
    if (!row || busy) return;
    try {
      await setDefault.mutateAsync({ id: row.id });
      toast.success(t("adm.masters.bank.nowDefault", { name: row.bankName }));
      await invalidate.bank();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await setActive.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.bankName }));
      await invalidate.bank();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <AdmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("adm.masters.bank.form.editTitle", { name: row.bankName }) : t("adm.masters.bank.form.addTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error ?? setDefault.error ?? setActive.error}
      saveLabel={t("adm.masters.bank.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("adm.masters.bank.form.retireHint"), retireLabel: t("adm.masters.bank.form.retire"), onToggle: () => void toggle() } : undefined}
    >
      <Field label={t("adm.masters.bank.form.bankName")} error={problems.bankName ? t(problems.bankName) : undefined}>
        <TextInput value={form.bankName} maxLength={80} autoComplete="off" aria-required="true" onChangeText={(v) => set({ bankName: v })} />
      </Field>
      <Field label={t("adm.masters.bank.form.branch")}>
        <TextInput value={form.branch} maxLength={80} autoComplete="off" onChangeText={(v) => set({ branch: v })} />
      </Field>
      <Field label={t("adm.masters.bank.form.accountName")} hint={t("adm.masters.bank.form.accountNameHint")} error={problems.accountName ? t(problems.accountName) : undefined}>
        <TextInput value={form.accountName} maxLength={120} autoComplete="off" aria-required="true" onChangeText={(v) => set({ accountName: v })} />
      </Field>
      <Field label={t("adm.masters.bank.form.accountNo")} error={problems.accountNo ? t(problems.accountNo) : undefined}>
        <TextInput
          value={form.accountNo}
          maxLength={30}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-required="true"
          className="font-mono"
          onChangeText={(v) => set({ accountNo: v })}
        />
      </Field>
      <Field label={t("adm.masters.bank.form.ifsc")} hint={t("adm.masters.bank.form.ifscHint")} error={problems.ifsc ? t(problems.ifsc) : undefined}>
        <TextInput
          value={form.ifsc}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-required="true"
          className="font-mono uppercase"
          onChangeText={(v) => set({ ifsc: v })}
        />
      </Field>
      <Field label={t("adm.masters.bank.form.note")} hint={t("adm.masters.bank.form.noteHint")}>
        <TextInput value={form.note} maxLength={120} autoComplete="off" onChangeText={(v) => set({ note: v })} />
      </Field>
      {row ? (
        row.active && !row.isDefault ? (
          <Can do="masters.publish">
            <div className="flex flex-col items-start gap-2">
              <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("adm.masters.bank.form.defaultHint")}</p>
              <Button variant="secondary" onClick={() => void makeDefault()} disabled={busy}>
                {t("adm.masters.bank.form.makeDefault")}
              </Button>
            </div>
          </Can>
        ) : null
      ) : (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" checked={form.makeDefault} onChange={(e) => set({ makeDefault: e.currentTarget.checked })} className="size-5 accent-[var(--color-foreground)]" />
          <span>{t("adm.masters.bank.form.makeDefault")}</span>
        </label>
      )}
    </AdmSheet>
  );
}
