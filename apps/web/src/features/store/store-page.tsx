import { useT } from "@orrn/i18n";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { Button } from "@orrn/ui/components/button";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine } from "lucide-react";

import { BalanceFilters, BalancesEmpty, BalancesList, useBalanceFilter } from "./balances-list";
import { StoreEntries } from "./entries-list";
import { StoreLoadError, StoreNoAccess, StoreNote, StoreSection } from "./store-ui";
import { useStoreAccess, useStoreBalances } from "./use-store";

/**
 * Store (spec P17, route /store): the storekeeper's screen. One loud element, the black Issue
 * tile (the everyday job), with Receive and Exchange beside it; then what is in the store and the
 * latest entries. Managers and admins (masters.publish) see the same lists without the actions.
 */
export function StorePage() {
  const { t } = useT();
  const access = useStoreAccess();
  const balances = useStoreBalances(access.canRead);
  const rows = balances.data?.items ?? [];
  const filter = useBalanceFilter(rows);

  const header = (
    <PageHeader
      title={t("store.title")}
      subtitle={t("store.subtitle")}
      actions={
        access.canRead ? (
          <>
            {access.canEnter ? <HowToButton slug="store-entries" /> : null}
            <Button asChild variant="secondary">
              <Link to="/store/items">{t("store.items")}</Link>
            </Button>
          </>
        ) : undefined
      }
    />
  );

  if (!access.canRead) {
    return (
      <>
        {header}
        <StoreNoAccess />
      </>
    );
  }

  return (
    <>
      {header}

      {access.canEnter ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <ActionTile
            tone="ink"
            to="/store/issue"
            title={t("store.actions.issue")}
            hint={t("store.actions.issueHint")}
            icon={<ArrowUpFromLine />}
            className="animate-rise col-span-2 md:col-span-1"
            style={riseDelay(0)}
          />
          <ActionTile
            tone="neutral"
            to="/store/receive"
            title={t("store.actions.receive")}
            hint={t("store.actions.receiveHint")}
            icon={<ArrowDownToLine />}
            className="animate-rise"
            style={riseDelay(1)}
          />
          <ActionTile
            tone="neutral"
            to="/store/exchange"
            title={t("store.actions.exchange")}
            hint={t("store.actions.exchangeHint")}
            icon={<ArrowLeftRight />}
            className="animate-rise"
            style={riseDelay(2)}
          />
        </div>
      ) : (
        <StoreNote body={t("store.readOnly")} />
      )}

      {balances.data?.locationId === null ? (
        <StoreNote tone="attention" title={t("store.noLocation")} body={t("store.noLocationBody")} />
      ) : null}

      <StoreSection id="store-in-store" title={t("store.inStore")}>
        {balances.isError && !balances.data ? (
          <StoreLoadError onRetry={() => void balances.refetch()} />
        ) : (
          <>
            {rows.length > 0 ? (
              <BalanceFilters
                query={filter.query}
                onQuery={filter.setQuery}
                category={filter.category}
                onCategory={filter.setCategory}
              />
            ) : null}
            <BalancesList
              rows={filter.filtered}
              loading={balances.isLoading}
              label={t("store.inStore")}
              empty={
                <BalancesEmpty
                  hasAny={rows.length > 0}
                  query={filter.query}
                  action={
                    access.canEditItems ? (
                      <Button asChild>
                        <Link to="/store/items" search={{ add: true }}>
                          {t("store.addItem")}
                        </Link>
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </>
        )}
      </StoreSection>

      <StoreSection id="store-recent" title={t("store.recent")}>
        <StoreEntries label={t("store.recent")} />
      </StoreSection>
    </>
  );
}
