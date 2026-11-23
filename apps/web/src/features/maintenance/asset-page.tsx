import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { ymdInZone } from "@/shared/lib/plant-calendar";
import { trpc } from "@/shared/utils/trpc";

import { useCompanyTimeZone } from "../orders/hooks";
import { AssetSheet } from "./asset-form";
import { PlansSection } from "./asset-plans";
import { Facts, HistoryTable, Section, SparesTable, WarrantyLine } from "./asset-parts";
import { ReadingsSection } from "./asset-readings";
import { ASSET_STATUS_TONE, isAssetKind, isAssetStatus, isCriticality, milliText } from "./model";

/** `/maintenance/assets/$id`: details, plans, readings, service history and spares of one asset. */
export function AssetPage({ id }: { id: string }) {
  const { t } = useT();
  const q = useQuery({ ...trpc.maint.assets.get.queryOptions({ id }), retry: false, meta: INLINE_ERROR_META });
  const back = { to: "/maintenance/assets", label: t("maint.assets.detail.back") };
  if (q.isError && !q.data) {
    const notFound = (q.error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("maint.assets.title")} back={back} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={notFound ? t("maint.assets.detail.notFound") : t("maint.assets.detail.loadFailed")}
            action={
              notFound ? undefined : (
                <Button variant="secondary" onClick={() => void q.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title={t("maint.assets.title")} back={back} />
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-[140px] w-full rounded-card" />
          <Skeleton className="h-[180px] w-full rounded-card" />
        </div>
      </>
    );
  }
  return <AssetBody data={q.data} back={back} />;
}

type AssetData = NonNullable<ReturnType<typeof useAssetData>["data"]>;
function useAssetData(id: string) {
  return useQuery(trpc.maint.assets.get.queryOptions({ id }));
}

function AssetBody({ data, back }: { data: AssetData; back: { to: string; label: string } }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const zone = useCompanyTimeZone();
  const [editing, setEditing] = useState(false);
  const { asset, link, history, plans, readingKinds, readings, spares } = data;
  const today = ymdInZone(Date.now(), zone);
  const date = (at: number) => fmt.date(at, { year: true });
  const day = (ymd: string) => fmt.day(ymd, { year: true });
  const status = isAssetStatus(asset.status) ? asset.status : "running";

  return (
    <>
      <PageHeader
        title={`${asset.code} ${asset.name}`}
        back={back}
        subtitle={[isAssetKind(asset.kind) ? t(`maint.kind.${asset.kind}`) : asset.kind, isCriticality(asset.criticality) ? t(`maint.criticality.${asset.criticality}`) : null].filter(Boolean).join(" · ")}
        actions={
          <Chip tone={ASSET_STATUS_TONE[status]} truncate={false}>
            {t(`maint.assetStatus.${status}`)}
          </Chip>
        }
      />

      <Section
        title={t("maint.assets.detail.details")}
        testId="asset-details"
        actions={
          <Can do="maint.manage">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("maint.assets.detail.edit")}
            </Button>
          </Can>
        }
      >
        <Facts
          rows={[
            {
              label: t("maint.assets.detail.linkedTo"),
              value: link ? `${t(`maint.link.${link.kind}`)} ${link.code}${link.name ? ` ${link.name}` : ""}` : t("maint.assets.detail.notLinked"),
            },
            { label: t("maint.assets.detail.location"), value: asset.location ?? "" },
            { label: t("maint.assets.detail.make"), value: asset.make ?? "" },
            { label: t("maint.assets.detail.serialNo"), value: asset.serialNo ?? "" },
            { label: t("maint.assets.detail.purchasedOn"), value: asset.purchasedOn ? day(asset.purchasedOn) : "" },
            { label: t("maint.assets.detail.warranty"), value: <WarrantyLine until={asset.warrantyUntil} today={today} day={day} /> },
            ...(asset.note ? [{ label: t("maint.assets.detail.note"), value: <span className="whitespace-pre-wrap">{asset.note}</span> }] : []),
          ]}
        />
      </Section>

      <PlansSection assetId={asset.id} linked={link !== null} plans={plans} />
      <ReadingsSection assetId={asset.id} kinds={readingKinds} readings={readings} when={when} />

      <Section title={t("maint.assets.history.title")} testId="asset-history-section">
        {history.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("maint.assets.history.empty")}</p> : <HistoryTable rows={history} date={date} />}
      </Section>

      <Section title={t("maint.assets.spares.title")} testId="asset-spares-section">
        {spares.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("maint.assets.spares.empty")}</p> : <SparesTable rows={spares} date={date} qty={milliText} />}
      </Section>

      <Can do="maint.manage">
        <AssetSheet open={editing} onOpenChange={setEditing} asset={asset} />
      </Can>
    </>
  );
}

