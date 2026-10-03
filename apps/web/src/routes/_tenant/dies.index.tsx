import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileUp, Plus } from "lucide-react";
import { useState } from "react";

import { ListSearch } from "@/features/catalog/list-search";
import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { dieCode, rangeText } from "@/features/dies/die-display";
import { Can } from "@/shared/components/can";
import { ImportDiesModal } from "@/shared/components/import-dies-modal";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

const PAGE = 50;

type DiesSearch = { q?: string; offset?: number };

export const Route = createFileRoute("/_tenant/dies/")({
  validateSearch: (search: Record<string, unknown>): DiesSearch => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    offset: typeof search.offset === "number" && search.offset > 0 ? Math.floor(search.offset) : undefined,
  }),
  component: DiesList,
});

type DieRow = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  status: "active" | "archived";
  weightMinG: number;
  weightMaxG: number;
};

function DiesList() {
  const { t } = useT();
  const { data: me } = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [importing, setImporting] = useState(false);
  const q = search.q ?? "";
  const offset = search.offset ?? 0;

  const list = useQuery({
    ...trpc.die.list.queryOptions({ search: q || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const columns: ResponsiveListColumn<DieRow>[] = [
    {
      key: "code",
      header: t("dies.columns.code"),
      cell: (d) => (
        <span data-no-truncate="" className="font-mono whitespace-nowrap">
          {dieCode(d)}
        </span>
      ),
    },
    {
      key: "name",
      header: t("dies.columns.name"),
      cell: (d) => (d.name ? d.name : <span className="text-muted-foreground">{t("dies.unnamed")}</span>),
    },
    {
      key: "range",
      header: t("dies.columns.range"),
      align: "end",
      cell: (d) => (
        <span data-no-truncate="" className="font-mono whitespace-nowrap tabular-nums">
          {rangeText(t, d)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("dies.columns.status"),
      cell: (d) => <Chip tone={d.status === "active" ? "green" : "neutral"}>{t(`status.die.${d.status}`)}</Chip>,
    },
  ];

  const rows = (list.data?.items ?? []) as DieRow[];
  const searching = q !== "";

  return (
    <>
      <PageHeader
        title={t("dies.title")}
        subtitle={t("dies.subtitle")}
        actions={
          <>
            <HowToButton slug="edit-die" />
            <OverflowMenu
              items={
                can(me, "die.import")
                  ? [
                      {
                        key: "import",
                        label: t("dies.importCsv"),
                        icon: <FileUp aria-hidden="true" strokeWidth={2} />,
                        onSelect: () => setImporting(true),
                      },
                    ]
                  : []
              }
            />
            <Can do="die.create">
              <Button asChild>
                <Link to="/dies/$id" params={{ id: "new" }}>
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("dies.newDie")}
                </Link>
              </Button>
            </Can>
          </>
        }
      />

      <ListSearch
        label={t("dies.searchLabel")}
        placeholder={t("dies.search")}
        value={q}
        onSearch={(term) => navigate({ search: { q: term || undefined }, replace: true })}
        className="sm:max-w-[420px]"
      />

      <ResponsiveList
        label={t("dies.listLabel")}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        rowHref={(d) => `/dies/${d.id}`}
        total={list.data?.total}
        loading={list.isFetching}
        page={{
          offset,
          limit: PAGE,
          onChange: (next) => navigate({ search: (prev: DiesSearch) => ({ ...prev, offset: next || undefined }) }),
        }}
        empty={
          list.isError ? (
            <EmptyState
              title={t("errors.generic")}
              action={
                <Button variant="secondary" onClick={() => list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : searching ? (
            <EmptyState title={t("common.noResults", { query: q })} />
          ) : (
            <EmptyState
              title={t("dies.empty")}
              body={t("dies.emptyBody")}
              action={
                <Can do="die.create">
                  <Button asChild>
                    <Link to="/dies/$id" params={{ id: "new" }}>
                      {t("dies.emptyAction")}
                    </Link>
                  </Button>
                </Can>
              }
            />
          )
        }
      />

      {importing ? (
        <ImportDiesModal
          onClose={() => setImporting(false)}
          onSuccess={() => {
            setImporting(false);
            list.refetch();
          }}
        />
      ) : null}
    </>
  );
}
