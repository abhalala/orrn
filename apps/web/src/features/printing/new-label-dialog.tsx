import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { trpc } from "@/shared/utils/trpc";

import { LabelPreview } from "./label-artwork";
import { designNameProblem, LABEL_STARTERS, labelSize, NAME_MAX, uniqueDesignName, type StarterId } from "./label-library";
import type { LabelValues } from "./label-metrics";

const NAME_ERRORS = { required: "printing.library.nameRequired", tooLong: "printing.library.nameTooLong", taken: "printing.library.nameTaken" } as const;

/** Thumbnail well height in px, less its padding: every starter fits inside it at its own aspect. */
const THUMB_PX = 80;

/**
 * New label: a name and a starting design (the built-ins, the web starters, or blank). Creates the
 * draft through `spool.labelDocuments.createDraft` and opens it in the studio. The name follows the
 * picked starter until the person types their own.
 */
export function NewLabelDialog({
  open,
  onOpenChange,
  takenNames,
  values,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  takenNames: readonly string[];
  values: LabelValues;
}) {
  const { t } = useT();
  const formId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const starterName = (id: StarterId) => uniqueDesignName(t(`printing.library.starters.${id}.name`), takenNames);
  const [starter, setStarter] = useState<StarterId>(LABEL_STARTERS[0]!.id);
  const [name, setName] = useState(() => starterName(LABEL_STARTERS[0]!.id));
  const [nameTouched, setNameTouched] = useState(false);
  const [showNameError, setShowNameError] = useState(false);

  const create = useMutation(
    trpc.spool.labelDocuments.createDraft.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: trpc.spool.labelDocuments.list.queryKey() });
        onOpenChange(false);
        void navigate({ to: "/printing/templates/$templateId", params: { templateId: created.id } });
      },
    }),
  );

  const problem = designNameProblem(name, takenNames);
  const nameError = showNameError && problem ? t(NAME_ERRORS[problem]) : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem) {
      setShowNameError(true);
      return;
    }
    const document = LABEL_STARTERS.find((entry) => entry.id === starter)!.document;
    create.mutate({ name: name.trim(), document });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("printing.library.newTitle")}
      description={t("printing.library.newBody")}
      maxWidth={780}
      actions={
        <>
          <DialogCloseButton onPress={() => onOpenChange(false)} />
          <Button type="submit" form={formId} loading={create.isPending}>
            {t("printing.library.create")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
        <Field label={t("printing.library.name")} hint={t("printing.library.nameHint")} error={nameError} className="sm:max-w-sm">
          <TextInput
            value={name}
            maxLength={NAME_MAX + 1}
            autoComplete="off"
            data-testid="new-label-name"
            onChangeText={(next) => {
              setName(next);
              setNameTouched(true);
            }}
            onBlur={() => setShowNameError(true)}
          />
        </Field>

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] font-semibold leading-5">{t("printing.library.startFrom")}</legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {LABEL_STARTERS.map(({ id, document }) => {
              const { widthMm, heightMm } = document.page;
              return (
                <label
                  key={id}
                  data-testid={`starter-${id}`}
                  className="group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-card border border-border bg-card p-2.5 transition-colors hover:bg-surface-sunken has-[:checked]:border-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                >
                  <input
                    type="radio"
                    name="starter"
                    value={id}
                    checked={starter === id}
                    onChange={() => {
                      setStarter(id);
                      if (!nameTouched) setName(starterName(id));
                    }}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="flex h-24 items-center justify-center rounded-[10px] bg-surface-sunken p-2">
                    <span className="block" style={{ width: `min(100%, ${(THUMB_PX * widthMm) / heightMm}px)` }}>
                      <LabelPreview document={document} values={values} title={t(`printing.library.starters.${id}.name`)} />
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-full bg-primary text-primary-foreground group-has-[:checked]:flex"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span className="text-[14px] font-semibold leading-tight break-words">{t(`printing.library.starters.${id}.name`)}</span>
                  <span className="text-[12px] leading-4 text-muted-foreground">{t(`printing.library.starters.${id}.note`)}</span>
                  <span className="font-mono text-[11px] tabular-nums leading-4 text-muted-foreground">{labelSize(document)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {create.isError ? (
          <p role="alert" className="m-0 flex items-start gap-1.5 text-[14px] font-medium leading-5 text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>{t("printing.library.createFailed", { message: create.error.message })}</span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
