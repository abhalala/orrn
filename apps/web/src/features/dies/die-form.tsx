/**
 * Die form (plan Task 23): code, name, the weight band in kg per 12 ft, status, notes, and the
 * measurements under Advanced in the company's length unit. Used full page for a new die and in
 * the edit sheet on a die's page. The submit button lives with the caller (page action bar or the
 * sheet footer) and targets the form by `formId`.
 *
 * Errors are inline under each field (aria-invalid + aria-describedby via Field) and announced in
 * a polite live region; a code taken by a deleted die (S16) or by another die lands on Section code.
 */
import type { LengthUnit } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc } from "@/shared/utils/trpc";

import {
  dieToDraft,
  draftToDieInput,
  EMPTY_DIE_DRAFT,
  GEOMETRY_FIELDS,
  validateDieDraft,
  type DieDraft,
  type DieDraftErrors,
  type StoredDie,
} from "./die-model";

export type DieFormProps = {
  formId: string;
  unit: LengthUnit;
  /** The die being edited; omit for a new die. */
  die?: StoredDie & { id: string };
  onSaved(id: string): void;
  onPendingChange?(pending: boolean): void;
};

type ServerError = { data?: { code?: string } | null; message?: string };

/** S16: the server's message for a code held by a soft-deleted die. */
const DELETED_CODE_MESSAGE = "A deleted die uses this code";

export function DieForm({ formId, unit, die, onSaved, onPendingChange }: DieFormProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DieDraft>(() => (die ? dieToDraft(die, unit) : EMPTY_DIE_DRAFT));
  const [errors, setErrors] = useState<DieDraftErrors>({});
  const [announce, setAnnounce] = useState("");
  const hasGeometry = GEOMETRY_FIELDS.some((f) => draft[f] !== "");
  const [advanced, setAdvanced] = useState(hasGeometry);
  const advancedId = useId();

  const onSuccess = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.die.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.die.get.queryKey({ id }) }),
    ]);
    toast.success(t("dies.form.saved"));
    onSaved(id);
  };

  const onError = (error: ServerError) => {
    const code = error.data?.code;
    if (code === "CONFLICT") {
      const key: MessageKey = error.message === DELETED_CODE_MESSAGE ? "dies.form.codeTaken" : "dies.form.duplicate";
      setErrors({ sectionCode: key });
      setAnnounce(t(key));
      focusField(formId, "sectionCode");
      return;
    }
    toast.error(code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic"));
  };

  const create = useMutation({ ...trpc.die.create.mutationOptions(), onSuccess: (r) => onSuccess(r.id), onError });
  const update = useMutation({
    ...trpc.die.update.mutationOptions(),
    onSuccess: () => onSuccess(die!.id),
    onError,
  });
  const pending = create.isPending || update.isPending;
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const set = (field: keyof DieDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateDieDraft(draft, unit);
    setErrors(found);
    const keys = Object.keys(found) as (keyof DieDraft)[];
    if (keys.length > 0) {
      setAnnounce(t("dies.form.fixErrors"));
      const first = FIELD_ORDER.find((f) => keys.includes(f)) ?? keys[0]!;
      if ((GEOMETRY_FIELDS as readonly string[]).includes(first)) setAdvanced(true);
      requestAnimationFrame(() => focusField(formId, first));
      return;
    }
    setAnnounce("");
    const input = draftToDieInput(draft, unit, die);
    if (die) update.mutate({ id: die.id, ...input });
    else create.mutate(input);
  };

  const err = (field: keyof DieDraft) => (errors[field] ? t(errors[field]!) : undefined);
  const measureHint = unit === "mm" ? t("dies.form.measureHintMm") : t("dies.form.measureHintInch");
  const unitSuffix = unit === "mm" ? t("units.mm") : t("units.inch");

  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5" aria-busy={pending || undefined}>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("dies.form.series")} error={err("series")} id={`${formId}-series`}>
          <TextInput value={draft.series} onChangeText={set("series")} autoComplete="off" autoCapitalize="characters" required />
        </Field>
        <Field label={t("dies.form.sectionCode")} error={err("sectionCode")} id={`${formId}-sectionCode`}>
          <TextInput
            value={draft.sectionCode}
            onChangeText={set("sectionCode")}
            autoComplete="off"
            className="font-mono"
            required
          />
        </Field>
      </div>
      <Field label={t("dies.form.name")} id={`${formId}-name`}>
        <TextInput value={draft.name} onChangeText={set("name")} autoComplete="off" />
      </Field>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="sr-only">{t("dies.detail.band")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label={t("dies.form.weightMin")} error={err("weightMin")} id={`${formId}-weightMin`}>
            <NumberInput value={draft.weightMin} onValueChange={set("weightMin")} suffix={t("units.kg")} required />
          </Field>
          <Field label={t("dies.form.weightMax")} error={err("weightMax")} id={`${formId}-weightMax`}>
            <NumberInput value={draft.weightMax} onValueChange={set("weightMax")} suffix={t("units.kg")} required />
          </Field>
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dies.form.rangeHint")}</p>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={`${formId}-status-label`} className="text-[14px] leading-5 font-semibold">
          {t("dies.form.status")}
        </span>
        <SegmentedControl
          label={t("dies.form.status")}
          value={draft.status}
          onChange={(status) => setDraft((d) => ({ ...d, status }))}
          options={[
            { value: "active", label: t("status.die.active") },
            { value: "archived", label: t("status.die.archived") },
          ]}
        />
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dies.form.statusHint")}</p>
      </div>

      <Field label={t("dies.form.notes")} id={`${formId}-notes`}>
        <FieldTextArea value={draft.notes} onChangeText={set("notes")} rows={3} maxLength={500} />
      </Field>

      <section className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls={advancedId}
          onClick={() => setAdvanced((v) => !v)}
          className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-input px-2 text-left text-[15px] font-semibold transition-colors duration-[var(--dur-fast)] hover:bg-accent"
        >
          <span className="flex min-w-0 flex-col">
            <span>{t("dies.form.advanced")}</span>
            <span className="text-[13px] leading-5 font-normal text-muted-foreground">{t("dies.form.advancedHint")}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className={cn("size-5 shrink-0 transition-transform duration-[var(--dur-fast)]", advanced && "rotate-180")}
          />
        </button>
        <div id={advancedId} hidden={!advanced} className="flex flex-col gap-3">
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{measureHint}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {GEOMETRY_FIELDS.map((field) => (
              <Field key={field} label={t(`dies.form.${field}`)} error={err(field)} id={`${formId}-${field}`}>
                <NumberInput value={draft[field]} onValueChange={set(field)} suffix={unitSuffix} />
              </Field>
            ))}
          </div>
        </div>
      </section>
    </form>
  );
}

const FIELD_ORDER: (keyof DieDraft)[] = [
  "series",
  "sectionCode",
  "name",
  "weightMin",
  "weightMax",
  "width",
  "thickness",
  "oblique",
  "leg",
];

function focusField(formId: string, field: keyof DieDraft) {
  document.getElementById(`${formId}-${field}`)?.focus();
}
