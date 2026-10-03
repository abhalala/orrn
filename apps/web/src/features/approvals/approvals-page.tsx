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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { instantDateText } from "../purchase/format";
import type { ApprovalKind } from "@orrn/server/lib/permissions";

import {
  APPROVAL_KINDS,
  APPROVAL_TONE,
  approvalSubject,
  decideState,
  isApprovalKind,
  type ApprovalForView,
  type ApprovalStatus,
} from "./approval-view";
import { ReviewSheet, type ApprovalItem } from "./review-sheet";

export const APPROVAL_FILTERS = ["pending", "approved", "rejected"] as const;
export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return typeof v === "string" && (APPROVAL_FILTERS as readonly string[]).includes(v);
}
export { isApprovalKind };

const PAGE = 25;

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
  const [limit, setLimit] = useState(PAGE);
  const [reviewing, setReviewing] = useState<ApprovalItem | null>(null);

  const list = useQuery({
    ...trpc.approval.list.queryOptions({ status, kind, limit, offset: 0 }),
    placeholderData: keepPreviousData,
  });
  const waiting = useQuery(trpc.approval.list.queryOptions({ status: "pending", kind, limit: 1, offset: 0 }));
  const items = (list.data?.items ?? []) as ApprovalItem[];
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
          value={status}
          onChange={(s) => {
            setLimit(PAGE);
            onChange({ status: s, kind });
          }}
          options={APPROVAL_FILTERS.map((s) => ({ value: s, label: t(`approvals.filter.${s}`) }))}
        />
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-64">
          <label htmlFor="approval-kind" className="text-[14px] font-semibold">
            {t("approvals.kindFilter")}
          </label>
          <Select
            id="approval-kind"
            value={kind ?? "all"}
            onValueChange={(v) => {
              setLimit(PAGE);
              onChange({ status, kind: isApprovalKind(v) ? v : undefined });
            }}
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
      ) : list.isError ? (
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
          {list.data?.nextOffset != null ? (
            <Button variant="secondary" className="self-center" loading={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
              {t("common.showMore")}
            </Button>
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
  const subject = approvalSubject(view);
  const state = decideState(me, view);
  const title = t(subject.titleKey, subject.vars);
  const tz = typeof me?.company?.settings?.timezone === "string" ? me.company.settings.timezone : undefined;
  const asked = t("approvals.askedBy", { name: item.requestedByName ?? t("approvals.someone") });
  return (
    <li
      data-testid="approval-card"
      data-kind={item.kind}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-muted-foreground">{t(subject.kindKey)}</span>
          <h2 className="m-0 font-display text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">
            {subject.href ? (
              <UiLink to={subject.href} className="text-foreground underline-offset-4 hover:underline">
                {title || t(subject.kindKey)}
              </UiLink>
            ) : (
              title || t(subject.kindKey)
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
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={state === "decide" ? "primary" : "secondary"} onClick={onReview} aria-label={`${state === "decide" ? t("approvals.review") : t("approvals.view")}: ${title || t(subject.kindKey)}`}>
          {state === "decide" ? t("approvals.review") : t("approvals.view")}
        </Button>
        {state === "own" ? <span className="text-[14px] text-muted-foreground">{t("approvals.own")}</span> : null}
      </div>
    </li>
  );
}
