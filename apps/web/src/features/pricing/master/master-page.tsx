import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { MasterNote, MastersLoadError } from "@/features/masters/masters-ui";
import { useFmt } from "@/shared/lib/fmt";
import { canAny, can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { RateSheet, type RateSheetState } from "./rate-sheet";
import { RateSection } from "./rate-sections";
import { emptyForm, formFromItem, groupByKind, MASTER_KINDS, missingParts, rateTitle, type MasterKind, type RateItem } from "./rate-model";
import { rateName } from "./rate-words";
import { SettingsStrip } from "./settings-strip";

/**
 * The price master (route /pricing): the plant's metal list, conversion, alloy surcharges, finishes, add-ons and
 * customer terms. Each rate applies from its date once a manager has approved it; a change waits beside the rate
 * that still applies. Links lead to the quotes and enquiries pages.
 */
export function PricingMasterPage() {
  const { t } = useT();
  const fmt = useFmt();
  const { data: me } = useMe();
  const canView = can(me, "price.view");
  const settings = useQuery({ ...trpc.pricing.settings.get.queryOptions(), enabled: canView });
  const rates = useQuery({ ...trpc.pricing.rates.current.queryOptions(), enabled: canView });
  const [sheet, setSheet] = useState<{ open: boolean; state: RateSheetState | null }>({ open: false, state: null });
  const groups = useMemo(() => groupByKind((rates.data?.items ?? []) as RateItem[]), [rates.data]);
  const metalSource = settings.data?.metalSource ?? rates.data?.metalSource ?? "nalco";

  const openAdd = (kind: MasterKind) =>
    setSheet({ open: true, state: { form: emptyForm(kind, metalSource), lockedName: null, dieLabel: "", customerLabel: "" } });
  const openChange = (item: RateItem) => {
    const title = rateTitle(item);
    setSheet({
      open: true,
      state: {
        form: formFromItem(item, metalSource),
        lockedName: rateName(t, item),
        dieLabel: title.type === "conversionDie" ? title.code : "",
        customerLabel: title.type === "customer" ? title.name : "",
      },
    });
  };

  const missing = rates.data ? missingParts(rates.data.items as RateItem[], rates.data.metalSource) : [];
  const missingText =
    missing.length === 2
      ? t("price.master.missingBoth")
      : missing[0] === "metal"
        ? t("price.master.missingMetal")
        : missing[0] === "conversion"
          ? t("price.master.missingConversion")
          : null;

  return (
    <>
      <PageHeader title={t("price.title")} subtitle={t("price.master.subtitle")} />
      <nav aria-label={t("price.master.sectionsLabel")} className="flex flex-wrap gap-2">
        <span aria-current="page" className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[15px] font-semibold text-background">
          {t("price.master.tabPrices")}
        </span>
        {canAny(me, ["price.view", "quote.manage"]) ? <PageLink to="/pricing/quotes">{t("price.master.tabQuotes")}</PageLink> : null}
        {canAny(me, ["enquiry.manage"]) ? <PageLink to="/pricing/enquiries">{t("price.master.tabEnquiries")}</PageLink> : null}
      </nav>

      {!canView ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("price.master.noAccess")} />
        </div>
      ) : (rates.isError && !rates.data) || (settings.isError && !settings.data) ? (
        <MastersLoadError
          onRetry={() => {
            void rates.refetch();
            void settings.refetch();
          }}
        />
      ) : !rates.data || !settings.data ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          {!rates.data.ready ? (
            <div role="alert" data-testid="price-not-ready">
              <MasterNote
                tone="attention"
                body={`${t("price.master.notReadyTitle")}. ${missingText ? t("price.master.notReadyBody", { missing: missingText }) : t("price.master.notReadyBodyGeneric")}`}
              />
            </div>
          ) : null}
          <SettingsStrip settings={settings.data} />
          <div className="flex flex-col gap-1">
            <p className="m-0 text-[14px] text-muted-foreground">{t("price.master.onDate", { date: fmt.day(rates.data.onDate) })}</p>
            <p className="m-0 text-[14px] font-medium">{t("price.master.approvalNote")}</p>
          </div>
          {MASTER_KINDS.map((kind) => (
            <RateSection key={kind} kind={kind} items={groups[kind]} onAdd={() => openAdd(kind)} onChange={openChange} />
          ))}
        </div>
      )}
      <RateSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} state={sheet.state} />
    </>
  );
}

function PageLink({ to, children }: { to: string; children: string }) {
  return (
    <UiLink
      to={to}
      className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-[15px] font-semibold text-foreground no-underline hover:bg-surface-sunken"
    >
      {children}
    </UiLink>
  );
}
