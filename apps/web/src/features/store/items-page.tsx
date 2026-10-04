import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/shared/components/can";

import { BalanceFilters, BalancesEmpty, BalancesList, useBalanceFilter, type BalanceRow } from "./balances-list";
import { StoreItemSheet } from "./item-sheet";
import { StoreLoadError, StoreNoAccess } from "./store-ui";
import { ITEM_EDITORS, useStoreAccess, useStoreBalances, useStoreItems } from "./use-store";

type Show = "active" | "retired" | "all";

/**
 * Store items (route /store/items): the store's item master, retired items included, with unit,
 * category and balance. The storekeeper and publishers add and edit items here (RP19); the
 * Masters group links here rather than keeping a second copy (ruling PLW6).
 */
export function StoreItemsPage({ startAdding = false }: { startAdding?: boolean }) {
  const { t } = useT();
  const navigate = useNavigate();
  const access = useStoreAccess();
  const items = useStoreItems(access.canRead);
  const balances = useStoreBalances(access.canRead);
  const [show, setShow] = useState<Show>("active");
  const [adding, setAdding] = useState(startAdding && access.canEditItems);

  // Items carry no balance; balances leave out retired items at 0. Join them, 0 by default.
  const rows = useMemo<BalanceRow[]>(() => {
    const byId = new Map((balances.data?.items ?? []).map((b) => [b.id, b.balanceMilli]));
    return (items.data?.items ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      active: i.active,
      balanceMilli: byId.get(i.id) ?? 0,
    }));
  }, [items.data, balances.data]);

  const shown = useMemo(
    () => rows.filter((r) => show === "all" || (show === "active" ? r.active : !r.active)),
    [rows, show],
  );
  const filter = useBalanceFilter(shown);

  const header = (
    <PageHeader
      back={{ to: "/store", label: t("store.backToStore") }}
      title={t("store.items")}
      subtitle={t("store.itemsPage.subtitle")}
      actions={
        <Can do={ITEM_EDITORS}>
          <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("store.addItem")}
          </Button>
        </Can>
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

  const failed = (items.isError && !items.data) || (balances.isError && !balances.data);

  return (
    <>
      {header}
      {failed ? (
        <StoreLoadError
          onRetry={() => {
            void items.refetch();
            void balances.refetch();
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length > 0 ? (
            <>
              <SegmentedControl<Show>
                label={t("store.itemsPage.show")}
                value={show}
                onChange={setShow}
                options={[
                  { value: "active", label: t("store.itemsPage.showInUse") },
                  { value: "retired", label: t("store.itemsPage.showRetired") },
                  { value: "all", label: t("store.itemsPage.showAll") },
                ]}
              />
              <BalanceFilters
                query={filter.query}
                onQuery={filter.setQuery}
                category={filter.category}
                onCategory={filter.setCategory}
              />
            </>
          ) : null}
          <BalancesList
            rows={filter.filtered}
            loading={items.isLoading || balances.isLoading}
            label={t("store.items")}
            empty={
              show === "retired" && rows.length > 0 && !filter.query ? (
                <EmptyState title={t("store.itemsPage.noRetired")} />
              ) : (
                <BalancesEmpty
                  hasAny={shown.length > 0}
                  query={filter.query}
                  action={
                    <Can do={ITEM_EDITORS}>
                      <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
                        {t("store.addItem")}
                      </Button>
                    </Can>
                  }
                />
              )
            }
          />
        </div>
      )}
      <StoreItemSheet
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          // Drop ?add=true so Back and reload don't reopen the sheet.
          if (!open && startAdding) void navigate({ to: "/store/items", search: {}, replace: true });
        }}
      />
    </>
  );
}
