import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { cn } from "@orrn/ui/lib/utils";
import { useInfiniteQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import {
  COMPLAINT_FILTERS,
  COMPLAINT_STATUS_TONE,
  complaintErrorKey,
  filterCount,
  filterOf,
  isComplaintKind,
  isComplaintStatus,
  type ComplaintSearch,
} from "./model";

/** `/complaints`: the register, newest first. The status filter is the URL's (`?status=replied`). */
export function ComplaintsPage({ search, onSearch }: { search: ComplaintSearch; onSearch: (next: ComplaintSearch) => void }) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("reg.complaints.title")} subtitle={t("reg.complaints.subtitle")} />
      <Can
        do={["complaint.open", "complaint.manage"]}
        fallback={
          <div className="rounded-card border border-border bg-card" data-testid="complaints-no-access">
            <EmptyState title={t("reg.complaints.noAccess")} />
          </div>
        }
      >
        <ComplaintsList search={search} onSearch={onSearch} />
      </Can>
    </>
  );
}

const STEP = 50;

function ComplaintsList({ search, onSearch }: { search: ComplaintSearch; onSearch: (next: ComplaintSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const filter = filterOf(search);
  const list = useInfiniteQuery({
    ...trpc.complaints.list.infiniteQueryOptions({ status: filter, limit: STEP }, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
    retry: false,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts;
  type Row = (typeof rows)[number];

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "number",
      header: t("reg.complaints.cols.number"),
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="font-mono font-semibold">{r.number}</span>
          <span className="ml-1.5 text-[13px] text-muted-foreground">{r.period}</span>
        </span>
      ),
    },
    { key: "bundle", header: t("reg.complaints.cols.bundle"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.serial ?? ""}</span> },
    { key: "party", header: t("reg.complaints.cols.party"), hideOnPhone: true, cell: (r) => r.customerName ?? "" },
    { key: "kind", header: t("reg.complaints.cols.kind"), cell: (r) => (isComplaintKind(r.kind) ? t(`reg.complaints.kind.${r.kind}`) : r.kind) },
    {
      key: "status",
      header: t("reg.complaints.cols.status"),
      phoneWide: true,
      cell: (r) =>
        isComplaintStatus(r.status) ? (
          <Chip tone={COMPLAINT_STATUS_TONE[r.status]} truncate={false}>
            {t(`reg.complaints.status.${r.status}`)}
          </Chip>
        ) : (
          r.status
        ),
    },
    { key: "due", header: t("reg.complaints.cols.due"), hideOnPhone: true, cell: (r) => <span className="whitespace-nowrap">{r.actionDue ? fmt.day(r.actionDue) : ""}</span> },
    { key: "opened", header: t("reg.complaints.cols.opened"), hideOnPhone: true, cell: (r) => <span className="whitespace-nowrap">{fmt.date(r.createdAt, { year: true })}</span> },
  ];

  return (
    <>
      <div role="group" aria-label={t("reg.complaints.filter.label")} className="flex flex-wrap gap-2" data-testid="complaint-filters">
        {COMPLAINT_FILTERS.map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              data-filter={f}
              onClick={() => onSearch(f === "active" ? {} : { status: f })}
              className={cn(
                "animate-press inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)]",
                active ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface-sunken",
              )}
            >
              {t("reg.complaints.filter.withCount", { label: t(`reg.complaints.filter.${f}`), count: filterCount(f, counts) })}
            </button>
          );
        })}
      </div>
      {list.isError && !list.data ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={list.error && (list.error as { data?: { code?: string } }).data?.code === "FORBIDDEN" ? t(complaintErrorKey(list.error)) : t("reg.complaints.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ResponsiveList<Row>
            label={t("reg.complaints.title")}
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => `/complaints/${r.id}`}
            loading={list.isPending}
            empty={<EmptyState title={t("reg.complaints.empty")} />}
          />
          {list.hasNextPage ? (
            <div>
              <Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t("reg.complaints.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
