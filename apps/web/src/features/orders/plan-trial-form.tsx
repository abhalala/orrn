/**
 * The draft of a die trial, sample or other plan on `/orders/plan` (FP-PR-23, BACKLOG 61): a die,
 * the copy meant for it (a die trial offers only copies on trial) and a planned kg / pieces. There
 * are no order lines; the choice is kept in the plan note (`plan-purpose.ts`).
 */
import { useT } from "@orrn/i18n";
import { Card } from "@orrn/ui/components/card";
import { Field, NumberInput } from "@orrn/ui/components/field";

import { CopyPicker, type PickedCopy } from "@/features/die-room/pickers";
import { SectionPicker } from "@/features/masters/die-copy-sheet";

import { copyStatusesFor, type PlanPurpose, type TrialProblems } from "./plan-purpose";

export type TrialDraft = {
  section: { id: string; label: string } | null;
  copy: PickedCopy | null;
  kgText: string;
  pcsText: string;
};

export const EMPTY_TRIAL: TrialDraft = { section: null, copy: null, kgText: "", pcsText: "" };

export function PlanTrialForm({
  purpose,
  draft,
  problems,
  onChange,
}: {
  purpose: Exclude<PlanPurpose, "production">;
  draft: TrialDraft;
  problems: TrialProblems;
  onChange(next: TrialDraft): void;
}) {
  const { t } = useT();
  return (
    <Card data-trial-form={purpose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <p className="m-0 text-[14px] leading-6 text-muted-foreground md:col-span-2">{t("orders.plan.trial.hint")}</p>
        <Field label={t("orders.plan.trial.die")}>
          <SectionPicker
            value={draft.section?.id ?? null}
            valueLabel={draft.section?.label}
            placeholder={t("orders.plan.trial.diePlaceholder")}
            activeOnly
            onChange={(id, label) => onChange({ ...draft, section: { id, label }, copy: null })}
          />
        </Field>
        {draft.section ? (
          <CopyPicker
            // A new die or purpose starts the copy search again.
            key={`${draft.section.id}:${purpose}`}
            label={t("orders.plan.trial.copy")}
            value={draft.copy?.id ?? null}
            valueLabel={draft.copy?.code}
            statuses={copyStatusesFor(purpose)}
            sectionId={draft.section.id}
            placeholder={t("orders.plan.trial.copyPlaceholder")}
            onChange={(copy) => onChange({ ...draft, copy })}
          />
        ) : (
          <div />
        )}
        <Field label={t("orders.plan.trial.kg")} error={problems.kg ? t("orders.plan.trial.badKg") : undefined}>
          <NumberInput value={draft.kgText} onValueChange={(v) => onChange({ ...draft, kgText: v })} suffix={t("units.kg")} />
        </Field>
        <Field label={t("orders.plan.trial.pcs")} error={problems.pcs ? t("orders.plan.trial.badPcs") : undefined} hint={t("orders.plan.trial.qtyHint")}>
          <NumberInput value={draft.pcsText} onValueChange={(v) => onChange({ ...draft, pcsText: v })} decimal={false} />
        </Field>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground md:col-span-2">
          {purpose === "die_trial" ? t("orders.plan.trial.copyHintTrial") : t("orders.plan.trial.copyHint")}
        </p>
      </div>
    </Card>
  );
}
