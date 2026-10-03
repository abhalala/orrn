import { useT } from "@orrn/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { breakpoints, useMediaQuery } from "../hooks/use-media-query";
import { IconButton } from "./button";
import { UiLink } from "./link";
import { Skeleton } from "./skeleton";

export type ResponsiveListColumn<T> = {
  key: string;
  header: string;
  cell(row: T): ReactNode;
  /** Right-align (numbers, weights). */
  align?: "end";
  /** Leave out of the stacked phone row. The first column always shows. */
  hideOnPhone?: boolean;
};

export type ResponsiveListPage = { offset: number; limit: number; onChange(offset: number): void };

export type ResponsiveListProps<T> = {
  rows: T[];
  columns: ResponsiveListColumn<T>[];
  /** Makes each row one link (the whole row is the target). */
  rowHref?(row: T): string;
  /** Total rows on the server, for "1-50 of 312" (W8: never a silently truncated list). */
  total?: number;
  /** Server paging. Shows the range and Previous / Next. */
  page?: ResponsiveListPage;
  /** Shown when there are no rows and nothing is loading (an `EmptyState`). */
  empty: ReactNode;
  /** Skeleton rows on first load; dims existing rows while refetching. */
  loading?: boolean;
  /** Accessible name for the table or list ("Bundles"). Recommended. */
  label?: string;
  /** Stable key per row (default: index). */
  rowKey?(row: T): string;
  className?: string;
};

const SKELETON_ROWS = 5;

/**
 * One list, two layouts. From 1024px it is a real `<table>` with
 * `<th scope="col">` headers; below, a stacked list where each row shows its
 * first column as the title and the rest as label/value pairs. Only one of
 * the two is in the DOM, so screen readers never meet the rows twice.
 */
export function ResponsiveList<T>({
  rows,
  columns,
  rowHref,
  total,
  page,
  empty,
  loading = false,
  label,
  rowKey,
  className,
}: ResponsiveListProps<T>) {
  const { t } = useT();
  const wide = useMediaQuery(breakpoints.desktop);
  const firstLoad = loading && rows.length === 0;
  const isEmpty = !loading && rows.length === 0;
  const keyOf = (row: T, i: number) => rowKey?.(row) ?? String(i);
  const [first, ...rest] = columns;
  const phoneColumns = rest.filter((c) => !c.hideOnPhone);

  let body: ReactNode;
  if (isEmpty) {
    body = <div className="rounded-card border border-border bg-card">{empty}</div>;
  } else if (wide) {
    body = (
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table aria-label={label} aria-busy={loading || undefined} className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      "h-11 px-4 text-[13px] font-semibold whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5",
                      col.align === "end" ? "text-right" : "text-left",
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn(loading && !firstLoad && "opacity-60 transition-opacity")}>
              {firstLoad
                ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <tr key={i} aria-hidden="true" className="border-b border-border last:border-0">
                      {columns.map((col) => (
                        <td key={col.key} className="h-[52px] px-4 first:pl-5 last:pr-5">
                          <Skeleton className={cn("h-4", col.align === "end" ? "ml-auto w-14" : "w-3/4")} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row, i) => {
                    const href = rowHref?.(row);
                    return (
                      <tr
                        key={keyOf(row, i)}
                        className={cn(
                          "relative border-b border-border last:border-0",
                          href && "transition-colors duration-[var(--dur-fast)] hover:bg-surface-sunken/70",
                        )}
                      >
                        {columns.map((col, c) => (
                          <td
                            key={col.key}
                            className={cn(
                              "h-[52px] px-4 py-2 align-middle first:pl-5 last:pr-5",
                              col.align === "end" && "text-right tabular-nums",
                            )}
                          >
                            {c === 0 && href ? (
                              <UiLink
                                to={href}
                                className="font-semibold text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
                              >
                                {col.cell(row)}
                              </UiLink>
                            ) : (
                              col.cell(row)
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
    );
  } else {
    body = (
      <ul
        aria-label={label}
        aria-busy={loading || undefined}
        className={cn(
          "m-0 list-none divide-y divide-border overflow-hidden rounded-card border border-border bg-card p-0",
          loading && !firstLoad && "opacity-60 transition-opacity",
        )}
      >
        {firstLoad
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={i} aria-hidden="true" className="flex flex-col gap-2.5 px-4 py-3.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-1/2" />
              </li>
            ))
          : rows.map((row, i) => {
              const href = rowHref?.(row);
              const content = (
                <>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="min-w-0 text-[15px] font-semibold text-foreground [overflow-wrap:anywhere]">
                      {first?.cell(row)}
                    </span>
                    {phoneColumns.length ? (
                      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
                        {phoneColumns.map((col) => (
                          <div key={col.key} className="flex min-w-0 flex-col">
                            <dt className="text-[12px] font-medium text-muted-foreground">{col.header}</dt>
                            <dd className="m-0 min-w-0 text-[14px] text-foreground tabular-nums [overflow-wrap:anywhere]">
                              {col.cell(row)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </span>
                  {href ? (
                    <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
                  ) : null}
                </>
              );
              return (
                <li key={keyOf(row, i)}>
                  {href ? (
                    <UiLink
                      to={href}
                      className="animate-press flex min-h-16 items-center gap-3 px-4 py-3.5 text-inherit no-underline transition-colors duration-[var(--dur-fast)] focus-visible:-outline-offset-2 active:bg-surface-sunken"
                    >
                      {content}
                    </UiLink>
                  ) : (
                    <div className="flex min-h-16 items-center gap-3 px-4 py-3.5">{content}</div>
                  )}
                </li>
              );
            })}
      </ul>
    );
  }

  let footer: ReactNode = null;
  if (page && !isEmpty && !firstLoad) {
    const from = page.offset + 1;
    const to = page.offset + rows.length;
    const knownTotal = total ?? to;
    const atStart = page.offset <= 0;
    const atEnd = total !== undefined ? to >= total : rows.length < page.limit;
    footer = (
      <div className="flex items-center justify-between gap-3 pt-3">
        <p aria-live="polite" className="m-0 pl-1 text-[13px] font-medium text-muted-foreground tabular-nums">
          {t("common.pageRange", { from, to, total: knownTotal.toLocaleString("en-IN") })}
        </p>
        <nav aria-label={t("ui.pages")} className="flex gap-2">
          <IconButton
            variant="secondary"
            label={t("common.previousPage")}
            icon={<ChevronLeft strokeWidth={2} />}
            disabled={atStart}
            onClick={() => page.onChange(Math.max(0, page.offset - page.limit))}
          />
          <IconButton
            variant="secondary"
            label={t("common.nextPage")}
            icon={<ChevronRight strokeWidth={2} />}
            disabled={atEnd}
            onClick={() => page.onChange(page.offset + page.limit)}
          />
        </nav>
      </div>
    );
  }

  return (
    <div data-slot="responsive-list" data-layout={wide ? "table" : "stacked"} className={cn("min-w-0", className)}>
      {body}
      {footer}
    </div>
  );
}
