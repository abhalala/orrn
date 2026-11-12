import { useT } from "@orrn/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { breakpoints, useMediaQuery } from "../hooks/use-media-query";
import { IconButton } from "./button";
import { UiLink } from "./link";
import { Skeleton } from "./skeleton";

export type ResponsiveListColumn<T> = {
  key: string;
  header: string;
  /**
   * Cell content. Text wraps at word boundaries; keep serials and codes on
   * one line (`font-mono whitespace-nowrap`) so they never split mid-code.
   */
  cell(row: T): ReactNode;
  /** Right-align (numbers, weights). */
  align?: "end";
  /** Leave out of the stacked phone row. The first column always shows. */
  hideOnPhone?: boolean;
  /**
   * Give the value two grid columns in the stacked phone row (a status chip
   * with a long word, "Waiting for approval"), so it never has to be cut.
   */
  phoneWide?: boolean;
  /**
   * The header is for screen readers only (an actions column of buttons):
   * visually hidden in the table head, no visible label in the phone row,
   * and a row whose cell is empty (null) leaves the pair out on a phone.
   */
  headerHidden?: boolean;
  /**
   * A fixed width for the column in the table (a Tailwind width class, `w-24`). Any column with a width makes the table
   * `table-fixed`: columns keep their x position, so several groups line up, and the headers may wrap onto two lines.
   * The one column without a width takes the rest.
   */
  width?: string;
  /** Tighter side padding (8 px) for a narrow numeric column, so a fixed width of 60 to 90 px still fits its header word. */
  compact?: boolean;
  /** Let the header text wrap onto a second line instead of holding the column open (a long header over a number). */
  wrapHeader?: boolean;
  /**
   * Pin the column to the left edge while the table scrolls sideways (a row number, so a wide table keeps its anchor).
   * Only the first column should use it.
   */
  sticky?: boolean;
  /** In the stacked phone row, leave the label/value pair out when this row's cell is empty (null). */
  hideWhenEmpty?: boolean;
};

/** A group of rows under a full-width heading, inside the same card and under the same column header. */
export type ResponsiveListSection<T> = { key: string; heading: ReactNode; rows: T[] };

export type ResponsiveListPage = { offset: number; limit: number; onChange(offset: number): void };

