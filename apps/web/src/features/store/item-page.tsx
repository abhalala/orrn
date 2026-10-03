import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { StoreEntries } from "./entries-list";
import { StoreItemSheet } from "./item-sheet";
import { countedIn, unitShort } from "./store-labels";
import { formatQty } from "./store-qty";
import { StoreLoadError, StoreNoAccess, StoreNote, StoreSection } from "./store-ui";
import { useStoreAccess, useStoreBalances, useStoreItems } from "./use-store";

/**
 * One store item (route /store/items/$id): what is in the store as the page's colour block, the
 * three entry actions for the storekeeper, and every entry for the item with cancel.
 */
export function StoreItemPage({ id }: { id: string }) {
  const { t } = useT();
  const access = useStoreAccess();
  const items = useStoreItems(access.canRead);
  const balances = useStoreBalances(access.canRead);
  const [editing, setEditing] = useState(false);

  const back = { to: "/store", label: t("store.backToStore") };

  if (!access.canRead) {
    return (
      <>
        <PageHeader back={back} title={t("store.items")} />
        <StoreNoAccess />
      </>
    );
  }

  if ((items.isError && !items.data) || (balances.isError && !balances.data)) {
    return (
      <>
        <PageHeader back={back} title={t("store.items")} />
        <StoreLoadError
          onRetry={() => {
            void items.refetch();
            void balances.refetch();
          }}
        />
      </>
    );
  }

  if (!items.data || !balances.data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-[168px] w-full rounded-hero" />
      </div>
    );
  }

  const item = items.data.items.find((i) => i.id === id);
  if (!item) {
    return (
      <>
        <PageHeader back={back} title={t("store.itemPage.notFound")} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("store.itemPage.notFound")}
            body={t("store.itemPage.notFoundBody")}
            action={
              <Button asChild variant="secondary">
                <Link to="/store">{t("store.backToStore")}</Link>
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const balanceMilli = balances.data.items.find((b) => b.id === id)?.balanceMilli ?? 0;
  const tone = !item.active ? "neutral" : balanceMilli > 0 ? "green" : "amber";
  const status = !item.active
    ? t("store.status.retired")
    : balanceMilli > 0
      ? t("store.columns.inStore")
      : t("store.status.empty");

  return (
    <>
      <PageHeader
        back={back}
        title={item.name}
        subtitle={countedIn(t, item)}
        actions={
          access.canEditItems ? (
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setEditing(true)}>
              {t("store.itemPage.edit")}
            </Button>
          ) : undefined
        }
      />

      <StatusBlock
        tone={tone}
        title={status}
        value={balanceMilli / 1000}
        format={(n) => formatQty(Math.round(n * 1000))}
        unit={unitShort(t, item.unit, balanceMilli)}
        className="orrn-block-hero animate-rise"
      />

      {!item.active ? <StoreNote body={t("store.itemPage.retiredNote")} /> : null}

      {access.canEnter && item.active ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button asChild size="lg">
            <Link to="/store/issue" search={{ item: item.id }}>
              {t("store.actions.issue")}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/store/receive" search={{ item: item.id }}>
              {t("store.actions.receive")}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/store/exchange" search={{ item: item.id }}>
              {t("store.actions.exchange")}
            </Link>
          </Button>
        </div>
      ) : null}

      <StoreSection id="store-item-entries" title={t("store.entries")}>
        <StoreEntries itemId={item.id} label={t("store.entries")} />
      </StoreSection>

      <StoreItemSheet open={editing} onOpenChange={setEditing} item={item} />
    </>
  );
}
