import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Sort</span>
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
      ) : null}

      {isLoading ? (
        <LoadingCards />
      ) : pageRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-2">
          {emptyState ?? <DefaultEmpty />}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pageRows.map((row) => (
            <div key={rowKey(row)}>
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
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-xs text-muted-foreground">
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
  const visibleColumns = columns.filter((col) => col.header !== "");
  const actionColumns = columns.filter((col) => col.header === "" || col.id === "actions");
  const [primaryColumn, ...detailColumns] = visibleColumns;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPress) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPress();
    }
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors",
        onPress ? "cursor-pointer hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background" : "",
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
              <p className="m-0 text-[11px] font-semibold uppercase text-muted-foreground">
                {primaryColumn.header}
              </p>
              <div className="mt-1 min-w-0 text-sm font-semibold text-foreground">
                {asNode(primaryColumn.cell(row))}
              </div>
            </>
          ) : null}
        </div>
        {actionColumns.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            {actionColumns.map((col) => (
              <div key={col.id}>{asNode(col.cell(row))}</div>
            ))}
          </div>
        ) : null}
      </div>

      {detailColumns.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {detailColumns.map((col) => (
            <div key={col.id} className={cn("min-w-0", col.align === "right" ? "sm:text-right" : "")}>
              <p className="m-0 text-[11px] font-semibold uppercase text-muted-foreground">
                {col.header}
              </p>
              <div className="mt-1 min-w-0 text-sm text-foreground">{asNode(col.cell(row))}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function asNode(value: ReactNode): ReactNode {
  if (typeof value === "string" || typeof value === "number") {
    return <span className="text-sm text-foreground">{value}</span>;
  }
  return value;
}

function labelText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "column";
}

function LoadingCards() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading list">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
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
