import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { LocationSheet } from "./location-sheet";
import { holdsSummary, type LocationTotal } from "./masters-model";
import {
  ActiveStatus,
  filterByShow,
  MasterNote,
  MastersLoadError,
  RowEdit,
  SeedButton,
  ShowFilter,
  type Show,
} from "./masters-ui";
import { useInvalidate, useMastersAccess, type LocationRow } from "./use-masters";

type Row = LocationRow & { totals: readonly LocationTotal[] };

/**
 * Locations (route /masters/locations): the yards and stores stock sits in, with what each holds
 * now (so nobody tries to retire a full yard). Publishers add and edit them in a sheet; an empty
 * company gets the plant's standard set in one go, after a dialog that says packing will then ask
 * for a yard (createReceipt requires one once yards exist).
 */
export function LocationsPage() {
  const { t } = useT();
  const access = useMastersAccess();
  const invalidate = useInvalidate();
  const list = useQuery(trpc.stock.locations.list.queryOptions({ includeInactive: true }));
  const stock = useQuery(trpc.stock.byLocation.queryOptions({}));
  const seed = useMutation(trpc.stock.locations.seedDefaults.mutationOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: LocationRow }>({ open: false });

  const rows = useMemo<Row[]>(() => {
    const totals = new Map((stock.data?.locations ?? []).map((l) => [l.id, l.totals as readonly LocationTotal[]]));
    return (list.data?.items ?? []).map((l) => ({ ...l, totals: totals.get(l.id) ?? [] }));
  }, [list.data, stock.data]);
  const shown = filterByShow(rows, show);

  const holds = (r: Row) => {
    if (!stock.data) return <span className="text-muted-foreground">-</span>;
    const h = holdsSummary(r.totals);
    if (h.empty) return <span className="text-muted-foreground">{t("masters.locations.holdsEmpty")}</span>;
    const parts = [
      h.bundles > 0 ? t("masters.locations.holdsBundles", { count: h.bundles }) : null,
      h.kgG !== 0 ? t("masters.locations.holdsKg", { kg: formatKgTotal(h.kgG / 1000) }) : null,
      h.storeItems > 0 ? t("masters.locations.holdsItems", { count: h.storeItems }) : null,
    ].filter(Boolean);
    return (
      <span data-no-truncate="" className="tabular-nums">
        {parts.join(", ")}
      </span>
    );
  };

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "code",
      header: t("masters.locations.columns.code"),
      cell: (r) => (
        <RowEdit editable={access.canPublish} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    { key: "name", header: t("masters.locations.columns.name"), cell: (r) => <span className="break-words">{r.name}</span> },
    { key: "kind", header: t("masters.locations.columns.kind"), cell: (r) => t(`masters.locations.kind.${r.kind}`) },
    { key: "holds", header: t("masters.locations.columns.holds"), cell: holds },
    { key: "status", header: t("masters.locations.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];

  const addButton = (
    <Can do="masters.publish">
      <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
        <Plus aria-hidden="true" strokeWidth={2} />
        {t("masters.locations.add")}
      </Button>
    </Can>
  );

  const seedButton = (
    <SeedButton
      label={t("masters.locations.seed")}
      confirm={{ title: t("masters.locations.seedTitle"), body: t("masters.locations.seedBody") }}
      run={async () => {
        const res = await seed.mutateAsync();
        await invalidate.locations();
        return res.created;
      }}
    />
  );

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("masters.locations.title")}
        subtitle={t("masters.locations.subtitle")}
        actions={addButton}
      />
      {!access.canPublish ? <MasterNote body={t("masters.readOnly")} /> : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length > 0 ? <ShowFilter value={show} onChange={setShow} /> : null}
          <ResponsiveList
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("masters.locations.title")}
            empty={
              rows.length > 0 ? (
                <EmptyState title={show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")} />
              ) : (
                <EmptyState
                  title={t("masters.locations.empty")}
                  body={t("masters.locations.emptyBody")}
                  action={seedButton}
                />
              )
            }
          />
        </div>
      )}
      <LocationSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} location={sheet.row} />
    </>
  );
}
