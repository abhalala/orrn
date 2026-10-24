import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import {
  DIE_CARD_EDITORS,
  DIE_COPY_STATUSES,
  kgPer12ftInput,
  parseKgPer12ftMilli,
  parseWholeNumber,
  type DieCopyStatus,
} from "./masters-model";
import { MasterSheet } from "./masters-ui";
import { useInvalidate, type DieCopyRow } from "./use-masters";

/**
 * Section picker (ARIA combobox) over `die.list` search: code, series and name. Server search, so
 * a catalogue of hundreds of sections is never cut short before filtering. Archived sections are
 * left out when adding copies (`activeOnly`).
 */
export function SectionPicker({
  value,
  valueLabel,
  onChange,
  placeholder,
  activeOnly = false,
}: {
  value: string | null;
  valueLabel?: string;
  onChange(id: string, label: string): void;
  placeholder: string;
  activeOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const labels = useRef(new Map<string, string>());
  return (
    <Combobox<string>
      value={value}
      valueLabel={valueLabel}
      placeholder={placeholder}
      onChange={(id) => onChange(id, labels.current.get(id) ?? "")}
      search={async (q) => {
        const res = await queryClient.fetchQuery(trpc.die.list.queryOptions({ search: q.trim() || undefined, limit: 30, offset: 0 }));
        return res.items
          .filter((d) => !activeOnly || d.status === "active")
          .map((d): ComboboxOption<string> => {
            labels.current.set(d.id, d.sectionCode);
            return { value: d.id, label: d.sectionCode, hint: [d.series, d.name].filter(Boolean).join(", ") };
          });
      }}
    />
  );
}

/**
 * Add a die copy of a section, or edit its card (die room or masters publisher, ruling RP7). The
 * code (`{section}-{n}`) comes from the server; a tier may be given once when adding, and every
 * later change goes through the die room's approval (PL-W5), so editing shows it read-only.
 */
export function DieCopySheet({
  open,
  onOpenChange,
  row,
  defaultSection,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  row?: DieCopyRow;
  /** Pre-picked section when adding from a filtered list. */
  defaultSection?: { id: string; label: string } | null;
}) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const uid = useId().replace(/:/g, "");
  const formId = `die-copy-form-${uid}`;
  const statusId = `die-copy-status-${uid}`;
  const sectionId = `die-copy-section-${uid}`;

  const [section, setSection] = useState<{ id: string; label: string } | null>(null);
  const [supplier, setSupplier] = useState("");
  const [trial, setTrial] = useState("");
  const [hardness, setHardness] = useState("");
  const [life, setLife] = useState("");
  const [ftr, setFtr] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState<DieCopyStatus>("available");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"section" | "trial" | "hardness" | "life" | "tier", string>>>({});

  const create = useMutation(trpc.dieInstance.create.mutationOptions());
  const update = useMutation(trpc.dieInstance.update.mutationOptions());
  const busy = create.isPending || update.isPending;
  // FTR and notes are on the die card only (not in the list rows).
  const detail = useQuery({ ...trpc.dieInstance.get.queryOptions({ id: row?.id ?? "" }), enabled: open && Boolean(row) });
  const card = detail.data?.instance;

  useEffect(() => {
    if (!open) return;
    setSection(row ? { id: row.sectionId, label: row.sectionCode } : (defaultSection ?? null));
    setSupplier(row?.supplier ?? "");
    setTrial(kgPer12ftInput(row?.trialKgPer12ftMilli ?? null));
    setHardness(row?.hardness ? String(row.hardness) : "");
    setLife(row?.lifeG ? String(Math.round(row.lifeG / 1000)) : "");
    setFtr("");
    setTier("");
    setStatus((row?.status as DieCopyStatus) ?? "available");
    setNotes("");
    setErrors({});
    create.reset();
    update.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  useEffect(() => {
    if (!open || !card) return;
    setFtr(card.ftr ?? "");
    setNotes(card.notes ?? "");
    // Fill once per card; a refetch must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trialP = parseKgPer12ftMilli(trial);
    const hardP = parseWholeNumber(hardness, { min: 1, max: 5_000 });
    const lifeP = parseWholeNumber(life, { min: 1, max: 100_000_000 });
    const tierP = parseWholeNumber(tier, { min: 1, max: 99 });
    const next = {
      section: !row && !section ? t("masters.dieCopies.form.sectionRequired") : undefined,
      trial: trialP.ok ? undefined : t("masters.dieCopies.form.trialInvalid"),
      hardness: hardP.ok ? undefined : t("masters.dieCopies.form.hardnessInvalid"),
      life: lifeP.ok ? undefined : t("masters.dieCopies.form.lifeInvalid"),
      tier: tierP.ok ? undefined : t("masters.dieCopies.form.tierInvalid"),
    };
    setErrors(next);
    if (next.section) return document.getElementById(sectionId)?.focus();
    if (!trialP.ok || !hardP.ok || !lifeP.ok || !tierP.ok) return;
    const fields = {
      supplier: supplier.trim() || null,
      trialKgPer12ftMilli: trialP.value,
      hardness: hardP.value,
      status,
    };
    const text = (v: string) => v.trim() || null;
    // Send FTR/notes when they changed from the card (or, before it loads, when typed).
    const changed = (v: string, was: string | null | undefined) => (card ? text(v) !== (was ?? null) : text(v) !== null);
    try {
      if (row) {
        await update.mutateAsync({
          id: row.id,
          ...fields,
          lifeG: lifeP.value === null ? null : lifeP.value * 1000,
          ...(changed(ftr, card?.ftr) ? { ftr: text(ftr) } : {}),
          ...(changed(notes, card?.notes) ? { notes: text(notes) } : {}),
        });
        toast.success(t("masters.saved", { name: row.code }));
      } else {
        const res = await create.mutateAsync({
          sectionId: section!.id,
          ...fields,
          ...(lifeP.value !== null ? { lifeG: lifeP.value * 1000 } : {}),
          ...(ftr.trim() ? { ftr: ftr.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(tierP.value !== null ? { tierRank: tierP.value } : {}),
        });
        toast.success(t("masters.dieCopies.form.added", { code: res.code }));
      }
      await invalidate.dieCopies();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("masters.dieCopies.form.editTitle", { code: row.code }) : t("masters.dieCopies.form.addTitle")}
      description={row ? t("masters.dieCopies.form.sectionFixed", { code: row.sectionCode }) : undefined}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("masters.dieCopies.form.save")}
      editors={DIE_CARD_EDITORS}
    >
      {row ? null : (
        <Field label={t("masters.dieCopies.form.section")} error={errors.section} id={sectionId}>
          <SectionPicker
            activeOnly
            value={section?.id ?? null}
            valueLabel={section?.label}
            placeholder={t("masters.dieCopies.form.sectionPlaceholder")}
            onChange={(id, label) => {
              setSection({ id, label });
              setErrors((x) => ({ ...x, section: undefined }));
            }}
          />
        </Field>
      )}
      <Field label={t("masters.dieCopies.form.supplier")}>
        <TextInput value={supplier} maxLength={200} autoComplete="off" onChangeText={setSupplier} />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("masters.dieCopies.form.trial")} hint={t("masters.dieCopies.form.trialHint")} error={errors.trial}>
          <NumberInput value={trial} onValueChange={setTrial} suffix="kg" />
        </Field>
        <Field label={t("masters.dieCopies.form.hardness")} hint={t("masters.dieCopies.form.hardnessHint")} error={errors.hardness}>
          <NumberInput value={hardness} onValueChange={setHardness} decimal={false} />
        </Field>
      </div>
      <Field label={t("masters.dieCopies.form.life")} hint={t("masters.dieCopies.form.lifeHint")} error={errors.life}>
        <NumberInput value={life} onValueChange={setLife} decimal={false} suffix="kg" />
      </Field>
      <Field label={t("masters.dieCopies.form.status")} id={statusId}>
        <NativeSelect id={statusId} value={status} onChange={(e) => setStatus(e.currentTarget.value as DieCopyStatus)}>
          {DIE_COPY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`masters.dieCopies.status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {row ? (
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken/50 px-4 py-3">
          <p className="m-0 text-[14px] font-semibold">
            {row.tierRank ? t("masters.dieCopies.tier", { rank: row.tierRank }) : t("masters.dieCopies.notRanked")}
          </p>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("masters.dieCopies.form.tierLocked")}</p>
        </div>
      ) : (
        <Field label={t("masters.dieCopies.form.tier")} hint={t("masters.dieCopies.form.tierHint")} error={errors.tier}>
          <NumberInput value={tier} onValueChange={setTier} decimal={false} />
        </Field>
      )}
      <Field label={t("masters.dieCopies.form.ftr")} hint={t("masters.dieCopies.form.ftrHint")}>
        <TextInput value={ftr} maxLength={200} autoComplete="off" onChangeText={setFtr} />
      </Field>
      <Field label={t("masters.dieCopies.form.notes")}>
        <TextInput value={notes} maxLength={500} autoComplete="off" onChangeText={setNotes} />
      </Field>
    </MasterSheet>
  );
}
