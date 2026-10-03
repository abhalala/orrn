import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";
import { NativeSelect } from "./native-select";
import { Skeleton } from "./skeleton";

export type DataTableColumn<Row> = {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  flex?: number;
  minWidth?: number;
  sortable?: boolean;
  sortValue?: (row: Row) => string | number | null | undefined;
};

export type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  renderCard?: (row: Row) => ReactNode;
  onRowPress?: (row: Row) => void;
  isLoading?: boolean;
  emptyState?: ReactNode;
  pageSize?: number;
  initialPage?: number;
  footer?: ReactNode;
};

/**
 * Container-aware card grid: as many columns as fit at >= 18rem each, so a
 * list inside a half-width panel never squeezes cards into slivers.
 */
const LIST_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3";

type SortState = { columnId: string; dir: "asc" | "desc" } | null;

/**
 * Web list surface. Sortable + paginated client-side. The native variant is
 * intentionally not provided — native list screens use FlatList directly.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  renderCard,
  onRowPress,
  isLoading,
  emptyState,
  pageSize = 12,
  initialPage = 1,
  footer,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(initialPage);
  const sortableColumns = useMemo(() => columns.filter((col) => col.sortable), [columns]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col) return rows;
    const getVal = col.sortValue ?? ((r: Row) => col.cell(r) as unknown as string | number);
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sort, columns]);

  useEffect(() => {
    setPage(initialPage);
  }, [initialPage, rows.length, sort]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = pageSize
    ? sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sortedRows;

  const toggleSort = (columnId: string) => {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, dir: "asc" };
      if (prev.dir === "asc") return { columnId, dir: "desc" };
      return null;
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {sortableColumns.length > 0 ? (
        <>
          {/* Phones: one compact sort picker instead of a wall of pills. */}
          <label className="flex items-center gap-3 sm:hidden">
            <span className="shrink-0 text-[13px] font-medium text-muted-foreground">Sort</span>
            <NativeSelect
              density="compact"
              value={sort ? `${sort.columnId}:${sort.dir}` : ""}
              onChange={(e) => {
                const [columnId, dir] = e.target.value.split(":");
                setSort(columnId ? { columnId, dir: dir === "desc" ? "desc" : "asc" } : null);
              }}
            >
              <option value="">Default order</option>
              {sortableColumns.map((col) => {
                const label = labelText(col.header);
                return [
                  <option key={`${col.id}:asc`} value={`${col.id}:asc`}>
                    {label}, ascending
                  </option>,
                  <option key={`${col.id}:desc`} value={`${col.id}:desc`}>
                    {label}, descending
                  </option>,
                ];
              })}
            </NativeSelect>
          </label>
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <span className="text-[13px] font-medium text-muted-foreground">Sort</span>
            {sortableColumns.map((col) => {
              const active = sort?.columnId === col.id;
              const label = labelText(col.header);
              return (
                <Button
                  key={col.id}
                  variant={active ? "secondary" : "outline"}
                  size="sm"
                  aria-label={`Sort by ${label}`}
                  onPress={() => toggleSort(col.id)}
                >
                  {col.header}
                  {active ? <span aria-hidden="true">{sort.dir === "asc" ? "Asc" : "Desc"}</span> : null}
                </Button>
              );
            })}
          </div>
        </>
      ) : null}

      {isLoading ? (
        <LoadingCards />
      ) : pageRows.length === 0 ? (
        <div className="rounded-card border border-dashed border-control/60 bg-card p-2">
          {emptyState ?? <DefaultEmpty />}
        </div>
      ) : (
        <div className={LIST_GRID}>
          {pageRows.map((row) => (
            <div key={rowKey(row)} className="min-w-0">
              {renderCard ? (
                renderCard(row)
              ) : (
                <CardListItem
                  columns={columns}
                  row={row}
                  onPress={onRowPress ? () => onRowPress(row) : undefined}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {pageSize && sortedRows.length > pageSize ? (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-[13px] text-muted-foreground">
            Page {safePage} of {totalPages} · showing {(safePage - 1) * pageSize + 1}-
            {Math.min(safePage * pageSize, sortedRows.length)} of {sortedRows.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
      {footer}
    </div>
  );
}

function CardListItem<Row>({
  columns,
  row,
  onPress,
}: {
  columns: DataTableColumn<Row>[];
  row: Row;
  onPress?: () => void;
}) {
  const actionColumns = columns.filter((col) => col.header === "" || col.id === "actions");
  const statusColumn = columns.find((col) => col.id === "status" && col.header !== "");
  const visibleColumns = columns.filter(
    (col) => col.header !== "" && col.id !== "actions" && col !== statusColumn,
  );
  const [primaryColumn, ...detailColumns] = visibleColumns;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPress) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPress();
    }
  };

  // Phone-first card: the key value leads (with its status chip on the same
  // line), then the secondary facts in a compact label-over-value grid.
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm transition-[background-color,border-color,transform] duration-[var(--dur-fast)]",
        onPress ? "cursor-pointer hover:border-control/60 active:scale-[0.99]" : "",
      )}
      role={onPress ? "button" : undefined}
      tabIndex={onPress ? 0 : undefined}
      onClick={onPress}
      onKeyDown={onKeyDown}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {primaryColumn ? (
            <>
              <p className="sr-only">{primaryColumn.header}</p>
              <div className="min-w-0 truncate text-[15px] font-semibold leading-6 text-foreground">
                {asNode(primaryColumn.cell(row))}
              </div>
            </>
          ) : null}
        </div>
        {statusColumn || actionColumns.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            {statusColumn ? <div>{asNode(statusColumn.cell(row))}</div> : null}
            {actionColumns.map((col) => (
              <div key={col.id}>{asNode(col.cell(row))}</div>
            ))}
          </div>
        ) : null}
      </div>

      {detailColumns.length > 0 ? (
        // Phones show the first three facts in one row; wider cards show all.
        <dl className="m-0 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2.5 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] max-sm:[&>div:nth-child(n+4)]:hidden">
          {detailColumns.map((col) => (
            <div key={col.id} className="min-w-0">
              <dt className="break-words text-xs font-medium text-muted-foreground">{col.header}</dt>
              <FactValue value={col.cell(row)} />
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * A card fact value. Numbers and phrases ("AL / ROUND-10", "Oct 3, 2026")
 * wrap at spaces and are never ellipsised: touch users can't hover for a
 * title. Only a single unbroken token too long for the cell (a long PO or
 * reference) gets an ellipsis, with the full value in `title`.
 */
function FactValue({ value }: { value: ReactNode }) {
  const base = "m-0 mt-0.5 min-w-0 text-sm text-foreground";
  if (typeof value === "number" || (typeof value === "string" && /^[\d\s.,:/+-]*$/.test(value))) {
    return (
      <dd data-no-truncate="" className={cn(base, "break-words tabular-nums")}>
        {value}
      </dd>
    );
  }
  if (typeof value === "string" && !/\s/.test(value)) {
    return (
      <dd title={value} className={cn(base, "truncate")}>
        {value}
      </dd>
    );
  }
  if (typeof value === "string") {
    return (
      <dd data-no-truncate="" className={cn(base, "break-words")}>
        {value}
      </dd>
    );
  }
  return <dd className={cn(base, "break-words")}>{value}</dd>;
}

function asNode(value: ReactNode, truncate = true): ReactNode {
  if (typeof value === "string" || typeof value === "number") {
    return truncate ? (
      <span className="truncate" title={String(value)}>
        {value}
      </span>
    ) : (
      <span>{value}</span>
    );
  }
  return value;
}

function labelText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "column";
}

function LoadingCards() {
  return (
    <div className={LIST_GRID} aria-label="Loading list">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
          <Skeleton className="h-4 w-1/2" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DefaultEmpty() {
  return (
    <div className="flex items-center justify-center p-5">
      <p className="m-0 text-sm text-muted-foreground">No items.</p>
    </div>
  );
}
