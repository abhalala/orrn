import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { PlantListSheet } from "./adm-list-sheet";
import { PLANT_LIST_KINDS, type PlantListKind } from "./adm-search";
import { useAdmAccess, useAdmInvalidate, type PlantListRow } from "./adm-use";
import { ActiveStatus, filterByShow, MasterNote, MastersLoadError, RowEdit, SeedButton, ShowFilter, type Show } from "./masters-ui";

/**
 * Plant lists (route /masters/lists?kind=): departments, designations, modes of packing and die
 * categories, one tab each. Publishers add, rename and retire entries, or add the standard ones in
 * one go. A die category also carries the weight a die of that category is expected to push.
 */
export function PlantListsPage({ kind, onKind }: { kind: PlantListKind; onKind(kind: PlantListKind): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const access = useAdmAccess();
  const invalidate = useAdmInvalidate();
  const list = useQuery(trpc.masters.lists.list.queryOptions());
  const starters = useMutation(trpc.masters.lists.addStarters.mutationOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: PlantListRow }>({ open: false });

  const rows = (list.data ?? []).filter((r) => r.kind === kind);
  const shown = filterByShow(rows, show);

  const columns: ResponsiveListColumn<PlantListRow>[] = [
    {
      key: "name",
      header: t("adm.masters.lists.columns.name"),
      cell: (r) => (
        <RowEdit editable={access.canPublish} label={r.name} onEdit={() => setSheet({ open: true, row: r })}>
          {r.name}
        </RowEdit>
      ),
    },
    ...(kind === "die_category"
      ? [
          {
            key: "life",
            header: t("adm.masters.lists.columns.life"),
            align: "end" as const,
            cell: (r: PlantListRow) =>
              r.expectedLifeG ? (
                <span className="font-mono tabular-nums">
                  {kgGrouped1(fmt, r.expectedLifeG)} {massUnit(fmt)}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("adm.masters.lists.lifeNone")}</span>
              ),
          },
        ]
      : []),
    { key: "status", header: t("masters.reasons.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("adm.masters.title")}
        subtitle={t("adm.masters.lists.subtitle")}
        actions={
          <Can do="masters.publish">
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("adm.masters.lists.add")}
            </Button>
          </Can>
        }
      />
      {!access.canPublish ? <MasterNote body={t("masters.readOnly")} /> : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <Tabs
          label={t("adm.masters.lists.kindsLabel")}
          value={kind}
          onValueChange={(v) => onKind(v as PlantListKind)}
          items={PLANT_LIST_KINDS.map((k) => ({ id: k, label: t(`adm.kinds.${k}`) }))}
        >
          <div className="flex min-w-0 flex-col gap-4">
            {rows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ShowFilter value={show} onChange={setShow} />
              </div>
            ) : null}
            <ResponsiveList
              rows={shown}
              columns={columns}
              rowKey={(r) => r.id}
              loading={list.isLoading}
              label={t(`adm.kinds.${kind}`)}
              empty={
                <EmptyState
                  title={rows.length > 0 ? (show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")) : t("adm.masters.lists.empty", { kind: t(`adm.kinds.${kind}`) })}
                  body={rows.length === 0 ? t("adm.masters.lists.emptyBody") : undefined}
                  action={
                    rows.length === 0 ? (
                      <SeedButton
                        label={t("adm.masters.lists.seed")}
                        run={async () => {
                          const r = await starters.mutateAsync({ kind });
                          await invalidate.lists();
                          return r.added;
                        }}
                      />
                    ) : undefined
                  }
                />
              }
            />
          </div>
        </Tabs>
      )}
      <PlantListSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} kind={kind} row={sheet.row} />
    </>
  );
}
