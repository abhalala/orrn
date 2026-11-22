import { COMPANY_ROLES, useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { UnitField } from "@/shared/components/unit-field";
import { useFmt } from "@/shared/lib/fmt";
import { sectionText, sectionUnit } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { draftFromRule, limitPercentText, matchesBuiltIn, parseLimitPercent, pickableRoles, ruleInput, ruleProblem, toggleRole, type RuleDraft } from "./adm-model";
import { AdmSheet } from "./adm-ui";
import { useAdmAccess, useAdmInvalidate, type ApprovalRuleRow } from "./adm-use";
import { MasterNote, MastersLoadError, RowEdit } from "./masters-ui";

/** Approvals (admin and owner): who may decide each kind of request, and a limit above which others decide. */
export function ApprovalRulesPanel() {
  const { t } = useT();
  const fmt = useFmt();
  const access = useAdmAccess();
  const query = useQuery(trpc.masters.approvalRules.get.queryOptions());
  const [sheet, setSheet] = useState<ApprovalRuleRow | null>(null);

  const kindName = (k: string) => {
    const key = `approvals.kind.${k}`;
    const text = t(key as never);
    return text === key ? k : text;
  };
  const roleList = (roles: readonly string[]) => [...new Set(["owner", ...roles])].map((r) => t(`roles.${r}` as never)).join(", ");
  const limitText = (row: ApprovalRuleRow, value: number) => (row.measure === "bp" ? `${limitPercentText(value)}%` : `${sectionText(fmt, value)} ${sectionUnit(fmt)}`);

  const columns: ResponsiveListColumn<ApprovalRuleRow>[] = [
    {
      key: "kind",
      header: t("adm.masters.rules.approvals.columns.kind"),
      cell: (r) => (
        <RowEdit editable={access.canRules} label={kindName(r.kind)} onEdit={() => setSheet(r)}>
          {kindName(r.kind)}
        </RowEdit>
      ),
    },
    {
      key: "who",
      header: t("adm.masters.rules.approvals.columns.who"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5 break-words">
          <span>{roleList(r.rule?.roles ?? r.builtIn)}</span>
          {r.rule?.above ? (
            <span className="text-[13px] text-muted-foreground">
              {t("adm.masters.rules.approvals.aboveLine", { limit: limitText(r, r.rule.above.value), roles: roleList(r.rule.above.roles) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "source",
      header: t("adm.masters.rules.formats.columns.source"),
      cell: (r) => (r.rule ? <Chip tone="blue">{t("adm.masters.rules.formats.custom")}</Chip> : <span className="text-[14px] text-muted-foreground">{t("adm.masters.rules.formats.builtIn")}</span>),
    },
  ];

  if (query.isError && !query.data) return <MastersLoadError onRetry={() => void query.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MasterNote body={access.canRules ? t("adm.masters.rules.approvals.note") : t("adm.masters.rules.approvals.readOnly")} />
      <ResponsiveList
        rows={query.data ?? []}
        columns={columns}
        rowKey={(r) => r.kind}
        loading={query.isLoading}
        label={t("adm.masters.rules.tabs.approvals")}
        empty={<EmptyState title={t("adm.masters.rules.approvals.empty")} />}
      />
      <RuleSheet row={sheet} kindName={kindName} onOpenChange={(open) => !open && setSheet(null)} />
    </div>
  );
}

function RoleChecks({ idPrefix, label, roles, onChange }: { idPrefix: string; label: string; roles: string[]; onChange(next: string[]): void }) {
  const { t } = useT();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-[14px] font-semibold">{label}</legend>
      <label className="flex min-h-11 items-center gap-3 text-[15px] text-muted-foreground">
        <input type="checkbox" checked disabled className="size-5 accent-[var(--color-foreground)]" />
        <span>{t("adm.masters.rules.approvals.ownerAlways")}</span>
      </label>
      {pickableRoles(COMPANY_ROLES).map((role) => (
        <label key={role} htmlFor={`${idPrefix}-${role}`} className="flex min-h-11 items-center gap-3 text-[15px]">
          <input
            id={`${idPrefix}-${role}`}
            type="checkbox"
            checked={roles.includes(role)}
            onChange={() => onChange(toggleRole(roles, role))}
            className="size-5 accent-[var(--color-foreground)]"
          />
          <span>{t(`roles.${role}` as never)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function RuleSheet({ row, kindName, onOpenChange }: { row: ApprovalRuleRow | null; kindName(k: string): string; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const invalidate = useAdmInvalidate();
  const uid = useId().replace(/:/g, "");
  const set = useMutation(trpc.masters.approvalRules.set.mutationOptions());
  const [draft, setDraft] = useState<RuleDraft>({ roles: [], above: null });
  const [limitText, setLimitText] = useState("");
  const [limitBad, setLimitBad] = useState(false);
  const [tried, setTried] = useState(false);
  const [last, setLast] = useState<ApprovalRuleRow | null>(null);
  const shown = row ?? last;

  useEffect(() => {
    if (!row) return;
    setLast(row);
    const d = draftFromRule(row.rule, row.builtIn);
    setDraft(d);
    setLimitText(row.measure === "bp" && d.above?.value != null ? limitPercentText(d.above.value) : "");
    setLimitBad(false);
    setTried(false);
    set.reset();
    // Only when a different row opens; the mutation is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.kind]);

  const name = shown ? kindName(shown.kind) : "";
  const above = draft.above;

  const save = async (rule: ReturnType<typeof ruleInput> | null) => {
    const payload = rule as never;
    if (!shown || set.isPending) return;
    try {
      await set.mutateAsync({ kind: shown.kind as never, rule: payload });
      toast.success(t("masters.saved", { name }));
      await invalidate.rules();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!shown) return;
    setTried(true);
    if (limitBad || ruleProblem(draft)) return;
    void save(matchesBuiltIn(draft, shown.builtIn) ? null : ruleInput(draft));
  };

  const limitError = limitBad ? t("adm.masters.rules.approvals.limitPercentInvalid") : tried && ruleProblem(draft) ? t("adm.masters.rules.approvals.limitRequired") : undefined;

  return (
    <AdmSheet
      open={row !== null}
      onOpenChange={onOpenChange}
      title={t("adm.masters.rules.approvals.editTitle", { name })}
      description={t("adm.masters.rules.approvals.afterSaving")}
      formId={`rule-form-${uid}`}
      onSubmit={submit}
      busy={set.isPending}
      error={set.error}
      saveLabel={t("adm.masters.rules.approvals.save")}
      editors="approvalRule.manage"
      retire={shown?.rule ? { active: true, hint: t("adm.masters.rules.approvals.resetHint"), retireLabel: t("adm.masters.rules.approvals.reset"), onToggle: () => void save(null) } : undefined}
    >
      <RoleChecks idPrefix={`${uid}-roles`} label={t("adm.masters.rules.approvals.who")} roles={draft.roles} onChange={(roles) => setDraft((d) => ({ ...d, roles }))} />
      {shown?.measure ? (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={above !== null}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setLimitBad(false);
                setDraft((d) => ({ ...d, above: on ? { value: null, roles: d.roles } : null }));
                if (on) setLimitText("");
              }}
              className="size-5 accent-[var(--color-foreground)]"
            />
            <span>{t("adm.masters.rules.approvals.useLimit")}</span>
          </label>
          {above ? (
            <>
              {shown.measure === "bp" ? (
                <Field label={t("adm.masters.rules.approvals.limitPercent")} hint={t("adm.masters.rules.approvals.limitPercentHint")} error={limitError}>
                  <NumberInput
                    value={limitText}
                    suffix="%"
                    onValueChange={(text) => {
                      setLimitText(text);
                      const p = parseLimitPercent(text);
                      setLimitBad(!p.ok);
                      setDraft((d) => (d.above ? { ...d, above: { ...d.above, value: p.ok ? p.value : null } } : d));
                    }}
                  />
                </Field>
              ) : (
                <UnitField
                  field="die.band"
                  label={t("adm.masters.rules.approvals.limitSection")}
                  hint={t("adm.masters.rules.approvals.limitSectionHint")}
                  value={above.value}
                  onValueChange={(value) => setDraft((d) => (d.above ? { ...d, above: { ...d.above, value } } : d))}
                />
              )}
              {limitError && shown.measure !== "bp" ? <p className="m-0 text-[14px] text-tone-red-ink">{limitError}</p> : null}
              <RoleChecks idPrefix={`${uid}-above`} label={t("adm.masters.rules.approvals.whoAbove")} roles={above.roles} onChange={(roles) => setDraft((d) => (d.above ? { ...d, above: { ...d.above, roles } } : d))} />
            </>
          ) : null}
        </div>
      ) : null}
    </AdmSheet>
  );
}
