import { useT } from "@orrn/i18n";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { LOCATION_KINDS, locationCodeProblem, parseWholeNumber, type LocationKind } from "./masters-model";
import { MasterSheet } from "./masters-ui";
import { useInvalidate, type LocationRow } from "./use-masters";

/**
 * Add or edit a location (masters.publish): code, name, kind, position in lists; when editing,
 * retire or bring back. Retiring and changing the kind need the location empty; the server checks
 * that inside its write and the sheet says so in plain words when it refuses.
 */
export function LocationSheet({
  open,
  onOpenChange,
  location,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  location?: LocationRow;
}) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const uid = useId().replace(/:/g, "");
  const formId = `location-form-${uid}`;
  const kindId = `location-kind-${uid}`;
  const codeRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LocationKind>("yard");
  const [order, setOrder] = useState("");
  const [errors, setErrors] = useState<{ code?: string; name?: string; order?: string }>({});

  const create = useMutation(trpc.stock.locations.create.mutationOptions());
  const update = useMutation(trpc.stock.locations.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setCode(location?.code ?? "");
    setName(location?.name ?? "");
    setKind((location?.kind as LocationKind) ?? "yard");
    setOrder(location ? String(location.sortOrder) : "");
    setErrors({});
    create.reset();
    update.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, location?.id]);

  const close = () => onOpenChange(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = locationCodeProblem(code);
    const sort = parseWholeNumber(order, { min: 0, max: 10_000 });
    const next = {
      code: problem
        ? t(
            problem === "required"
              ? "masters.locations.form.codeRequired"
              : problem === "zero"
                ? "masters.locations.form.codeZero"
                : "masters.locations.form.codeInvalid",
          )
        : undefined,
      name: name.trim() ? undefined : t("masters.locations.form.nameRequired"),
      order: sort.ok ? undefined : t("masters.orderInvalid"),
    };
    setErrors(next);
    if (next.code) return codeRef.current?.focus();
    if (next.name) return nameRef.current?.focus();
    if (next.order || !sort.ok) return;
    const finalCode = code.trim().toUpperCase();
    try {
      if (location) {
        await update.mutateAsync({
          id: location.id,
          ...(finalCode !== location.code ? { code: finalCode } : {}),
          ...(name.trim() !== location.name ? { name: name.trim() } : {}),
          ...(kind !== location.kind ? { kind } : {}),
          ...(sort.value !== null && sort.value !== location.sortOrder ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.saved", { name: finalCode }));
      } else {
        await create.mutateAsync({
          code: finalCode,
          name: name.trim(),
          kind,
          ...(sort.value !== null ? { sortOrder: sort.value } : {}),
        });
        toast.success(t("masters.added", { name: finalCode }));
      }
      await invalidate.locations();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!location || busy) return;
    try {
      await update.mutateAsync({ id: location.id, active: !location.active });
      toast.success(t(location.active ? "masters.retired" : "masters.restored", { name: location.code }));
      await invalidate.locations();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={location ? t("masters.locations.form.editTitle", { code: location.code }) : t("masters.locations.form.addTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("masters.locations.form.save")}
      editors="masters.publish"
      retire={
        location
          ? {
              active: location.active,
              hint: t("masters.locations.form.retireHint"),
              retireLabel: t("masters.locations.form.retire"),
              onToggle: () => void toggle(),
            }
          : undefined
      }
    >
      <Field label={t("masters.locations.form.code")} hint={t("masters.locations.form.codeHint")} error={errors.code}>
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
      <Field label={t("masters.locations.form.name")} error={errors.name}>
        <TextInput
          ref={nameRef}
          value={name}
          maxLength={100}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setName(v);
            if (errors.name && v.trim()) setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
      </Field>
      <Field label={t("masters.locations.form.kind")} hint={t("masters.locations.form.kindHint")} id={kindId}>
        <NativeSelect
          id={kindId}
          aria-describedby={`${kindId}-hint`}
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as LocationKind)}
        >
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`masters.locations.kind.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("masters.order")} hint={t("masters.orderHint")} error={errors.order}>
        <NumberInput value={order} onValueChange={setOrder} decimal={false} />
      </Field>
    </MasterSheet>
  );
}
