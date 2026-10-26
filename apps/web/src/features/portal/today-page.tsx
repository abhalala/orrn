import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { RouterLink } from "@/shared/components/router-link";
import { trpc } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { isPortalOrderStatus, kgText, PORTAL_STATUS_TONE, portalDispatchDay } from "./model";
import { bookDate, PortalError, PortalSkeleton } from "./ui";

/** `/portal`: what is open, how much is baki, the last dispatch, and the way to place an order. */
export function PortalTodayPage() {
  const { t, locale } = useT();
  const me = usePortalMe();
  const today = useQuery({ ...trpc.portal.today.queryOptions(), retry: false });
  const open = useQuery({ ...trpc.portal.orders.list.queryOptions({ status: "open", limit: 5 }), retry: false });

  if (me.isError) return <PortalError error={me.error} onRetry={() => void me.refetch()} />;
  const d = today.data;
  return (
    <>
      <PageHeader title={t("portal.nav.today")} subtitle={me.data ? t("portal.signedInAs", { party: me.data.customer.name }) : undefined} />
      {today.isError ? (
        <PortalError error={today.error} onRetry={() => void today.refetch()} />
      ) : !d ? (
        <PortalSkeleton rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="portal-today">
            <StatusBlock tone="blue" title={t("portal.today.openOrders")} value={d.openOrders} countUp={false} href="/portal/orders" />
            <StatusBlock
              tone="amber"
              title={t("portal.today.baki")}
              meta={t("portal.today.bakiHint")}
              value={d.bakiG / 1000}
              unit={t("units.kg")}
              format={(n) => kgText(Math.round(n * 1000))}
              countUp={false}
            />
            {d.lastDispatch ? (
              <StatusBlock
                tone="green"
                title={t("portal.today.lastDispatch")}
                meta={portalDispatchDay(d.lastDispatch, locale)}
                value={d.lastDispatch.code}
                href={`/portal/dispatches/${d.lastDispatch.id}`}
              />
            ) : (
              <StatusBlock tone="neutral" title={t("portal.today.lastDispatch")} value={t("portal.today.noDispatch")} mono={false} />
            )}
          </div>
          {d.canOrder ? (
            <div>
              <Button asChild size="lg">
                <RouterLink to="/portal/orders/new">
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("portal.today.placeOrder")}
                </RouterLink>
              </Button>
            </div>
          ) : (
            <p className="m-0 text-[15px] text-muted-foreground">{t("portal.dies.empty")}</p>
          )}
        </>
      )}

      <section aria-labelledby="portal-open-orders" className="flex min-w-0 flex-col gap-3">
        <h2 id="portal-open-orders" className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">
          {t("portal.today.openOrders")}
        </h2>
        {open.isError ? (
          <PortalError error={open.error} onRetry={() => void open.refetch()} />
        ) : !open.data ? (
          <PortalSkeleton rows={2} />
        ) : open.data.items.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("portal.today.noOrder")} />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {open.data.items.map((o) => (
              <li key={o.id} className="min-w-0">
                <ListCard
                  title={
                    <RouterLink to={`/portal/orders/${o.id}`} className={`${stretchedLink} font-mono`}>
                      {o.number}
                    </RouterLink>
                  }
                  status={
                    isPortalOrderStatus(o.status) ? (
                      <Chip tone={PORTAL_STATUS_TONE[o.status]} truncate={false}>
                        {t(`portal.orders.status.${o.status}`)}
                      </Chip>
                    ) : null
                  }
                  subtitle={bookDate(o.orderDate, locale)}
                  facts={[
                    { label: t("portal.orders.ordered"), value: `${kgText(o.totals.orderedG)}\u00A0${t("units.kg")}`, mono: true },
                    { label: t("portal.orders.baki"), value: `${kgText(o.totals.bakiG)}\u00A0${t("units.kg")}`, mono: true },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
