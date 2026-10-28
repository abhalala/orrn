import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { useCommandError } from "./printers-actions";
import {
  MEDIA_TYPES,
  PRINTER_DPIS,
  parsePreferences,
  type PreferencesDraft,
  type PreferencesField,
  type PrinterDpi,
} from "./printers-model";

const FIELD_ERROR: Record<PreferencesField, MessageKey> = {
  mediaWidthMm: "printing.printers.settings.invalid.size",
  mediaHeightMm: "printing.printers.settings.invalid.size",
  gapMm: "printing.printers.settings.invalid.gap",
  speedInSec: "printing.printers.settings.invalid.speed",
  density: "printing.printers.settings.invalid.density",
};

/**
 * One printer's settings (`spool.updatePrinterPreferences`): label stock, size, gap, resolution, speed,
 * darkness and the cutter. Saved settings go to the print computer as its next configuration.
 */
export function PrinterSettingsSheet({
  profile,
  initial,
  onClose,
}: {
  profile: { id: string; name: string };
  initial: PreferencesDraft;
  onClose(): void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const commandError = useCommandError();
  const formId = useId();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<PreferencesField, true>>>({});
  const [refused, setRefused] = useState<string | null>(null);
  const save = useMutation(
    trpc.spool.updatePrinterPreferences.mutationOptions({
      onSuccess: () => {
        toast.success(t("printing.printers.settings.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.spool.listProfiles.queryKey() });
        onClose();
      },
      onError: (error) => setRefused(commandError(error)),
    }),
  );

  const set = <K extends keyof PreferencesDraft>(key: K, value: PreferencesDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setRefused(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parsePreferences(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    save.mutate({ profileId: profile.id, ...parsed.input });
  };

  const errorFor = (field: PreferencesField) => (errors[field] ? t(FIELD_ERROR[field]) : undefined);
  const mm = t("units.mm");

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      dismissible={!save.isPending}
      title={t("printing.printers.settings.title", { name: profile.name })}
      description={t("printing.printers.settings.body")}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} data-testid="printer-settings-save">
            {t("printing.printers.settings.save")}
          </Button>
        </FormActions>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5" data-testid="printer-settings">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 text-[14px] leading-5 font-semibold">{t("printing.printers.settings.media")}</p>
          <SegmentedControl
            label={t("printing.printers.settings.media")}
            value={draft.mediaType}
            options={MEDIA_TYPES.map((value) => ({ value, label: t(`printing.printers.settings.mediaType.${value}`) }))}
            onChange={(value) => set("mediaType", value)}
            className="w-full"
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <Field label={t("printing.printers.settings.width")} error={errorFor("mediaWidthMm")}>
            <NumberInput value={draft.mediaWidthMm} onValueChange={(v) => set("mediaWidthMm", v)} suffix={mm} />
          </Field>
          <Field label={t("printing.printers.settings.height")} error={errorFor("mediaHeightMm")}>
            <NumberInput value={draft.mediaHeightMm} onValueChange={(v) => set("mediaHeightMm", v)} suffix={mm} />
          </Field>
          <Field label={t("printing.printers.settings.gap")} hint={t("printing.printers.settings.gapHint")} error={errorFor("gapMm")}>
            <NumberInput value={draft.gapMm} onValueChange={(v) => set("gapMm", v)} suffix={mm} />
          </Field>
          <Field label={t("printing.printers.settings.dpi")}>
            <NativeSelect value={String(draft.dpi)} onChange={(e) => set("dpi", Number(e.currentTarget.value) as PrinterDpi)}>
              {PRINTER_DPIS.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {t("printing.printers.settings.dpiValue", { dpi })}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("printing.printers.settings.speed")} hint={t("printing.printers.settings.speedHint")} error={errorFor("speedInSec")}>
            <NumberInput value={draft.speedInSec} onValueChange={(v) => set("speedInSec", v)} decimal={false} />
          </Field>
          <Field label={t("printing.printers.settings.density")} hint={t("printing.printers.settings.densityHint")} error={errorFor("density")}>
            <NumberInput value={draft.density} onValueChange={(v) => set("density", v)} decimal={false} />
          </Field>
        </div>
        <CutterSwitch on={draft.cutterEnabled} onToggle={() => set("cutterEnabled", !draft.cutterEnabled)} />
        {refused ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {refused}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function CutterSwitch({ on, onToggle }: { on: boolean; onToggle(): void }) {
  const { t } = useT();
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-input border border-border p-4">
      <div className="min-w-0 flex-1 basis-48">
        <p id={labelId} className="m-0 text-[14px] leading-5 font-semibold">
          {t("printing.printers.settings.cutter")}
        </p>
        <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
          {t("printing.printers.settings.cutterHint")}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onClick={onToggle}
        data-testid="printer-settings-cutter"
        className={cn(
          "inline-flex h-11 min-w-[88px] shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition-colors duration-[var(--dur-fast)]",
          on ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface-sunken",
        )}
      >
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", on ? "bg-primary-foreground" : "bg-muted-foreground")} />
        {on ? t("printing.printers.settings.on") : t("printing.printers.settings.off")}
      </button>
    </div>
  );
}
