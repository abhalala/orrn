import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Select } from "@orrn/ui/components/select";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, FileUp, Hammer, Paperclip, Plus } from "lucide-react";
import { useState } from "react";

import { ListSearch } from "@/features/catalog/list-search";
import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { dieCode } from "@/features/dies/die-display";
import { Can } from "@/shared/components/can";
import { ImportSheet } from "@/features/imports/import-sheet";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  BOARD_KINDS,
  BOARD_SORTS,
  BOARD_TILES,
  boardListInput,
  copyListInput,
  hasBoardFilters,
  tileCount,
  tilePatch,
  type BoardFilters,
  type BoardKind,
  type BoardOwner,
  type BoardSort,
  type BoardTile,
} from "./board-model";
import { BulkDrawingsSheet } from "./bulk-drawings";
import { TrialSetting } from "./trial-setting";
import { WorstToneChip } from "./drift-chips";
import { formatBand, type DriftTone } from "./die-room-model";

const PAGE = 50;

type CopyRow = {
  id: string;
  code: string;
  sectionSeries: string;
  /** The copy's own band as the server writes it (`2.700-2.900`, or the band's label). */
  bandText: string;
};

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
  tile?: BoardTile;
  kind?: BoardKind;
  owner?: BoardOwner;
  sort: BoardSort;
  onSearch(term: string): void;
  onPage(offset: number): void;
  /** Change a filter or the sort; the page goes back to the first. */
  onFilter(patch: { tile?: BoardTile | undefined; kind?: BoardKind | undefined; owner?: BoardOwner | undefined; sort?: BoardSort | undefined; offset?: undefined }): void;
  onClear(): void;
};

/**
 * `/dies`: every section with its copies counted and the worst drift among the copies on the rack. A
 * copy-status tile counts copies, so pressing it lists those copies (each opens its card).
 */
