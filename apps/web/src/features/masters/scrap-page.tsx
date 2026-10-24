import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { percentText } from "./masters-model";
import { ActiveStatus, filterByShow, MasterNote, MastersLoadError, RowEdit, SeedButton, ShowFilter, type Show } from "./masters-ui";
import { GradeSheet, ScrapItemSheet, StreamSheet } from "./scrap-sheets";
import { SCRAP_TABS, type ScrapTab } from "./search";
import { useInvalidate, useMastersAccess, type ScrapGradeRow, type ScrapItemRow, type StreamRow } from "./use-masters";


/**
 * Scrap and returns (route /masters/scrap?tab=): the yard's scrap items and grade ladder, and the
 * return streams the furnace charges back (PL-5). One list per tab, each with its add/edit sheet.
 */
export function ScrapPage({ tab, onTab }: { tab: ScrapTab; onTab(tab: ScrapTab): void }) {
  const { t } = useT();
  const access = useMastersAccess();
  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("masters.scrap.title")}
        subtitle={t("masters.scrap.subtitle")}
      />
      {!access.canPublish ? <MasterNote body={t("masters.readOnly")} /> : null}
      <Tabs
        label={t("masters.scrap.tabs.label")}
        value={tab}
        onValueChange={(v) => onTab(v as ScrapTab)}
        items={SCRAP_TABS.map((id) => ({ id, label: t(`masters.scrap.tabs.${id}`) }))}
      >
        {tab === "items" ? <ItemsTab /> : tab === "grades" ? <GradesTab /> : <StreamsTab />}
      </Tabs>
    </>
  );
}

/** Show filter + Add button above a tab's list. */
function TabBar({ show, onShow, hasRows, add }: { show: Show; onShow(v: Show): void; hasRows: boolean; add: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {hasRows ? <ShowFilter value={show} onChange={onShow} /> : <span />}
      {add}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <Can do="masters.publish">
      <Button onClick={onClick} aria-haspopup="dialog">
        <Plus aria-hidden="true" strokeWidth={2} />
        {label}
      </Button>
    </Can>
  );
}

function useScrapSeed() {
  const { t } = useT();
  const invalidate = useInvalidate();
  const seed = useMutation(trpc.purchase.seedScrapDefaults.mutationOptions());
  return (
    <SeedButton
      label={t("masters.scrap.seed")}
      run={async () => {
        const res = await seed.mutateAsync();
        await invalidate.scrap();
        return res.grades + res.items;
      }}
    />
  );
}

