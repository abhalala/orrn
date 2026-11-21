import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import {
  boxText,
  initialDraft,
  limitMin,
  limitsChange,
  limitWords,
  MONEY_KEY,
  PLANT_LIMIT_KEYS,
  PLANT_LIMITS,
  spendBuys,
  type LimitsDraft,
  type PlantLimitKey,
} from "./limits";
import type { CompanyDetail } from "./types";
import { errorText, Panel } from "./ui";

const NAME_KEYS: Record<PlantLimitKey, MessageKey> = {
  dayModelCalls: "admin.limits.names.dayModelCalls",
  dayModelCostCents: "admin.limits.names.dayModelCostCents",
  blockModelCalls: "admin.limits.names.blockModelCalls",
  visionPagesPerBatch: "admin.limits.names.visionPagesPerBatch",
  filesPerUpload: "admin.limits.names.filesPerUpload",
  rawRowsPerFile: "admin.limits.names.rawRowsPerFile",
  openRowsPerPlant: "admin.limits.names.openRowsPerPlant",
  uploadFileMiB: "admin.limits.names.uploadFileMiB",
  vaultQuotaGiB: "admin.limits.names.vaultQuotaGiB",
};

const HINT_KEYS: Record<PlantLimitKey, MessageKey> = {
  dayModelCalls: "admin.limits.hints.dayModelCalls",
  dayModelCostCents: "admin.limits.hints.dayModelCostCents",
  blockModelCalls: "admin.limits.hints.blockModelCalls",
  visionPagesPerBatch: "admin.limits.hints.visionPagesPerBatch",
  filesPerUpload: "admin.limits.hints.filesPerUpload",
  rawRowsPerFile: "admin.limits.hints.rawRowsPerFile",
  openRowsPerPlant: "admin.limits.hints.openRowsPerPlant",
  uploadFileMiB: "admin.limits.hints.uploadFileMiB",
  vaultQuotaGiB: "admin.limits.hints.vaultQuotaGiB",
};

/**
 * Limits (limits brief, section A; Godseye company tab). Each limit shows its default, its ceiling, whether
 * the plant follows the default or has its own value, and "Use default". The day spend also says roughly
 * what it buys. Saved with `platform.companiesSetLimits`, which sends only the keys that changed.
 */
export function CompanyLimitsTab({ company }: { company: CompanyDetail["company"] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  // Staff who cannot save see the values but cannot change the boxes (N9).
  const canManage = can(me, "platform.company.manage");
  const set = company.limits;
  const savedKey = JSON.stringify(set);
  const [draft, setDraft] = useState<LimitsDraft>(() => initialDraft(set));

  // A refetch after saving (or another staff member's change) resets the form to the server.
  useEffect(() => {
    setDraft(initialDraft(set));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const { change, invalid } = limitsChange(set, draft);
  const buys = spendBuys(draft);
  const dirty = Object.keys(change).length > 0 || invalid.length > 0;

  const save = useMutation({
    ...trpc.platform.companiesSetLimits.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.limits.saved"));
      await qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: company.id }) });
    },
    onError: (error) => toast.error(errorText(t, error)),
  });

  const onSave = () => {
    if (invalid.length > 0 || Object.keys(change).length === 0) return;
    save.mutate({ companyId: company.id, limits: change });
  };

  return (
    <Panel as="div" className="flex flex-col gap-6 p-5 sm:p-6" data-testid="company-limits">
      <p className="m-0 text-[14px] text-muted-foreground">{t("admin.limits.intro")}</p>

      <ul className="m-0 flex list-none flex-col gap-5 p-0">
        {PLANT_LIMIT_KEYS.map((key) => {
          const def = PLANT_LIMITS[key];
          const own = draft[key] !== null;
          const money = key === MONEY_KEY;
          const bad = invalid.includes(key);
          const max = limitWords(key, def.ceiling);
          return (
            <li key={key} className="flex min-w-0 flex-col gap-2 border-t border-border pt-5 first:border-t-0 first:pt-0" data-testid={`limit-${key}`}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Chip tone={own ? "violet" : "neutral"} truncate={false}>
                  {own ? t("admin.limits.setHere") : t("admin.limits.usesDefault")}
                </Chip>
                <span className="text-[13px] text-muted-foreground">
                  {t("admin.limits.defaultValue", { value: limitWords(key, def.default) })}
                  {" · "}
                  {t("admin.limits.ceiling", { max })}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                <Field
                  label={t(NAME_KEYS[key])}
                  hint={t(HINT_KEYS[key])}
                  error={bad ? (money ? t("admin.limits.invalidMoney", { min: limitWords(key, limitMin(key)), max }) : t("admin.limits.invalid", { max })) : undefined}
                  className="min-w-0 flex-1"
                >
                  <NumberInput
                    value={boxText(key, draft)}
                    decimal={money}
                    disabled={!canManage}
                    onValueChange={(text) => setDraft((d) => ({ ...d, [key]: text }))}
                    data-testid={`limit-input-${key}`}
                  />
                </Field>
                <Can do="platform.company.manage">
                  <Button
                    variant="secondary"
                    disabled={!own}
                    className="w-full sm:mt-[26px] sm:w-auto pointer-coarse:h-12"
                    onPress={() => setDraft((d) => ({ ...d, [key]: null }))}
                    data-testid={`limit-default-${key}`}
                  >
                    {t("admin.limits.useDefault")}
                  </Button>
                </Can>
              </div>
              {money && buys ? (
                <p className="m-0 text-[13px] font-medium text-foreground" data-testid="limit-cost-buys">
                  {buys.stop === "calls" ? t("admin.limits.callsBuy", { count: buys.count }) : t("admin.limits.costBuys", { count: buys.count })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Can do="platform.company.manage">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {dirty ? (
            <p role="status" className="m-0 text-[13px] font-medium text-muted-foreground">
              {t("admin.limits.unsaved")}
            </p>
          ) : null}
          <Button
            disabled={!dirty || invalid.length > 0}
            loading={save.isPending}
            className="w-full sm:w-auto pointer-coarse:h-14"
            onPress={onSave}
            data-testid="limits-save"
          >
            {t("admin.limits.save")}
          </Button>
        </div>
      </Can>
    </Panel>
  );
}
