import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { Paragraph, Stack, Text, XStack, YStack } from "@orrn/ui/lib/tg";

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
 * Cross-platform DataTable rendered as stacked rows of Tamagui Stacks. Works
 * the same on web and native. Sorting and pagination are client-side and
 * optional.
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

  return (
    <Stack
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={12}
      backgroundColor="$backgroundStrong"
      overflow="hidden"
      width="100%"
    >
      <Stack overflow="scroll" width="100%" className="orrn-data-table-scroll">
        <YStack minWidth={minTableWidth} width="100%">
      <XStack
        backgroundColor="$muted"
        paddingHorizontal={12}
        paddingVertical={10}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        gap={8}
      >
        {columns.map((col) => (
          <Stack
            key={col.id}
            flex={col.flex ?? 1}
            minWidth={col.minWidth}
            alignItems={
              col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start"
            }
          >
            {col.sortable ? (
              <Button
                variant="ghost"
                size="xs"
                paddingHorizontal={0}
                onPress={() => toggleSort(col.id)}
              >
                <Text fontSize={11} fontWeight="600" color="$mutedFg" textTransform="uppercase">
                  {col.header} {sort?.columnId === col.id ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                </Text>
              </Button>
            ) : (
              <Text fontSize={11} fontWeight="600" color="$mutedFg" textTransform="uppercase">
                {col.header}
              </Text>
            )}
          </Stack>
        ))}
      </XStack>

      {isLoading ? (
        <YStack padding={20} alignItems="center">
          <Paragraph color="$mutedFg" margin={0}>
            Loading…
          </Paragraph>
        </YStack>
      ) : pageRows.length === 0 ? (
        <YStack padding={4}>{emptyState ?? <DefaultEmpty />}</YStack>
      ) : (
        pageRows.map((row, idx) => (
          <XStack
            key={rowKey(row)}
            paddingHorizontal={12}
            paddingVertical={12}
            gap={8}
            borderBottomWidth={idx === pageRows.length - 1 ? 0 : 1}
            borderBottomColor="$borderColor"
            cursor={onRowPress ? "pointer" : undefined}
            hoverStyle={onRowPress ? { backgroundColor: "$backgroundHover" } : undefined}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
          >
            {columns.map((col) => (
              <Stack
                key={col.id}
                flex={col.flex ?? 1}
                minWidth={col.minWidth}
                alignItems={
                  col.align === "right"
                    ? "flex-end"
                    : col.align === "center"
                      ? "center"
                      : "flex-start"
                }
                justifyContent="center"
              >
                {asNode(col.cell(row))}
              </Stack>
            ))}
          </XStack>
        ))
      )}

      {pageSize && sortedRows.length > pageSize ? (
        <XStack
          padding={12}
          borderTopWidth={1}
          borderTopColor="$borderColor"
          alignItems="center"
          justifyContent="space-between"
          gap={12}
        >
          <Paragraph fontSize={12} color="$mutedFg" margin={0}>
            Page {safePage} of {totalPages} · {sortedRows.length} rows
          </Paragraph>
          <XStack gap={8}>
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
          </XStack>
        </XStack>
      ) : null}
      {footer}
        </YStack>
      </Stack>
    </Stack>
  );
}

function asNode(value: ReactNode): ReactNode {
  if (typeof value === "string" || typeof value === "number") {
    return (
      <Text fontSize={13} color="$color">
        {value}
      </Text>
    );
  }
  return value;
}

function DefaultEmpty() {
  return (
    <YStack padding={20} alignItems="center">
      <Paragraph color="$mutedFg" margin={0}>
        No rows.
      </Paragraph>
    </YStack>
  );
}