function emptyFor(show: Show, hasRows: boolean, t: ReturnType<typeof useT>["t"], none: ReactNode) {
  if (!hasRows) return none;
  return <EmptyState title={show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")} />;
}

function ItemsTab() {
  const { t } = useT();
  const access = useMastersAccess();
  const list = useQuery(trpc.purchase.scrapItems.list.queryOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: ScrapItemRow }>({ open: false });
  const seed = useScrapSeed();
  const rows = list.data?.items ?? [];
  const columns: ResponsiveListColumn<ScrapItemRow>[] = [
    {
      key: "name",
      header: t("masters.scrap.items.columns.name"),
      cell: (r) => (
        <RowEdit editable={access.canPublish} label={r.name} onEdit={() => setSheet({ open: true, row: r })}>
          {r.name}
        </RowEdit>
      ),
    },
    {
      key: "recovery",
      header: t("masters.scrap.items.columns.recovery"),
      align: "end",
      cell: (r) => <Percent bp={r.expectedRecoveryBp} />,
    },
    { key: "status", header: t("masters.scrap.items.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];
  if (list.isError && !list.data) return <MastersLoadError onRetry={() => void list.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TabBar
        show={show}
        onShow={setShow}
        hasRows={rows.length > 0}
        add={<AddButton label={t("masters.scrap.items.add")} onClick={() => setSheet({ open: true })} />}
      />
      <ResponsiveList
        rows={filterByShow(rows, show)}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        label={t("masters.scrap.tabs.items")}
        empty={emptyFor(
          show,
          rows.length > 0,
          t,
          <EmptyState title={t("masters.scrap.items.empty")} body={t("masters.scrap.items.emptyBody")} action={seed} />,
        )}
      />
      <ScrapItemSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </div>
  );
}

function GradesTab() {
  const { t } = useT();
  const access = useMastersAccess();
  const list = useQuery(trpc.purchase.scrapGrades.list.queryOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: ScrapGradeRow }>({ open: false });
  const seed = useScrapSeed();
  const rows = list.data?.items ?? [];
  const columns: ResponsiveListColumn<ScrapGradeRow>[] = [
    {
      key: "code",
      header: t("masters.scrap.grades.columns.code"),
      cell: (r) => (
        <RowEdit editable={access.canPublish} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    {
      key: "name",
      header: t("masters.scrap.grades.columns.name"),
      cell: (r) => (r.name ? <span className="break-words">{r.name}</span> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "recovery",
      header: t("masters.scrap.grades.columns.recovery"),
      align: "end",
      cell: (r) => <Percent bp={r.expectedRecoveryBp} />,
    },
    { key: "status", header: t("masters.scrap.grades.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];
  if (list.isError && !list.data) return <MastersLoadError onRetry={() => void list.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TabBar
        show={show}
        onShow={setShow}
        hasRows={rows.length > 0}
        add={<AddButton label={t("masters.scrap.grades.add")} onClick={() => setSheet({ open: true })} />}
      />
      <ResponsiveList
        rows={filterByShow(rows, show)}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        label={t("masters.scrap.tabs.grades")}
        empty={emptyFor(
          show,
          rows.length > 0,
          t,
          <EmptyState title={t("masters.scrap.grades.empty")} body={t("masters.scrap.grades.emptyBody")} action={seed} />,
        )}
      />
      <GradeSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </div>
  );
}

function StreamsTab() {
  const { t } = useT();
  const access = useMastersAccess();
  const invalidate = useInvalidate();
  const list = useQuery(trpc.foundry.returnStreams.list.queryOptions());
  const seedStreams = useMutation(trpc.foundry.returnStreams.seedDefaults.mutationOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: StreamRow }>({ open: false });
  const rows = list.data?.items ?? [];
  const columns: ResponsiveListColumn<StreamRow>[] = [
    {
      key: "code",
      header: t("masters.streams.columns.code"),
      cell: (r) => (
        <RowEdit editable={access.canPublish} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    { key: "name", header: t("masters.streams.columns.name"), cell: (r) => <span className="break-words">{r.name}</span> },
    { key: "kind", header: t("masters.streams.columns.kind"), cell: (r) => t(`masters.streams.kind.${r.kind}`) },
    {
      key: "balance",
      header: t("masters.streams.columns.balance"),
      align: "end",
      cell: (r) => (
        <span data-no-truncate="" className="font-mono tabular-nums">
          {formatKgTotal(r.balanceG / 1000)} kg
        </span>
      ),
    },
    { key: "status", header: t("masters.streams.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];
  if (list.isError && !list.data) return <MastersLoadError onRetry={() => void list.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TabBar
        show={show}
        onShow={setShow}
        hasRows={rows.length > 0}
        add={<AddButton label={t("masters.streams.add")} onClick={() => setSheet({ open: true })} />}
      />
      <ResponsiveList
        rows={filterByShow(rows, show)}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        label={t("masters.scrap.tabs.streams")}
        empty={emptyFor(
          show,
          rows.length > 0,
          t,
          <EmptyState
            title={t("masters.streams.empty")}
            body={t("masters.streams.emptyBody")}
            action={
              <SeedButton
                label={t("masters.streams.seed")}
                run={async () => {
                  const res = await seedStreams.mutateAsync();
                  await invalidate.streams();
                  return res.added;
                }}
              />
            }
          />,
        )}
      />
      <StreamSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </div>
  );
}

function Percent({ bp }: { bp: number | null }) {
  const text = percentText(bp);
  if (text === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span data-no-truncate="" className="font-mono tabular-nums">
      {text}
    </span>
  );
}
