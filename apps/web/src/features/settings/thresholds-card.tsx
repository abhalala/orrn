import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { lastChangeOf } from "@/features/audit/model";
import { errorCode } from "@/features/admin/error-code";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { SwitchAudit } from "./modules-tab";
import {
  bpToPercentText,
  thresholdsDraft,
  thresholdsErrors,
  thresholdsPatch,
  type ThresholdsDraft,
  type ThresholdsField,
  type ThresholdsSaved,
} from "./model";
import { Note, type PlantSettings } from "./ui";

const ERROR_KEYS = {
  number: "settings.thresholds.errors.number",
  driftOrder: "settings.thresholds.errors.driftOrder",
  recoveryOrder: "settings.thresholds.errors.recoveryOrder",
  recoveryBoth: "settings.thresholds.errors.recoveryBoth",
} as const satisfies Record<string, MessageKey>;

/**
 * Thresholds (rank 31): the drift bands (green and amber limits), the recovery bands the press
 * report colours by, and the press balance warning. Typed in percent, stored as basis points. The
 * same rules as the server (`validateThresholds`): green below amber, 0 to 100 %. Owners and admins
 * (`settings.update`) edit; everyone else reads. Under each group, who changed it last (audit log).
 */
export function ThresholdsCard({ settings }: { settings: PlantSettings }) {
  const saved: ThresholdsSaved = { drift: settings.drift, recoveryBands: settings.recoveryBands, press: settings.press };
  // Keyed by the saved values, so a save (or another admin's) resets the form to what is stored.
  return <ThresholdsForm key={JSON.stringify(saved)} saved={saved} />;
}

