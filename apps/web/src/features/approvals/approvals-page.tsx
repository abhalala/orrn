/**
 * `/approvals`: the shared inbox for every request that needs a second person
 * (spec P9): D/C notes, cast close, die tier changes, dispatch over the order,
 * voids after a count. The loud element is the count waiting; each request is
 * a quiet card that opens a review sheet with the figures and the decision.
 * Reading is open to every role (`approval.list`); deciding follows the
 * approver roles for the kind, and nobody decides their own request.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { instantDateText } from "../purchase/format";
import { showsQueryError } from "../purchase/query-state";
import type { ApprovalKind } from "@orrn/server/lib/permissions";

import {
  APPROVAL_KINDS,
  APPROVAL_TONE,
  approvalSubject,
  approvalsPageInput,
  canOpenSubject,
  decideState,
  isApprovalKind,
  nextApprovalsOffset,
  splitCodes,
  subjectCodes,
  type ApprovalForView,
  type ApprovalStatus,
} from "./approval-view";
import { APPROVAL_FILTERS, isApprovalStatus } from "./approval-filter";
import { ReviewSheet, type ApprovalItem } from "./review-sheet";

export { APPROVAL_FILTERS, isApprovalKind, isApprovalStatus };

export function ApprovalsPage({
  status,
  kind,
  onChange,
}: {
  status: ApprovalStatus;
  kind: ApprovalKind | undefined;
  onChange(next: { status: ApprovalStatus; kind: ApprovalKind | undefined }): void;
}) {
  const { t } = useT();
  const [reviewing, setReviewing] = useState<ApprovalItem | null>(null);

  // Pages by offset from the server's nextOffset ("Show more" adds a page): approval.list caps
  // limit at 200, so growing the limit broke the Approved and Rejected tabs once they passed 200.
  // The key sits under the approval path, so every approval/purchase invalidation refreshes it.
  const list = useInfiniteQuery({
    queryKey: [["approval", "list"], { input: { status, kind }, type: "infinite" }] as const,
    queryFn: ({ pageParam }) => trpcClient.approval.list.query(approvalsPageInput({ status, kind }, pageParam)),
    initialPageParam: 0,
    getNextPageParam: nextApprovalsOffset,
    placeholderData: keepPreviousData,
  });
  const waiting = useQuery(trpc.approval.list.queryOptions({ status: "pending", kind, limit: 1, offset: 0 }));
  // One row per request even if a page boundary shifted while the pages were refetched.
  const items = useMemo(() => {
    const byId = new Map<string, ApprovalItem>();
    for (const page of list.data?.pages ?? []) for (const item of page.items as ApprovalItem[]) if (!byId.has(item.id)) byId.set(item.id, item);
    return [...byId.values()];
  }, [list.data]);
  const waitingCount = waiting.data?.total ?? null;

  return (
    <>
      <PageHeader title={t("approvals.title")} subtitle={t("approvals.subtitle")} />

      {status === "pending" && waitingCount !== null && waitingCount > 0 ? (
        <StatusBlock
          tone="amber"
          title={t("approvals.waitingTitle")}
          meta={kind ? t(`approvals.kind.${kind}`) : t("approvals.allKinds")}
          value={waitingCount}
          unit={t("approvals.waitingUnit", { count: waitingCount })}
          className="sm:max-w-[360px]"
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SegmentedControl
          label={t("approvals.filter.label")}
          // The control pins itself to the top of a row; here it sits on the
          // Kind select's baseline.
          className="sm:self-end"
          value={status}
          onChange={(s) => onChange({ status: s, kind })}
          options={APPROVAL_FILTERS.map((s) => ({ value: s, label: t(`approvals.filter.${s}`) }))}
        />
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-64">
          <label htmlFor="approval-kind" className="text-[14px] font-semibold">
            {t("approvals.kindFilter")}
          </label>
          <Select
            id="approval-kind"
            value={kind ?? "all"}
            onValueChange={(v) => onChange({ status, kind: isApprovalKind(v) ? v : undefined })}
            options={[
              { value: "all", label: t("approvals.allKinds") },
              ...APPROVAL_KINDS.map((k) => ({ value: k, label: t(`approvals.kind.${k}`) })),
            ]}
          />
        </div>
      </div>

      {list.isLoading ? (
        <ul aria-busy="true" className="m-0 flex list-none flex-col gap-3 p-0">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </li>
          ))}
        </ul>
      ) : showsQueryError(list) ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("approvals.error")}
            action={
              <Button variant="secondary" onClick={() => list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          {status === "pending" && !kind ? (
            <EmptyState title={t("approvals.emptyPendingTitle")} body={t("approvals.emptyPendingBody")} />
          ) : (
            <EmptyState
              title={t("approvals.emptyTitle")}
              body={t("approvals.emptyBody")}
              action={
                <Button variant="secondary" onClick={() => onChange({ status: "pending", kind: undefined })}>
                  {t("approvals.filter.pending")}
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <>
          <ul
            aria-label={t("approvals.title")}
            aria-busy={list.isFetching || undefined}
            className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2"
          >
            {items.map((item) => (
              <RequestCard key={item.id} item={item} onReview={() => setReviewing(item)} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              className="self-center"
              loading={list.isFetchingNextPage}
              disabled={list.isFetching}
              onClick={() => void list.fetchNextPage()}
            >
              {t("common.showMore")}
            </Button>
          ) : null}
          {list.isFetchNextPageError ? (
            <p role="alert" className="m-0 self-center text-[14px] text-destructive">
              {t("approvals.moreError")}
            </p>
          ) : null}
        </>
      )}

      <ReviewSheet item={reviewing} onOpenChange={(open) => !open && setReviewing(null)} />
    </>
  );
}

function RequestCard({ item, onReview }: { item: ApprovalItem; onReview(): void }) {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const view: ApprovalForView = item;
  const subject = approvalSubject(view, { plant: t("approvals.move.plant"), mainBand: t("approvals.band.main"), otherBand: t("approvals.band.other") });
  const state = decideState(me, view);
  const title = t(subject.titleKey, subject.vars) || t(subject.kindKey);
  // Codes stay on one line: "LOT-" and "13" on two lines misreads.
  const titleNode = splitCodes(title, subjectCodes(subject)).map((p, i) =>
    p.code ? (
      <span key={i} className="whitespace-nowrap">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
  const tz = typeof me?.company?.settings?.timezone === "string" ? me.company.settings.timezone : undefined;
  // Only link what this person can open (foundry and die room see D/C notes here, not purchase).
  const href = subject.href && canOpenSubject(me, view) ? subject.href : null;
  const asked = t("approvals.askedBy", { name: item.requestedByName ?? t("approvals.someone") });
  return (
    <li
      data-testid="approval-card"
      data-kind={item.kind}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-muted-foreground">{t(subject.kindKey)}</span>
          <h2 className="m-0 font-display text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">
            {href ? (
              // 44 px tall on touch (brief), still reading as a heading.
              <UiLink to={href} className="inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline">
                <span>{titleNode}</span>
              </UiLink>
            ) : (
              titleNode
            )}
          </h2>
        </div>
        <Chip tone={APPROVAL_TONE[item.status]}>{t(`status.request.${item.status}`)}</Chip>
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">
        {asked}, <time dateTime={new Date(item.createdAt).toISOString()}>{instantDateText(item.createdAt, locale, tz)}</time>
      </p>
      {item.requestNote ? (
        <p className="m-0 rounded-input bg-surface-sunken px-3 py-2 text-[14px] break-words">{item.requestNote}</p>
      ) : null}
      {item.status !== "pending" ? (
        <p className="m-0 text-[14px] break-words">
          {t("approvals.decidedBy", {
            status: t(`status.request.${item.status}`),
            name: item.decidedByName ?? t("approvals.someone"),
          })}
          {item.note ? `: ${item.note}` : ""}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          variant={state === "decide" ? "primary" : "secondary"}
          onClick={onReview}
          aria-label={`${state === "decide" ? t("approvals.review") : t("approvals.view")}: ${title}`}
        >
          {state === "decide" ? t("approvals.review") : t("approvals.view")}
        </Button>
        {state === "own" ? <span className="text-[14px] text-muted-foreground">{t("approvals.own")}</span> : null}
      </div>
    </li>
  );
}
