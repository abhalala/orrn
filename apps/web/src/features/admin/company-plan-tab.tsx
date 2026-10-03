import { useT, type MessageKey } from "@orrn/i18n";
import { COMPANY_MODULES, COMPANY_PLANS, type CompanyModule } from "@orrn/server/lib/modules";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import type { CompanyDetail } from "./types";
import { errorText, Panel } from "./ui";

const PLAN_KEYS: Record<(typeof COMPANY_PLANS)[number], MessageKey> = {
  starter: "admin.plan.plans.starter",
  growth: "admin.plan.plans.growth",
  enterprise: "admin.plan.plans.enterprise",
};

function sameModules(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((m) => b.includes(m));
}

/**
 * Plan and modules (spec §3, Godseye company tab). Modules gate the
 * company's navigation (`visibleItems`); none ticked means all on. A plan
 * value Godseye doesn't offer (older companies, the `dev` demo) is kept as
 * its own option so saving never silently changes it.
 */
export function CompanyPlanTab({ company }: { company: CompanyDetail["company"] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const groupId = useId();
  const initialPlan = company.plan ?? "starter";
  const initialModules = (company.modules ?? []).filter((m): m is CompanyModule =>
    (COMPANY_MODULES as readonly string[]).includes(m),
  );
  const [plan, setPlan] = useState(initialPlan);
  const [modules, setModules] = useState<CompanyModule[]>(initialModules);

  // A refetch after saving (or another staff member's change) resets the form to the server.
  useEffect(() => {
    setPlan(initialPlan);
    setModules(initialModules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.plan, (company.modules ?? []).join(",")]);

  const dirty = plan !== initialPlan || !sameModules(modules, initialModules);

  const save = useMutation({
    ...trpc.platform.updatePlanAndModules.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.plan.saved"));
      await qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: company.id }) });
    },
    onError: (error) => toast.error(errorText(t, error)),
  });

  const planOptions = COMPANY_PLANS.map((value) => ({ value: value as string, label: t(PLAN_KEYS[value]) }));
  if (!planOptions.some((o) => o.value === initialPlan)) planOptions.push({ value: initialPlan, label: initialPlan });

  const toggle = (id: CompanyModule, on: boolean) =>
    setModules((current) => (on ? [...new Set([...current, id])] : current.filter((m) => m !== id)));

  return (
    <Panel as="div" className="flex flex-col gap-6 p-5 sm:p-6">
      <div className="flex min-w-0 flex-col gap-2">
        <p id={`${groupId}-plan`} className="m-0 text-[14px] font-semibold text-foreground">
          {t("admin.plan.plan")}
        </p>
        <SegmentedControl
          label={t("admin.plan.plan")}
          value={plan}
          onChange={setPlan}
          options={planOptions}
          className="max-w-full self-start"
        />
      </div>

      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" aria-describedby={`${groupId}-hint`}>
        <legend className="mb-1 p-0 text-[14px] font-semibold text-foreground">{t("admin.plan.modules")}</legend>
        <p id={`${groupId}-hint`} className="m-0 -mt-1 text-[13px] text-muted-foreground">
          {t("admin.plan.modulesHint")}
        </p>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
          {COMPANY_MODULES.map((id) => {
            const checked = modules.includes(id);
            const inputId = `${groupId}-${id}`;
            return (
              <li key={id} className="min-w-0">
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-start gap-3 rounded-input border px-4 py-3 transition-colors duration-[var(--dur-fast)]",
                    checked ? "border-primary bg-tone-violet-tint" : "border-border bg-card hover:bg-surface-sunken",
                  )}
                >
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    onCheckedChange={(v) => toggle(id, v === true)}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-foreground">{t(`admin.plan.moduleNames.${id}`)}</span>
                    <span className="text-[13px] text-muted-foreground">{t(`admin.plan.moduleHints.${id}`)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <Can do="platform.company.manage">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {dirty ? (
            <p role="status" className="m-0 text-[13px] font-medium text-muted-foreground">
              {t("admin.plan.unsaved")}
            </p>
          ) : null}
          <Button
            disabled={!dirty}
            loading={save.isPending}
            className="w-full sm:w-auto pointer-coarse:h-14"
            onPress={() => save.mutate({ companyId: company.id, plan, modules })}
          >
            {t("admin.plan.save")}
          </Button>
        </div>
      </Can>
    </Panel>
  );
}
