import { useT } from "@orrn/i18n";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import {
  bpToPercentInput,
  gradeCodeProblem,
  nameKey,
  parsePercentBp,
  parseWholeNumber,
  STREAM_KINDS,
  streamCodeProblem,
  type StreamKind,
} from "./masters-model";
import { MasterSheet } from "./masters-ui";
import { useInvalidate, type ScrapGradeRow, type ScrapItemRow, type StreamRow } from "./use-masters";

type SheetProps<T> = { open: boolean; onOpenChange(open: boolean): void; row?: T };

/** Expected recovery and list position: shared by scrap items and grades. */
function useRecoveryAndOrder(open: boolean, row?: { id: string; expectedRecoveryBp: number | null; sortOrder: number }) {
  const [recovery, setRecovery] = useState("");
  const [order, setOrder] = useState("");
  useEffect(() => {
    if (!open) return;
    setRecovery(bpToPercentInput(row?.expectedRecoveryBp ?? null));
    setOrder(row ? String(row.sortOrder) : "");
    // Reset only when the sheet opens (a background refetch must not wipe what is typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);
  return { recovery, setRecovery, order, setOrder };
}

/** Add or edit a scrap item (masters.publish): name, expected recovery, list position; retire. */
export function ScrapItemSheet({ open, onOpenChange, row }: SheetProps<ScrapItemRow>) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const formId = `scrap-item-form-${useId().replace(/:/g, "")}`;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ name?: string; recovery?: string; order?: string }>({});
  const fields = useRecoveryAndOrder(open, row);
  const create = useMutation(trpc.purchase.scrapItems.create.mutationOptions());
  const update = useMutation(trpc.purchase.scrapItems.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(row?.name ?? "");
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const recovery = parsePercentBp(fields.recovery);
    const sort = parseWholeNumber(fields.order, { min: 0, max: 10_000 });
    const next = {
      name: nameKey(name) ? undefined : t("masters.errors.nameRequired"),
      recovery: recovery.ok ? undefined : t("masters.scrap.form.recoveryInvalid"),
      order: sort.ok ? undefined : t("masters.orderInvalid"),
    };
    setErrors(next);
    if (next.name) return nameRef.current?.focus();
    if (!recovery.ok || !sort.ok) return;
    const trimmed = name.trim();
    try {
      if (row) {
        await update.mutateAsync({
          id: row.id,
          ...(trimmed !== row.name ? { name: trimmed } : {}),
          ...(recovery.value !== row.expectedRecoveryBp ? { expectedRecoveryBp: recovery.value } : {}),
          ...(sort.value !== null && sort.value !== row.sortOrder ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.saved", { name: trimmed }));
      } else {
        await create.mutateAsync({
          name: trimmed,
          expectedRecoveryBp: recovery.value,
          ...(sort.value !== null ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.added", { name: trimmed }));
      }
      await invalidate.scrap();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await update.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.name }));
      await invalidate.scrap();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("masters.scrap.form.itemEditTitle") : t("masters.scrap.form.itemAddTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("masters.scrap.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("masters.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      <Field label={t("masters.scrap.form.name")} hint={t("masters.scrap.form.nameHint")} error={errors.name}>
        <TextInput
          ref={nameRef}
          value={name}
          maxLength={80}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setName(v);
            if (errors.name && nameKey(v)) setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
      </Field>
      <RecoveryAndOrderFields fields={fields} errors={errors} />
    </MasterSheet>
  );
}

function RecoveryAndOrderFields({
  fields,
  errors,
}: {
  fields: ReturnType<typeof useRecoveryAndOrder>;
  errors: { recovery?: string; order?: string };
}) {
  const { t } = useT();
  return (
    <>
      <Field label={t("masters.scrap.form.recovery")} hint={t("masters.scrap.form.recoveryHint")} error={errors.recovery}>
        <NumberInput value={fields.recovery} onValueChange={fields.setRecovery} suffix="%" />
      </Field>
      <Field label={t("masters.order")} hint={t("masters.orderHint")} error={errors.order}>
        <NumberInput value={fields.order} onValueChange={fields.setOrder} decimal={false} />
      </Field>
    </>
  );
}

/** Add or edit a scrap grade (masters.publish). The code is set once; lots carry it. */
export function GradeSheet({ open, onOpenChange, row }: SheetProps<ScrapGradeRow>) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const formId = `grade-form-${useId().replace(/:/g, "")}`;
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ code?: string; recovery?: string; order?: string }>({});
  const fields = useRecoveryAndOrder(open, row);
  const create = useMutation(trpc.purchase.scrapGrades.create.mutationOptions());
  const update = useMutation(trpc.purchase.scrapGrades.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const recovery = parsePercentBp(fields.recovery);
    const sort = parseWholeNumber(fields.order, { min: 0, max: 10_000 });
    const problem = row ? null : gradeCodeProblem(code);
    const next = {
      code: problem
        ? t(problem === "required" ? "masters.scrap.form.gradeCodeRequired" : "masters.scrap.form.gradeCodeInvalid")
        : undefined,
      recovery: recovery.ok ? undefined : t("masters.scrap.form.recoveryInvalid"),
      order: sort.ok ? undefined : t("masters.orderInvalid"),
    };
    setErrors(next);
    if (next.code) return codeRef.current?.focus();
    if (!recovery.ok || !sort.ok) return;
    const desc = name.trim() || null;
    try {
      if (row) {
        await update.mutateAsync({
          id: row.id,
          ...(desc !== row.name ? { name: desc } : {}),
          ...(recovery.value !== row.expectedRecoveryBp ? { expectedRecoveryBp: recovery.value } : {}),
          ...(sort.value !== null && sort.value !== row.sortOrder ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.saved", { name: row.code }));
      } else {
        const finalCode = code.trim().toUpperCase();
        await create.mutateAsync({
          code: finalCode,
          name: desc,
          expectedRecoveryBp: recovery.value,
          ...(sort.value !== null ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.added", { name: finalCode }));
      }
      await invalidate.scrap();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await update.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.code }));
      await invalidate.scrap();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("masters.scrap.form.gradeEditTitle", { code: row.code }) : t("masters.scrap.form.gradeAddTitle")}
      description={row ? t("masters.scrap.form.gradeCodeFixed") : undefined}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("masters.scrap.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("masters.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      {row ? null : (
        <Field label={t("masters.scrap.form.gradeCode")} hint={t("masters.scrap.form.gradeCodeHint")} error={errors.code}>
          <TextInput
            ref={codeRef}
            value={code}
            maxLength={8}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-required="true"
            className="font-mono uppercase"
            onChangeText={(v) => {
              setCode(v);
              if (errors.code) setErrors((x) => ({ ...x, code: undefined }));
            }}
          />
        </Field>
      )}
      <Field label={t("masters.scrap.form.gradeName")} hint={t("masters.scrap.form.gradeNameHint")}>
        <TextInput value={name} maxLength={80} autoComplete="off" onChangeText={setName} />
      </Field>
      <RecoveryAndOrderFields fields={fields} errors={errors} />
    </MasterSheet>
  );
}

/** Add or edit a return stream (masters.publish). Code and kind never change after it is added. */
export function StreamSheet({ open, onOpenChange, row }: SheetProps<StreamRow>) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const uid = useId().replace(/:/g, "");
  const formId = `stream-form-${uid}`;
  const kindId = `stream-kind-${uid}`;
  const codeRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StreamKind>("charge");
  const [order, setOrder] = useState("");
  const [errors, setErrors] = useState<{ code?: string; name?: string; order?: string }>({});
  const create = useMutation(trpc.foundry.returnStreams.create.mutationOptions());
  const update = useMutation(trpc.foundry.returnStreams.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
    setKind((row?.kind as StreamKind) ?? "charge");
    setOrder(row ? String(row.sortOrder) : "");
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = row ? null : streamCodeProblem(code);
    const sort = parseWholeNumber(order, { min: 0, max: 10_000 });
    const next = {
      code: problem
        ? t(problem === "required" ? "masters.streams.form.codeRequired" : "masters.streams.form.codeInvalid")
        : undefined,
      name: nameKey(name) ? undefined : t("masters.errors.nameRequired"),
      order: sort.ok ? undefined : t("masters.orderInvalid"),
    };
    setErrors(next);
    if (next.code) return codeRef.current?.focus();
    if (next.name) return nameRef.current?.focus();
    if (!sort.ok) return;
    const trimmed = name.trim();
    try {
      if (row) {
        await update.mutateAsync({
          id: row.id,
          ...(trimmed !== row.name ? { name: trimmed } : {}),
          ...(sort.value !== null && sort.value !== row.sortOrder ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.saved", { name: row.code }));
      } else {
        const res = await create.mutateAsync({
          code: code.trim().toUpperCase(),
          name: trimmed,
          kind,
          ...(sort.value !== null ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.added", { name: res.code }));
      }
      await invalidate.streams();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await update.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.code }));
      await invalidate.streams();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("masters.streams.form.editTitle", { code: row.code }) : t("masters.streams.form.addTitle")}
      description={row ? t("masters.streams.form.codeFixed") : undefined}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("masters.streams.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("masters.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      {row ? null : (
        <Field label={t("masters.streams.form.code")} hint={t("masters.streams.form.codeHint")} error={errors.code}>
          <TextInput
            ref={codeRef}
            value={code}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-required="true"
            className="font-mono uppercase"
            onChangeText={(v) => {
              setCode(v);
              if (errors.code) setErrors((x) => ({ ...x, code: undefined }));
            }}
          />
        </Field>
      )}
      <Field label={t("masters.streams.form.name")} error={errors.name}>
        <TextInput
          ref={nameRef}
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setName(v);
            if (errors.name && nameKey(v)) setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
      </Field>
      {row ? null : (
        <Field label={t("masters.streams.form.kind")} hint={t("masters.streams.form.kindHint")} id={kindId}>
          <NativeSelect
            id={kindId}
            aria-describedby={`${kindId}-hint`}
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as StreamKind)}
          >
            {STREAM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`masters.streams.kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field label={t("masters.order")} hint={t("masters.orderHint")} error={errors.order}>
        <NumberInput value={order} onValueChange={setOrder} decimal={false} />
      </Field>
    </MasterSheet>
  );
}
