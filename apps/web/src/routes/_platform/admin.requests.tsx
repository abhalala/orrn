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
import { showsLoadError } from "@/features/admin/query-state";
import { SignInDetailsSheet } from "@/features/admin/sign-in-details";
import type { AwaitingRow, SignInDetails, WaitlistRow } from "@/features/admin/types";
import { ConfirmDialog, errorText, LoadError, Panel, useLastValue } from "@/features/admin/ui";
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
 *
 * Email can fail (Resend, Oct 2026), so an approval never depends on it: the
 * server always answers with the email it built, and when it was not sent the
 * details open in a sheet to copy and send by hand. Approved owners who have
 * not set a password yet stay listed below with "Get sign-in details", which
 * issues a fresh link.
 */
function AdminRequests() {
  const { t } = useT();
  const qc = useQueryClient();
  const list = useQuery(trpc.platform.waitlistList.queryOptions());
  const awaiting = useQuery(trpc.platform.waitlistAwaitingSignIn.queryOptions());
  const [decision, setDecision] = useState<Decision | null>(null);
  const [details, setDetails] = useState<SignInDetails | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.platform.waitlistList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.overview.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.waitlistAwaitingSignIn.queryKey() }),
    ]);

  // The dialog closes after the list is fresh, so the card it acted on is already gone and focus
  // moves to the page heading (never to a removed button, then <body>).
  const done = async (message: string) => {
    toast.success(message);
    await refresh();
    setDecision(null);
  };
  // A failure can still have changed the request (someone else decided it first: BAD_REQUEST).
  // Refresh and close either way.
  const failed = async (err: unknown) => {
    toast.error(errorText(t, err, { BAD_REQUEST: t("admin.requests.alreadyHandled") }));
    await refresh();
    setDecision(null);
  };
  const approve = useMutation({
    ...trpc.platform.waitlistApprove.mutationOptions(),
    onSuccess: async (result) => {
      const signIn = result.signIn;
      if (!signIn) {
        // Approved, but no link could be made: say so and point at the retry below.
        toast.warning(t("admin.requests.approvedNoLink"));
        await refresh();
        setDecision(null);
      } else if (signIn.emailSent) {
        toast.success(t("admin.requests.approvedSent", { email: signIn.to }), {
          action: { label: t("admin.requests.showEmail"), onClick: () => setDetails(signIn) },
        });
        await refresh();
        setDecision(null);
      } else {
        // The email did not go: the details are the way the owner gets in. No toast: it would
        // sit over the sheet's buttons, and the sheet says it.
        await refresh();
        setDecision(null);
        setDetails(signIn);
      }
    },
    onError: failed,
  });
  const getDetails = useMutation({
    ...trpc.platform.waitlistSignInDetails.mutationOptions(),
    onSuccess: setDetails,
    onError: (err) => toast.error(errorText(t, err, { BAD_REQUEST: t("admin.requests.alreadyHandled") })),
  });
  const reject = useMutation({
    ...trpc.platform.waitlistReject.mutationOptions(),
    onSuccess: () => done(t("admin.requests.rejected")),
    onError: failed,
  });

  const waitingOwners = awaiting.data ?? [];
  const rows = [...(list.data ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const pending = approve.isPending || reject.isPending;
  // The dialog keeps its words while it closes.
  const shown = useLastValue(decision);

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
      ) : showsLoadError(list) ? (
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

      {waitingOwners.length > 0 ? (
        <section aria-labelledby="awaiting-heading" className="flex min-w-0 flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1">
            <h2
              id="awaiting-heading"
              className="m-0 font-display text-[19px] font-bold leading-tight tracking-[-0.02em] text-foreground"
            >
              {t("admin.requests.awaitingTitle")}
            </h2>
            <p className="m-0 max-w-[70ch] text-[15px] leading-6 text-muted-foreground">
              {t("admin.requests.awaitingBody")}
            </p>
          </div>
          <ul aria-label={t("admin.requests.awaitingLabel")} className="m-0 flex list-none flex-col gap-3 p-0">
            {waitingOwners.map((row) => (
              <li key={row.id} className="min-w-0">
                <AwaitingCard
                  row={row}
                  busy={getDetails.isPending && getDetails.variables?.id === row.id}
                  disabled={getDetails.isPending}
                  onGet={() => getDetails.mutate({ id: row.id })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SignInDetailsSheet details={details} onClose={() => setDetails(null)} />

      <ConfirmDialog
        open={decision?.kind === "approve"}
        onOpenChange={(open) => (open ? undefined : setDecision(null))}
        title={shown ? t("admin.requests.approveTitle", { company: shown.row.companyName }) : ""}
        body={shown ? t("admin.requests.approveBody", { email: shown.row.requesterEmail }) : ""}
        confirmLabel={t("admin.requests.approve")}
        pending={pending}
        onConfirm={() => decision && approve.mutate({ id: decision.row.id })}
      />
      <ConfirmDialog
        open={decision?.kind === "reject"}
        onOpenChange={(open) => (open ? undefined : setDecision(null))}
        title={shown ? t("admin.requests.rejectTitle", { company: shown.row.companyName }) : ""}
        body={shown ? t("admin.requests.rejectBody", { email: shown.row.requesterEmail }) : ""}
        confirmLabel={t("admin.requests.reject")}
        tone="danger"
        pending={pending}
        onConfirm={() => decision && reject.mutate({ id: decision.row.id })}
      />
    </div>
  );
}

function AwaitingCard({
  row,
  busy,
  disabled,
  onGet,
}: {
  row: AwaitingRow;
  busy: boolean;
  disabled: boolean;
  onGet(): void;
}) {
  const { t } = useT();
  const headingId = `awaiting-${row.id}`;
  return (
    <Panel as="article" aria-labelledby={headingId} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id={headingId} className="m-0 text-[17px] font-bold leading-snug text-foreground break-words">
          {row.companyName}
        </h3>
        <p className="m-0 text-[15px] text-foreground break-words">{row.requesterName}</p>
        <p className="m-0 text-[15px] text-muted-foreground [overflow-wrap:anywhere]">{row.requesterEmail}</p>
      </div>
      <Can do="platform.waitlist.review">
        <Button
          variant="secondary"
          loading={busy}
          disabled={disabled}
          onPress={onGet}
          className="w-full shrink-0 sm:w-auto pointer-coarse:h-14"
        >
          {t("admin.requests.getDetails")}
        </Button>
      </Can>
    </Panel>
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
          <Button variant="secondary" onPress={() => onDecide({ kind: "reject", row })} className="pointer-coarse:h-14">
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
