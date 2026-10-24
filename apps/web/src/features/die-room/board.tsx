import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, FileUp, Hammer, Plus } from "lucide-react";
import { useState } from "react";

import { ListSearch } from "@/features/catalog/list-search";
import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { dieCode, rangeText } from "@/features/dies/die-display";
import { Can } from "@/shared/components/can";
import { ImportDiesModal } from "@/shared/components/import-dies-modal";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { WorstToneChip } from "./drift-chips";
import type { DriftTone } from "./die-room-model";

const PAGE = 50;

type Row = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  status: "active" | "archived";
  weightMinG: number;
  weightMaxG: number;
  profileKind: "hollow" | "solid" | "semi" | null;
  alloy: string | null;
  temper: string | null;
  copyCount: number;
  ownerName: string | null;
  worstTone: DriftTone;
};

export type BoardProps = {
  q: string;
  offset: number;
  onSearch(term: string): void;
  onPage(offset: number): void;
};

/** `/dies`: every section with its copies counted and the worst drift among the copies on the rack. */
export function DieRoomBoard({ q, offset, onSearch, onPage }: BoardProps) {
  const { t } = useT();
  const { data: me } = useMe();
  const [importing, setImporting] = useState(false);

  const list = useQuery({
    ...trpc.die.list.queryOptions({ search: q || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "code",
      header: t("dies.columns.code"),
      cell: (d) => (
        <span className="flex min-w-0 flex-col">
          <span data-no-truncate="" className="font-mono whitespace-nowrap">
            {dieCode(d)}
          </span>
          {d.name ? <span className="text-[13px] text-muted-foreground">{d.name}</span> : null}
        </span>
      ),
    },
    {
      key: "shape",
      header: t("dieRoom.board.columns.shape"),
      hideOnPhone: true,
      cell: (d) => {
        const parts = [d.profileKind ? t(`dieRoom.card.${d.profileKind}`) : null, [d.alloy, d.temper].filter(Boolean).join(" ") || null].filter(Boolean);
        return parts.length ? parts.join(" · ") : <span className="text-muted-foreground">{"—"}</span>;
      },
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
      key: "owner",
      header: t("dieRoom.board.columns.owner"),
      cell: (d) => (d.ownerName ? <span className="font-semibold">{d.ownerName}</span> : <span className="text-muted-foreground">{t("dieRoom.board.plantOwned")}</span>),
    },
    {
      key: "copies",
      header: t("dieRoom.board.columns.copies"),
      align: "end",
      cell: (d) => (
        <span data-no-truncate="" className="tabular-nums">
          {d.copyCount === 0 ? <span className="text-muted-foreground">{t("dieRoom.board.noCopies")}</span> : d.copyCount}
        </span>
      ),
    },
    {
      key: "drift",
      header: t("dieRoom.board.columns.drift"),
      cell: (d) => (d.copyCount === 0 ? <span className="text-muted-foreground">{"—"}</span> : <WorstToneChip tone={d.worstTone} />),
    },
  ];

  const rows = (list.data?.items ?? []) as unknown as Row[];
  const searching = q !== "";
  const importItem = can(me, "die.import")
    ? [
        {
          key: "import",
          label: t("dies.importCsv"),
          icon: <FileUp aria-hidden="true" strokeWidth={2} />,
          onSelect: () => setImporting(true),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={t("dies.title")}
        subtitle={t("dies.subtitle")}
        actions={
          <>
            <HowToButton slug="edit-die" />
            <OverflowMenu items={importItem} />
            <Button asChild variant="secondary">
              <Link to="/dies/issues">
                <ArrowLeftRight aria-hidden="true" strokeWidth={2} />
                {t("dieRoom.board.issueLink")}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/dies/makers">
                <Hammer aria-hidden="true" strokeWidth={2} />
                {t("dieRoom.board.makersLink")}
              </Link>
            </Button>
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

      <div className="flex flex-col gap-1.5">
        <ListSearch
          label={t("dies.searchLabel")}
          placeholder={t("dieRoom.board.searchHint")}
          value={q}
          onSearch={onSearch}
          className="sm:max-w-[420px]"
        />
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.board.slashHint")}</p>
      </div>

      <ResponsiveList
        label={t("dies.listLabel")}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        rowHref={(d) => `/dies/${d.id}`}
        total={list.data?.total}
        loading={list.isFetching}
        page={{ offset, limit: PAGE, onChange: onPage }}
        empty={
          list.isError ? (
            <EmptyState
              title={t("dieRoom.board.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : offset > 0 ? (
            <EmptyState
              title={t("dies.pageEmpty")}
              action={
                <Button asChild variant="secondary">
                  <Link to="/dies" search={{ q: q || undefined }}>
                    {t("dies.firstPage")}
                  </Link>
                </Button>
              }
            />
          ) : searching ? (
            <EmptyState title={t("common.noResults", { query: q })} body={t("dieRoom.board.noMatchBody")} />
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
