/** Pieces the six XE register pages share: the day range (defaulting to the current production day), the load states and the pager line. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { RegRangeSearch } from "./reg-search";

/** `from` and `to` of a page: the URL's days, else the current production day (one cached query shared with the press report). */
export function useRegRange(search: RegRangeSearch): { from: string; to: string } | null {
  const today = useQuery({ ...trpc.press.summary.queryOptions({}), meta: INLINE_ERROR_META });
  const from = search.from ?? search.to ?? today.data?.productionDay;
  const to = search.to ?? search.from ?? today.data?.productionDay;
  return from && to ? { from, to } : null;
}

export function RegRangeFields<S extends RegRangeSearch>({ search, range, onSearch }: { search: S; range: { from: string; to: string } | null; onSearch: (next: S) => void }) {
  const { t } = useT();
  return (
    <>
      <Field label={t("reports.from")}>
        <TextInput type="date" value={range?.from ?? ""} onChange={(e) => onSearch({ ...search, from: e.currentTarget.value || undefined, to: search.to ?? (e.currentTarget.value || undefined) })} />
      </Field>
      <Field label={t("reports.to")}>
        <TextInput type="date" value={range?.to ?? ""} onChange={(e) => onSearch({ ...search, to: e.currentTarget.value || undefined })} />
      </Field>
    </>
  );
}

export function RegLoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="rounded-card border border-border bg-card">
      <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>} />
    </div>
  );
}

export function RegEmpty({ title }: { title: string }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-card">
      <EmptyState title={title} />
    </div>
  );
}

export const RegLoading = () => <Skeleton className="h-48 rounded-card" />;

/** "Showing 100 of 240" with a Show more button while the server has another page. */
export function RegPager({ shown, total, more, loading, onMore }: { shown: number; total: number; more: boolean; loading: boolean; onMore: () => void }) {
  const { t } = useT();
  return (
    <div className="report-no-print flex flex-wrap items-center gap-3">
      <p className="m-0 text-[14px] text-muted-foreground">{t("reg.reports.shown", { shown, total })}</p>
      {more ? (
        <Button variant="secondary" onClick={onMore} disabled={loading}>
          {t("reports.showMore")}
        </Button>
      ) : null}
    </div>
  );
}

/** A figure in the totals strip. */
export function RegStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-card border border-border bg-card px-3 py-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[17px] font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export const Dash = () => <span className="text-muted-foreground">—</span>;