export function DieRoomBoard({ q, offset, tile, kind, owner, sort, onSearch, onPage, onFilter, onClear }: BoardProps) {
  const { t } = useT();
  const { data: me } = useMe();
  const [importing, setImporting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const filters: BoardFilters = { q, tile, kind, owner, sort };

  const copyInput = copyListInput(filters, { limit: PAGE, offset });
  const sectionList = useQuery({
    ...trpc.die.list.queryOptions(boardListInput(filters, { limit: PAGE, offset })),
    enabled: copyInput === null,
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });
  const copyList = useQuery({
    ...trpc.dieInstance.list.queryOptions(copyInput ?? { limit: PAGE, offset }),
    enabled: copyInput !== null,
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });
  const counts = useQuery({ ...trpc.die.boardCounts.queryOptions(), meta: INLINE_ERROR_META });

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
      header: t("dieRoom.board.columns.band"),
      align: "end",
      // On a phone the band takes the whole row, so it never runs into the owner beside it.
      phoneWide: true,
      cell: (d) => (
        <span data-no-truncate="" data-testid="board-band" className="font-mono whitespace-nowrap tabular-nums">
          {formatBand(d.weightMinG, d.weightMaxG, t("units.kgPer12ft"))}
        </span>
      ),
    },
    {
      key: "owner",
      header: t("dieRoom.board.columns.owner"),
      cell: (d) => (
        <span data-testid="board-owner" className={d.ownerName ? "font-semibold" : "text-muted-foreground"}>
          {d.ownerName ?? t("dieRoom.board.plantOwned")}
        </span>
      ),
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

  const copyColumns: ResponsiveListColumn<CopyRow>[] = [
    {
      key: "copy",
      header: t("dieRoom.board.columns.copy"),
      cell: (c) => (
        <span data-no-truncate="" className="font-mono whitespace-nowrap">
          {c.code}
        </span>
      ),
    },
    { key: "series", header: t("dieRoom.board.columns.series"), cell: (c) => c.sectionSeries },
    {
      key: "range",
      header: t("dieRoom.board.columns.band"),
      align: "end",
      phoneWide: true,
      cell: (c) => (
        <span data-no-truncate="" data-testid="copy-band" className="font-mono whitespace-nowrap tabular-nums">
          {/^\d/.test(c.bandText) ? `${c.bandText} ${t("units.kgPer12ft")}` : c.bandText}
        </span>
      ),
    },
  ];

  const rows = (sectionList.data?.items ?? []) as unknown as Row[];
  const copyRows = (copyList.data?.items ?? []) as unknown as CopyRow[];
  const searching = q !== "";
  const filtered = hasBoardFilters(filters);
  const menu = [
    ...(can(me, "die.import")
      ? [
          {
            key: "import",
            label: t("dies.importCsv"),
            icon: <FileUp aria-hidden="true" strokeWidth={2} />,
            onSelect: () => setImporting(true),
          },
        ]
      : []),
    ...(can(me, "die.card") || can(me, "masters.publish")
      ? [
          {
            key: "attach",
            label: t("dieRoom.bulk.menu"),
            icon: <Paperclip aria-hidden="true" strokeWidth={2} />,
            onSelect: () => setAttaching(true),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("dies.title")}
        subtitle={t("dies.subtitle")}
        actions={
          <>
            <HowToButton slug="edit-die" />
            <OverflowMenu items={menu} />
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

      {counts.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" role="group" aria-label={t("dieRoom.board.tilesLabel")} data-testid="board-tiles">
          {BOARD_TILES.map((id) => (
            <TileButton
              key={id}
              id={id}
              count={tileCount(id, counts.data)}
              pressed={tile === id}
              onPress={() => onFilter(tilePatch(tile, id))}
            />
          ))}
        </div>
      ) : null}

      {copyInput ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 min-w-0 flex-1 text-[14px] leading-5 text-muted-foreground" data-testid="board-copies-note">
            {t("dieRoom.board.copiesNote")}
          </p>
          <Button variant="secondary" onClick={onClear}>
            {t("dieRoom.board.clearFilters")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t("dieRoom.board.filtersLabel")}>
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            {t("dieRoom.card.profileKind")}
            <Select
              aria-label={t("dieRoom.card.profileKind")}
              value={kind ?? "all"}
              onValueChange={(v) => onFilter({ kind: v === "all" ? undefined : (v as BoardKind), offset: undefined })}
              options={[
                { value: "all", label: t("dieRoom.board.filter.all") },
                ...BOARD_KINDS.map((k) => ({ value: k, label: t(`dieRoom.card.${k}`) })),
              ]}
              width={170}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            {t("dieRoom.board.columns.owner")}
            <Select
              aria-label={t("dieRoom.board.columns.owner")}
              value={owner ?? "all"}
              onValueChange={(v) => onFilter({ owner: v === "all" ? undefined : (v as BoardOwner), offset: undefined })}
              options={[
                { value: "all", label: t("dieRoom.board.filter.all") },
                { value: "plant", label: t("dieRoom.board.plantOwned") },
                { value: "customer", label: t("dieRoom.board.filter.customerOwned") },
              ]}
              width={190}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            {t("dieRoom.board.sortLabel")}
            <Select
              aria-label={t("dieRoom.board.sortLabel")}
              value={sort}
              onValueChange={(v) => onFilter({ sort: v === "newest" ? undefined : (v as BoardSort), offset: undefined })}
              options={BOARD_SORTS.map((s) => ({ value: s, label: t(`dieRoom.board.sort.${s}`) }))}
              width={190}
            />
          </label>
          {filtered ? (
            <Button variant="secondary" onClick={onClear}>
              {t("dieRoom.board.clearFilters")}
            </Button>
          ) : null}
        </div>
      )}

      {copyInput ? (
        <ResponsiveList
          label={t("dieRoom.board.copiesLabel")}
          rows={copyRows}
          columns={copyColumns}
          rowKey={(c) => c.id}
          rowHref={(c) => `/dies/copies/${c.id}`}
          total={copyList.data?.total}
          loading={copyList.isFetching}
          page={{ offset, limit: PAGE, onChange: onPage }}
          empty={
            copyList.isError ? (
              <EmptyState
                title={t("dieRoom.board.loadFailed")}
                action={
                  <Button variant="secondary" onClick={() => copyList.refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : offset > 0 ? (
              <EmptyState
                title={t("dies.pageEmpty")}
                action={
                  <Button variant="secondary" onClick={() => onPage(0)}>
                    {t("dies.firstPage")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t("dieRoom.board.noCopiesInState")}
                body={t("dieRoom.board.noCopiesInStateBody")}
                action={
                  <Button variant="secondary" onClick={onClear}>
                    {t("dieRoom.board.clearFilters")}
                  </Button>
                }
              />
            )
          }
        />
      ) : (
        <ResponsiveList
          label={t("dies.listLabel")}
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          rowHref={(d) => `/dies/${d.id}`}
          total={sectionList.data?.total}
          loading={sectionList.isFetching}
          page={{ offset, limit: PAGE, onChange: onPage }}
          empty={
            sectionList.isError ? (
              <EmptyState
                title={t("dieRoom.board.loadFailed")}
                action={
                  <Button variant="secondary" onClick={() => sectionList.refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : offset > 0 ? (
              <EmptyState
                title={t("dies.pageEmpty")}
                action={
                  <Button variant="secondary" onClick={() => onPage(0)}>
                    {t("dies.firstPage")}
                  </Button>
                }
              />
            ) : filtered && !searching ? (
              <EmptyState
                title={t("dieRoom.board.noFilterMatch")}
                body={t("dieRoom.board.noFilterMatchBody")}
                action={
                  <Button variant="secondary" onClick={onClear}>
                    {t("dieRoom.board.clearFilters")}
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
      )}

      <TrialSetting />

      <ImportSheet
        kind="dies"
        open={importing}
        onOpenChange={setImporting}
        onImported={() => {
          void sectionList.refetch();
          void copyList.refetch();
          void counts.refetch();
        }}
      />
      <BulkDrawingsSheet open={attaching} onOpenChange={setAttaching} />
    </>
  );
}

/** One tile of the board: a count, pressed to filter the list to it. */
function TileButton({ id, count, pressed, onPress }: { id: BoardTile; count: number; pressed: boolean; onPress(): void }) {
  const { t } = useT();
  const label = t(`dieRoom.board.tiles.${id}`);
  const warm = id === "on_trial" && count > 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={`tile-${id}`}
      onClick={onPress}
      className={[
        "flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-card border px-3 py-2 text-left transition-[border-color,background-color] duration-[var(--dur-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        pressed ? "border-foreground bg-surface-sunken" : "border-border bg-card hover:border-foreground/60",
        warm && !pressed ? "bg-tone-amber-tint" : "",
      ].join(" ")}
    >
      <span data-no-truncate="" className="font-mono text-[24px] leading-none font-semibold tabular-nums">
        {count.toLocaleString("en-IN")}
      </span>
      <span className="text-[13px] leading-4 font-medium text-muted-foreground">{label}</span>
    </button>
  );
}