export type ResponsiveListProps<T> = {
  rows?: T[];
  /**
   * Groups in one card. Each section shows its `heading` as a full-width row, then its rows. The table header shows
   * once at the top. When this is set `rows` is ignored. No paging.
   */
  sections?: ResponsiveListSection<T>[];
  columns: ResponsiveListColumn<T>[];
  /**
   * Makes each row one link: the first column's content becomes the link and
   * a stretched pseudo-element makes the whole row clickable. Buttons, links
   * and inputs inside the other cells are lifted above it (`relative z-[1]`),
   * so they keep working; keep the first column free of interactive content.
   */
  rowHref?(row: T): string;
  /**
   * Total rows on the server, for "1-50 of 312" (W8: never a silently
   * truncated list). Pass it whenever the API returns it; without it the
   * pager can only say "1-50".
   */
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

/** Raise interactive things in a cell above the row's stretched link (globals.css). */
const LIFT_INTERACTIVE = "orrn-row-lift";

/** Phone rows: same lift, but only inside the label/value grid (the title holds the row link). */
const LIFT_INTERACTIVE_REST = "orrn-row-lift-dl";

/** A pinned column: an opaque card background so the cells that scroll under it do not show through. */
const STICKY_CELL = "sticky left-0 z-[1] bg-card";

const STRETCHED_LINK =
  "no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid";

/**
 * One list, two layouts. From 1024px it is a real `<table>` with
 * `<th scope="col">` headers; below, a stacked list where each row shows its
 * first column as the title and the rest as label/value pairs. Only one of
 * the two is in the DOM, so screen readers never meet the rows twice.
 */
export function ResponsiveList<T>({
  rows: rowsProp,
  sections,
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
  const rows = sections ? sections.flatMap((section) => section.rows) : (rowsProp ?? []);
  const firstLoad = loading && rows.length === 0;
  const isEmpty = !loading && rows.length === 0;
  const fixed = columns.some((col) => col.width);
  const keyOf = (row: T, i: number) => rowKey?.(row) ?? String(i);
  const [first, ...rest] = columns;
  const phoneColumns = rest.filter((c) => !c.hideOnPhone);

  const tableRow = (row: T, i: number) => {
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
              "h-[52px] py-2 align-middle break-words first:pl-5 last:pr-5",
              col.compact ? "px-2" : "px-4",
              col.align === "end" && "text-right whitespace-nowrap tabular-nums",
              col.sticky && STICKY_CELL,
              href && c > 0 && LIFT_INTERACTIVE,
            )}
          >
            {c === 0 && href ? (
              <UiLink to={href} className={cn("font-semibold text-foreground", STRETCHED_LINK)}>
                {col.cell(row)}
              </UiLink>
            ) : (
              col.cell(row)
            )}
          </td>
        ))}
      </tr>
    );
  };

  const stackedRow = (row: T, i: number) => {
    const href = rowHref?.(row);
    return (
      <li
        key={keyOf(row, i)}
        className={cn(
          "relative flex min-h-16 items-center gap-3 px-4 py-3.5",
          href &&
            "animate-press transition-[background-color,scale] duration-[var(--dur-fast)] active:bg-surface-sunken has-[a:focus-visible]:bg-surface-sunken/60",
        )}
      >
        <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", href && LIFT_INTERACTIVE_REST)}>
          <div className="min-w-0 text-[15px] font-semibold text-foreground break-words">
            {href ? (
              <UiLink to={href} className={cn("text-inherit", STRETCHED_LINK)}>
                {first?.cell(row)}
              </UiLink>
            ) : (
              first?.cell(row)
            )}
          </div>
          {phoneColumns.length ? (
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
              {phoneColumns.map((col) => {
                const content = col.cell(row);
                const empty = content === null || content === undefined || content === false;
                // An empty cell leaves no label-only pair: an actions column with nothing, a count not known yet.
                if ((col.headerHidden || col.hideWhenEmpty) && empty) return null;
                return (
                  <div key={col.key} className={cn("flex min-w-0 flex-col", (col.phoneWide || col.headerHidden) && "col-span-2")}>
                    <dt
                      // A hidden label is sr-only. A shown one wraps: `title` is not there on touch (WCAG 1.4.4, 1.4.10).
                      className={col.headerHidden ? "sr-only" : "text-[12px] leading-4 font-medium break-words text-muted-foreground"}
                    >
                      {col.header}
                    </dt>
                    <dd className="m-0 min-w-0 text-[14px] text-foreground tabular-nums break-words">{content}</dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </div>
        {href ? <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" /> : null}
      </li>
    );
  };

  let body: ReactNode;
  if (isEmpty) {
    body = <div className="rounded-card border border-border bg-card">{empty}</div>;
  } else if (wide) {
    body = (
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="relative overflow-x-auto">
          <table aria-label={label} aria-busy={loading || undefined} className={cn("w-full border-collapse text-[14px]", fixed && "table-fixed")}>
            {fixed ? (
              <colgroup>
                {columns.map((col) => (
                  <col key={col.key} className={col.width} />
                ))}
              </colgroup>
            ) : null}
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      "h-11 text-[13px] font-semibold text-muted-foreground first:pl-5 last:pr-5",
                      col.compact ? "px-2" : "px-4",
                      col.width || col.wrapHeader ? "leading-4 break-words" : "whitespace-nowrap",
                      col.align === "end" ? "text-right" : "text-left",
                      col.sticky && STICKY_CELL,
                    )}
                  >
                    {col.headerHidden ? <span className="sr-only">{col.header}</span> : col.header}
                  </th>
                ))}
              </tr>
            </thead>
            {sections ? (
              sections.map((section) => (
                <tbody key={section.key} className="border-t border-border first:border-t-0">
                  <tr className="border-b border-border bg-surface-sunken/60">
                    <td colSpan={columns.length} className="px-5 py-3">
                      {section.heading}
                    </td>
                  </tr>
                  {section.rows.map((row, i) => tableRow(row, i))}
                </tbody>
              ))
            ) : (
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
                  : rows.map((row, i) => tableRow(row, i))}
              </tbody>
            )}
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
        {sections
          ? sections.map((section) => (
              <Fragment key={section.key}>
                <li className="bg-surface-sunken/60 px-4 py-3">{section.heading}</li>
                {section.rows.map((row, i) => stackedRow(row, i))}
              </Fragment>
            ))
          : firstLoad
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <li key={i} aria-hidden="true" className="flex flex-col gap-2.5 px-4 py-3.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3.5 w-1/2" />
                </li>
              ))
            : rows.map((row, i) => stackedRow(row, i))}
      </ul>
    );
  }

  let footer: ReactNode = null;
  if (page && !isEmpty && !firstLoad) {
    const from = page.offset + 1;
    const to = page.offset + rows.length;
    const atStart = page.offset <= 0;
    const atEnd = total !== undefined ? to >= total : rows.length < page.limit;
    footer = (
      <div className="flex items-center justify-between gap-3 pt-3">
        <p aria-live="polite" className="m-0 pl-1 text-[13px] font-medium text-muted-foreground tabular-nums">
          {total !== undefined
            ? t("common.pageRange", { from, to, total: total.toLocaleString("en-IN") })
            : t("ui.pageRangeOpen", { from, to })}
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
