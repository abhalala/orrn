import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";

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
  onRowPress?: (row: Row) => void;
  isLoading?: boolean;
  emptyState?: ReactNode;
  pageSize?: number;
  initialPage?: number;
  footer?: ReactNode;
};

type SortState = { columnId: string; dir: "asc" | "desc" } | null;

/**
 * Web DataTable. Sortable + paginated client-side. The native variant is
 * intentionally not provided — native list screens use FlatList directly.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowPress,
  isLoading,
  emptyState,
  pageSize,
  initialPage = 1,
  footer,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(initialPage);

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

  const minTableWidth = useMemo(
    () => columns.reduce((sum, col) => sum + (col.minWidth ?? 88), 0),
    [columns],
  );

  const alignClass = (a?: "left" | "right" | "center") =>
    a === "right" ? "justify-end" : a === "center" ? "justify-center" : "justify-start";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-card">
      <div className="orrn-data-table-scroll w-full overflow-x-auto">
        <div className="flex w-full flex-col" style={{ minWidth: minTableWidth }}>
          <div className="flex flex-row items-center gap-2 border-b border-border bg-muted px-3 py-2.5">
            {columns.map((col) => (
              <div
                key={col.id}
                className={cn("flex items-center", alignClass(col.align))}
                style={{ flex: col.flex ?? 1, minWidth: col.minWidth }}
              >
                {col.sortable ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="!px-0"
                    onPress={() => toggleSort(col.id)}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {col.header} {sort?.columnId === col.id ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </Button>
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {col.header}
                  </span>
                )}
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-5">
              <p className="m-0 text-sm text-muted-foreground">Loading…</p>
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-1">{emptyState ?? <DefaultEmpty />}</div>
          ) : (
            pageRows.map((row, idx) => (
              <div
                key={rowKey(row)}
                onClick={onRowPress ? () => onRowPress(row) : undefined}
                className={cn(
                  "flex flex-row items-stretch gap-2 px-3 py-3",
                  idx === pageRows.length - 1 ? "" : "border-b border-border",
                  onRowPress ? "cursor-pointer hover:bg-accent/30" : "",
                )}
              >
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className={cn("flex items-center", alignClass(col.align))}
                    style={{ flex: col.flex ?? 1, minWidth: col.minWidth }}
                  >
                    {asNode(col.cell(row))}
                  </div>
                ))}
              </div>
            ))
          )}

          {pageSize && sortedRows.length > pageSize ? (
            <div className="flex items-center justify-between gap-3 border-t border-border p-3">
              <p className="m-0 text-xs text-muted-foreground">
                Page {safePage} of {totalPages} · {sortedRows.length} rows
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
      </div>
    </div>
  );
}

function asNode(value: ReactNode): ReactNode {
  if (typeof value === "string" || typeof value === "number") {
    return <span className="text-sm text-foreground">{value}</span>;
  }
  return value;
}

function DefaultEmpty() {
  return (
    <div className="flex items-center justify-center p-5">
      <p className="m-0 text-sm text-muted-foreground">No rows.</p>
    </div>
  );
}
