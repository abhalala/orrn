import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ReportToggle } from "../reports/report-chrome";
import { AssetSheet } from "./asset-form";
import { ASSET_STATUS_TONE, isAssetKind, isAssetStatus, isCriticality, maintErrorKey } from "./model";

/** `/maintenance/assets`: the register of machines. */
export function AssetsPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [retired, setRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ ...trpc.maint.assets.list.queryOptions({ includeRetired: retired }), retry: false, meta: INLINE_ERROR_META });
  const rows = list.data ?? [];
  type Row = (typeof rows)[number];

  const fromMasters = useOnceMutation(
    trpc.maint.assets.addFromMasters.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.added === 0 ? t("maint.assets.noneToAdd") : t("maint.assets.addedFromMasters", { count: r.added }));
        void queryClient.invalidateQueries(trpc.maint.pathFilter());
      },
      onError: (e) => toast.error(t(maintErrorKey(e))),
    }),
  );

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "code", header: t("maint.assets.cols.code"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span> },
    { key: "name", header: t("maint.assets.cols.name"), cell: (r) => r.name },
    { key: "kind", header: t("maint.assets.cols.kind"), cell: (r) => (isAssetKind(r.kind) ? t(`maint.kind.${r.kind}`) : r.kind) },
    { key: "crit", header: t("maint.assets.cols.criticality"), hideOnPhone: true, cell: (r) => (isCriticality(r.criticality) ? t(`maint.criticality.${r.criticality}`) : r.criticality) },
    {
      key: "status",
      header: t("maint.assets.cols.status"),
      phoneWide: true,
      cell: (r) =>
        isAssetStatus(r.status) ? (
          <Chip tone={ASSET_STATUS_TONE[r.status]} truncate={false}>
            {t(`maint.assetStatus.${r.status}`)}
          </Chip>
        ) : (
          r.status
        ),
    },
    { key: "open", header: t("maint.assets.cols.openWorkOrders"), align: "end", cell: (r) => <span className="tabular-nums">{r.openWorkOrders}</span> },
    { key: "location", header: t("maint.assets.cols.location"), hideOnPhone: true, cell: (r) => r.location ?? "" },
  ];

  return (
    <>
      <PageHeader
        title={t("maint.assets.title")}
        subtitle={t("maint.assets.subtitle")}
        back={{ to: "/maintenance", label: t("maint.title") }}
        actions={
          <Can do="maint.manage">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={fromMasters.isPending} onClick={() => fromMasters.mutate()}>
                {t("maint.assets.addFromMasters")}
              </Button>
              <Button onClick={() => setAdding(true)}>{t("maint.assets.add")}</Button>
            </div>
          </Can>
        }
      />
      <ReportToggle id="assets-retired" checked={retired} onChange={setRetired} label={t("maint.assets.showRetired")} />
      {list.isError && !list.data ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("maint.assets.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <ResponsiveList<Row>
          label={t("maint.assets.title")}
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/maintenance/assets/${r.id}`}
          loading={list.isPending}
          empty={<EmptyState title={t("maint.assets.empty")} body={t("maint.assets.emptyHint")} />}
        />
      )}
      <Can do="maint.manage">
        <AssetSheet open={adding} onOpenChange={setAdding} />
      </Can>
    </>
  );
}
