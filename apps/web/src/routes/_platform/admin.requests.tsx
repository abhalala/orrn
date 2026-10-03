import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { formatAgo, formatDay } from "@/features/admin/format";
import type { WaitlistRow } from "@/features/admin/types";
import { ConfirmDialog, errorText, LoadError, Panel } from "@/features/admin/ui";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/requests")({
  component: AdminRequests,
});

type Decision = { kind: "approve" | "reject"; row: WaitlistRow };

/**
 * Access requests from the website (was /admin/waitlist). Approving creates
 * the company with the requester as owner and emails them a sign-in link;
 * rejecting closes the request. Both ask first. Oldest first, so nobody
 * waits behind newer requests.
 */
function AdminRequests() {
  const { t } = useT();
  const qc = useQueryClient();
  const list = useQuery(trpc.platform.waitlistList.queryOptions());
  const [decision, setDecision] = useState<Decision | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.platform.waitlistList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.overview.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() }),
    ]);

  const approve = useMutation({
    ...trpc.platform.waitlistApprove.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.requests.approved"));
      setDecision(null);
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  const reject = useMutation({
    ...trpc.platform.waitlistReject.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.requests.rejected"));
      setDecision(null);
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });

  const rows = [...(list.data ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const pending = approve.isPending || reject.isPending;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title={t("admin.requests.title")}
        subtitle={
          list.data
            ? rows.length > 0
              ? t("admin.requests.waiting", { count: rows.length })
              : t("admin.requests.none")
            : undefined
        }
      />

      {list.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[172px] rounded-card" />
          ))}
        </div>
      ) : list.isError ? (
        <LoadError message={t("admin.requests.loadError")} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState title={t("admin.requests.empty")} body={t("admin.requests.emptyBody")} />
        </Panel>
      ) : (
        <ul aria-label={t("admin.requests.listLabel")} className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0">
              <RequestCard row={row} onDecide={setDecision} />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={decision?.kind === "approve"}
        onOpenChange={(open) => (open ? undefined : setDecision(null))}
        title={decision ? t("admin.requests.approveTitle", { company: decision.row.companyName }) : ""}
        body={decision ? t("admin.requests.approveBody", { email: decision.row.requesterEmail }) : ""}
        confirmLabel={t("admin.requests.approve")}
        pending={pending}
        onConfirm={() => decision && approve.mutate({ id: decision.row.id })}
      />
      <ConfirmDialog
        open={decision?.kind === "reject"}
        onOpenChange={(open) => (open ? undefined : setDecision(null))}
        title={decision ? t("admin.requests.rejectTitle", { company: decision.row.companyName }) : ""}
        body={decision ? t("admin.requests.rejectBody", { email: decision.row.requesterEmail }) : ""}
        confirmLabel={t("admin.requests.reject")}
        tone="danger"
        pending={pending}
        onConfirm={() => decision && reject.mutate({ id: decision.row.id })}
      />
    </div>
  );
}

function RequestCard({ row, onDecide }: { row: WaitlistRow; onDecide(decision: Decision): void }) {
  const { t, locale } = useT();
  const headingId = `request-${row.id}`;
  return (
    <Panel as="article" aria-labelledby={headingId} className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={headingId}
          className="m-0 min-w-0 font-display text-[21px] font-bold leading-tight tracking-[-0.025em] text-foreground break-words"
        >
          {row.companyName}
        </h2>
        <time
          dateTime={new Date(row.createdAt).toISOString()}
          title={formatDay(row.createdAt, { locale })}
          className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground"
        >
          {t("admin.requests.received", { date: formatAgo(row.createdAt, { locale }) })}
        </time>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="m-0 text-[15px] font-semibold text-foreground break-words">
          {t("admin.requests.from", { name: row.requesterName })}
        </p>
        <p className="m-0 text-[15px] text-muted-foreground [overflow-wrap:anywhere]">{row.requesterEmail}</p>
      </div>
      {row.notes ? (
        <p className="m-0 max-w-[70ch] rounded-input bg-surface-sunken px-4 py-3 text-[15px] leading-6 whitespace-pre-line text-foreground break-words">
          {row.notes}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("admin.requests.noNotes")}</p>
      )}
      <Can do="platform.waitlist.review">
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:flex sm:justify-end">
          <Button variant="secondary" onPress={() => onDecide({ kind: "reject", row })}>
            {t("admin.requests.reject")}
          </Button>
          <Button onPress={() => onDecide({ kind: "approve", row })} className="pointer-coarse:h-14">
            {t("admin.requests.approve")}
          </Button>
        </div>
      </Can>
    </Panel>
  );
}