function ThresholdsForm({ saved }: { saved: ThresholdsSaved }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ThresholdsDraft>(() => thresholdsDraft(saved));
  const [refused, setRefused] = useState<string | null>(null);
  const errors = thresholdsErrors(draft);
  const invalid = Object.keys(errors).length > 0;
  const patch = invalid ? {} : thresholdsPatch(draft, saved);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        setRefused(null);
        toast.success(t("settings.thresholds.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.audit.list.queryKey() });
      },
      // BAD_REQUEST carries the rule that was broken, in the server's words.
      onError: (error) => setRefused(errorCode(error) === "BAD_REQUEST" ? error.message : t("settings.thresholds.saveFailed")),
    }),
  );

  const { data: me } = useMe();
  const audit = useQuery({
    ...trpc.audit.list.queryOptions({ action: "company.settings.update", limit: 50 }),
    enabled: can(me, "audit.read"),
    meta: { inlineError: true },
  });
  const changes = audit.data?.items ?? [];
  const line = (key: string, labelOf: (v: unknown) => string) => (
    <SwitchAudit change={lastChangeOf(changes, key)} ready={audit.isSuccess} labelOf={labelOf} testId={`audit-${key}`} />
  );
  const pct = (bp: unknown, fallback: number) => `${bpToPercentText(typeof bp === "number" ? bp : fallback)} %`;
  const driftLabel = (fallback: number) => (v: unknown) => pct(v, fallback);
  const recoveryLabel = (v: unknown) =>
    v && typeof v === "object" && "greenMinBp" in v && "amberMinBp" in v
      ? t("settings.thresholds.recoveryValue", { green: pct((v as { greenMinBp: number }).greenMinBp, 0), amber: pct((v as { amberMinBp: number }).amberMinBp, 0) })
      : t("settings.thresholds.recoveryNone");
  const balanceLabel = (v: unknown) => pct(v && typeof v === "object" ? (v as { balanceWarnBp?: number }).balanceWarnBp : null, 200);

  const edit = (field: ThresholdsField, value: string) => {
    setRefused(null);
    setDraft((d) => ({ ...d, [field]: value }));
  };
  const field = (name: ThresholdsField, label: MessageKey, hint?: MessageKey) => {
    const error = errors[name];
    return (
      <Field label={t(label)} hint={hint ? t(hint) : undefined} error={error ? t(ERROR_KEYS[error]) : undefined}>
        <TextInput
          inputMode="decimal"
          autoComplete="off"
          value={draft[name]}
          className="font-mono tabular-nums"
          data-testid={`threshold-${name}`}
          onChange={(e) => edit(name, e.currentTarget.value)}
        />
      </Field>
    );
  };

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      data-testid="settings-thresholds"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || invalid || save.isPending) return;
        setRefused(null);
        save.mutate(patch);
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 text-[17px] font-semibold">{t("settings.thresholds.title")}</h2>
        <Note>{t("settings.thresholds.intro")}</Note>
      </div>
      <Can do="settings.update" fallback={<Note testId="thresholds-read-only">{t("settings.thresholds.readOnly")}</Note>}>
        {null}
      </Can>

      <Card data-testid="threshold-drift">
        <CardHeader>
          <CardTitle>{t("settings.thresholds.drift")}</CardTitle>
          <CardDescription>{t("settings.thresholds.driftHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Can
            do="settings.update"
            fallback={
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReadFact label={t("settings.thresholds.driftGreen")} value={pct(saved.drift.greenMaxBp, 800)} />
                <ReadFact label={t("settings.thresholds.driftAmber")} value={pct(saved.drift.amberMaxBp, 1000)} />
              </dl>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {field("driftGreen", "settings.thresholds.driftGreen")}
              {field("driftAmber", "settings.thresholds.driftAmber")}
            </div>
            <div className="mt-2 flex min-w-0 flex-col gap-1">
              {line("driftGreenMaxBp", driftLabel(800))}
              {line("driftAmberMaxBp", driftLabel(1000))}
            </div>
          </Can>
        </CardContent>
      </Card>

      <Card data-testid="threshold-recovery">
        <CardHeader>
          <CardTitle>{t("settings.thresholds.recovery")}</CardTitle>
          <CardDescription>{t("settings.thresholds.recoveryHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Can
            do="settings.update"
            fallback={
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReadFact label={t("settings.thresholds.recoveryGreen")} value={saved.recoveryBands ? pct(saved.recoveryBands.greenMinBp, 0) : t("settings.thresholds.recoveryNone")} />
                <ReadFact label={t("settings.thresholds.recoveryAmber")} value={saved.recoveryBands ? pct(saved.recoveryBands.amberMinBp, 0) : t("settings.thresholds.recoveryNone")} />
              </dl>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {field("recoveryGreen", "settings.thresholds.recoveryGreen")}
              {field("recoveryAmber", "settings.thresholds.recoveryAmber")}
            </div>
            <div className="mt-2">{line("recoveryBands", recoveryLabel)}</div>
          </Can>
        </CardContent>
      </Card>

      <Card data-testid="threshold-balance">
        <CardHeader>
          <CardTitle>{t("settings.thresholds.balance")}</CardTitle>
          <CardDescription>{t("settings.thresholds.balanceHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Can
            do="settings.update"
            fallback={
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReadFact label={t("settings.thresholds.balanceWarn")} value={pct(saved.press.balanceWarnBp, 200)} />
              </dl>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{field("balanceWarn", "settings.thresholds.balanceWarn")}</div>
            <div className="mt-2">{line("press", balanceLabel)}</div>
          </Can>
        </CardContent>
      </Card>

      {refused ? (
        <p role="alert" data-testid="thresholds-refused" className="m-0 text-[14px] font-medium leading-5 text-destructive break-words">
          {refused}
        </p>
      ) : null}
      <Can do="settings.update">
        <FormActions sticky={false}>
          <Button type="submit" disabled={!dirty || invalid} loading={save.isPending} data-testid="thresholds-save">
            {t("settings.thresholds.save")}
          </Button>
        </FormActions>
      </Can>
    </form>
  );
}

function ReadFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono text-[15px] break-words">{value}</dd>
    </div>
  );
}
