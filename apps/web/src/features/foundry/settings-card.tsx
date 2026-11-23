import { useT } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { SwitchRow, type PlantSettings } from "../settings/ui";

/**
 * Settings → Standards, foundry: "Homogenize 6xxx logs before cutting". On, a 6xxx cast's logs are cut only up
 * to the pieces that came out of a released homogenizing batch (the server enforces it). `settings.update`
 * holders change it; everyone else reads. Shown when the foundry module is on (an empty module list is all on).
 */
export function FoundrySettingsCard({ settings }: { settings: PlantSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const modules = settings.modules as readonly string[];
  const foundryOn = modules.length === 0 || modules.includes("foundry");
  const on = Boolean((settings as { foundry?: { requireHomogenizing?: boolean } }).foundry?.requireHomogenizing);
  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("fdy2.settings.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.audit.list.queryKey() });
      },
      onError: () => toast.error(t("fdy2.settings.saveFailed")),
    }),
  );
  if (!foundryOn) return null;
  const label = t("fdy2.settings.requireHomogenizing");
  return (
    <Card data-testid="settings-foundry">
      <CardHeader>
        <CardTitle>{t("fdy2.settings.title")}</CardTitle>
        <CardDescription>{t("fdy2.settings.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <Can
          do="settings.update"
          fallback={
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-3">
              <span className="min-w-0 text-[15px] font-semibold break-words">{label}</span>
              <span className="text-[14px] text-muted-foreground">{on ? t("settings.modules.on") : t("settings.modules.off")}</span>
            </div>
          }
        >
          <SwitchRow
            testId="foundry-switch-requireHomogenizing"
            label={label}
            hint={t("fdy2.settings.requireHomogenizingHint")}
            on={on}
            pending={save.isPending}
            onToggle={() => save.mutate({ foundry: { requireHomogenizing: !on } })}
          />
        </Can>
      </CardContent>
    </Card>
  );
}
