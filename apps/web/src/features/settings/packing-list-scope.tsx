import { PACKING_LIST_SCOPES, type PackingListScope } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

/**
 * What one packing list may carry (Q37): one sales order, one customer (default) or several
 * customers on one truck. A company setting (`settings.packingList.scope`); the dispatch screens
 * and the server follow it.
 */
export function PackingListScopeCard() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.company.getSettings.queryOptions());
  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: () => toast.error(t("settings.printing.packingList.failed")),
    }),
  );
  const scope: PackingListScope = settings.data?.packingList.scope ?? "one_customer";
  return (
    <Card data-testid="packing-list-scope">
      <CardHeader>
        <CardTitle>{t("settings.printing.packingList.title")}</CardTitle>
        <CardDescription>{t("settings.printing.packingList.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <Can
          do="settings.update"
          fallback={<p className="m-0 text-[15px] font-semibold">{t(`settings.printing.packingList.scope.${scope}.label`)}</p>}
        >
          <SegmentedControl<PackingListScope>
            label={t("settings.printing.packingList.title")}
            value={scope}
            onChange={(next) => {
              if (next !== scope) save.mutate({ packingList: { scope: next } });
            }}
            options={PACKING_LIST_SCOPES.map((s) => ({ value: s, label: t(`settings.printing.packingList.scope.${s}.label`) }))}
          />
        </Can>
        <p className="m-0 text-[14px] leading-5 text-muted-foreground" data-testid="packing-list-scope-body">
          {t(`settings.printing.packingList.scope.${scope}.body`)}
        </p>
      </CardContent>
    </Card>
  );
}
